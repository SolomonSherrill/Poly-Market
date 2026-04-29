from dotenv import load_dotenv
from datetime import datetime, timezone
from bson import ObjectId
from pymongo.errors import PyMongoError

from Accounts import ServiceUnavailableError, get_db

load_dotenv()


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def create_prediction(
    prediction_id: str,
    creator_id: str,
    bet_string: str,
    is_high_low: bool,
    is_yes_no: bool,
    end_time: datetime,
):
    db = get_db()
    if not prediction_id or not prediction_id.strip():
        raise ValueError("Prediction id is required")
    if not bet_string or not bet_string.strip():
        raise ValueError("Prediction question is required")
    if is_high_low == is_yes_no:
        raise ValueError("Choose exactly one prediction type")

    bet_type = "highLow" if is_high_low else "yesNo" if is_yes_no else "other"
    prediction = {
        "id": prediction_id.strip(),
        "creator_id": creator_id,
        "bet_string": bet_string.strip(),
        "bet_type": bet_type,
        "end_time": _as_utc(end_time),
        "created_at": datetime.now(timezone.utc),
        "resolved": False,
        "outcome": None,
        "total_yes": 0,
        "total_no": 0,
    }
    try:
        db["Predictions"].insert_one(prediction)
        return {
            "id": prediction["id"],
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
            prediction["_id"] = prediction.get("id", str(prediction["_id"]))
            prediction["id"] = prediction["_id"]
            prediction["creator_id"] = str(prediction["creator_id"])
            predictions.append(prediction)
        return predictions
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB prediction query failed: {exc}") from exc


def get_prediction(prediction_id: str):
    db = get_db()
    try:
        prediction = db["Predictions"].find_one({"id": prediction_id})
        if not prediction:
            try:
                object_id = ObjectId(prediction_id)
            except Exception:
                object_id = None

            if object_id is not None:
                prediction = db["Predictions"].find_one({"_id": object_id})
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB prediction lookup failed: {exc}") from exc
    if not prediction:
        raise ValueError("Prediction not found")
    prediction["_id"] = prediction.get("id", str(prediction["_id"]))
    prediction["id"] = prediction["_id"]
    prediction["creator_id"] = str(prediction["creator_id"])
    return prediction


def get_predictions_by_creator(creator_id: str):
    db = get_db()
    try:
        prediction_list = db["Predictions"].find({"creator_id": creator_id}).sort("created_at", -1)
        predictions = []
        for prediction in prediction_list:
            prediction["_id"] = prediction.get("id", str(prediction["_id"]))
            prediction["id"] = prediction["_id"]
            prediction["creator_id"] = str(prediction["creator_id"])
            predictions.append(prediction)
        return predictions
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB creator prediction query failed: {exc}") from exc


def get_prediction_history(prediction_id: str):
    db = get_db()
    try:
        history = list(db["Market"].find({"prediction_id": prediction_id}).sort("created_at", 1))
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB prediction history query failed: {exc}") from exc

    return [
        {
            "user_id": entry.get("user_id"),
            "prediction_id": entry.get("prediction_id"),
            "stake": entry.get("stake", 0),
            "bet_type": entry.get("bet_type"),
            "created_at": entry.get("created_at"),
        }
        for entry in history
    ]


def back_prediction(prediction_id: str, user_id: str, amount: float, is_yes: bool):
    db = get_db()
    if amount <= 0:
        raise ValueError("Amount must be greater than 0")

    try:
        prediction = db["Predictions"].find_one({"id": prediction_id})
        if not prediction:
            try:
                prediction_object_id = ObjectId(prediction_id)
            except Exception:
                prediction_object_id = None
            if prediction_object_id is not None:
                prediction = db["Predictions"].find_one({"_id": prediction_object_id})

        user = db["Users"].find_one({"id": user_id})
        if not user:
            try:
                user_object_id = ObjectId(user_id)
            except Exception:
                user_object_id = None
            if user_object_id is not None:
                user = db["Users"].find_one({"_id": user_object_id})
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB bet lookup failed: {exc}") from exc
    if not user or user["balance"] < amount:
        return {"success": False, "message": "Insufficient balance"}
    if not prediction:
        return {"success": False, "message": "Prediction not found"}

    prediction_end_time = _as_utc(prediction["end_time"])
    if prediction["resolved"] or prediction_end_time < datetime.now(timezone.utc):
        return {"success": False, "message": "Prediction is resolved or has expired"}
    bet_type = "yes" if is_yes else "no"
    bet = {
        "user_id": user.get("id", str(user["_id"])),
        "prediction_id": prediction.get("id", str(prediction["_id"])),
        "stake": amount,
        "bet_type": bet_type,
        "created_at": datetime.now(timezone.utc),
    }
    field = "total_yes" if is_yes else "total_no"
    try:
        db["Market"].insert_one(bet)
        db["Users"].update_one({"_id": user["_id"]}, {"$inc": {"balance": -amount}})
        db["Predictions"].update_one(
            {"_id": prediction["_id"]},
            {"$inc": {field: amount}}
        )
    except PyMongoError as exc:
        raise ServiceUnavailableError(f"MongoDB bet update failed: {exc}") from exc
    return {"success": True}
