from dotenv import load_dotenv
from datetime import datetime, timedelta, timezone
from bson import ObjectId
import os
from pymongo.errors import PyMongoError

from Accounts import ServiceUnavailableError, get_db

load_dotenv()


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def create_prediction(creator_id: str, bet_string: str, is_high_low: bool, is_yes_no: bool, end_time: datetime):
    db = get_db()
    bet_type = "high_low" if is_high_low else "yes_no" if is_yes_no else "other"
    prediction = {
        "creator_id": ObjectId(creator_id),
        "bet_string": bet_string,
        "bet_type": bet_type,
        "end_time": end_time,
        "created_at": datetime.now(timezone.utc),
        "resolved": False,
        "outcome": None,
        "total_yes": 0,
        "total_no": 0,
    }
    try:
        result = db["Predictions"].insert_one(prediction)
        return {
            "id": str(result.inserted_id),
            "creator_id": creator_id,
            "bet_string": bet_string,
            "bet_type": bet_type,
            "end_time": end_time,
            "created_at": prediction["created_at"],
        }
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB prediction creation failed: {exc}") from exc


def get_all_predictions():
    db = get_db()
    try:
        prediction_list = db["Predictions"].find({"resolved": False, "end_time": {"$gt": datetime.now(timezone.utc)}})
        predictions = []
        for prediction in prediction_list:
            prediction["_id"] = str(prediction["_id"])
            prediction["creator_id"] = str(prediction["creator_id"])
            predictions.append(prediction)
        return predictions
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB prediction query failed: {exc}") from exc


def get_prediction(prediction_id: str):
    db = get_db()
    try:
        object_id = ObjectId(prediction_id)
    except Exception:
        raise ValueError("Invalid prediction ID")

    try:
        prediction = db["Predictions"].find_one({"_id": object_id})
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB prediction lookup failed: {exc}") from exc
    if not prediction:
        raise ValueError("Prediction not found")
    prediction["_id"] = str(prediction["_id"])
    prediction["creator_id"] = str(prediction["creator_id"])
    return prediction


def back_prediction(prediction_id: str, user_id: str, amount: float, is_yes: bool):
    db = get_db()
    try:
        prediction_object_id = ObjectId(prediction_id)
        user_object_id = ObjectId(user_id)
    except Exception:
        raise ValueError("Invalid prediction or user id")

    try:
        prediction = db["Predictions"].find_one({"_id": prediction_object_id})
        user = db["Users"].find_one({"_id": user_object_id})
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB bet lookup failed: {exc}") from exc
    if not user or user["balance"] < amount:
        return {"success": False, "message": "Insufficient balance"}
    if amount <= 0:
        raise ValueError("Amount must be greater than 0")
    if not prediction:
        return {"success": False, "message": "Prediction not found"}

    prediction_end_time = _as_utc(prediction["end_time"])
    if prediction["resolved"] or prediction_end_time < datetime.now(timezone.utc):
        return {"success": False, "message": "Prediction is resolved or has expired"}
    bet_type = "yes" if is_yes else "no"
    bet = {
        "user_id": ObjectId(user_id),
        "prediction_id": ObjectId(prediction_id),
        "stake": amount,
        "bet_type": bet_type,
        "created_at": datetime.now(timezone.utc),
    }
    field = "total_yes" if is_yes else "total_no"
    try:
        db["Market"].insert_one(bet)
        db["Users"].update_one({"_id": user_object_id}, {"$inc": {"balance": -amount}})
        db["Predictions"].update_one(
            {"_id": prediction_object_id},
            {"$inc": {field: amount}}
        )
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB bet update failed: {exc}") from exc
    return {"success": True}
