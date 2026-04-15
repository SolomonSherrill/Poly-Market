import pymongo
from dotenv import load_dotenv
import jwt
import certifi
from pymongo import MongoClient
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from secrets import token_urlsafe
import os
load_dotenv()
_client = MongoClient(os.getenv("MONGO_URL"), tlsCAFile=certifi.where())
db = _client["Poly-Market"]
def create_prediction(creator_id: str, bet_string: str, is_high_low: bool, is_yes_no: bool, end_time: datetime):
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
    result = db["Predictions"].insert_one(prediction)
    return str(result.inserted_id)
def get_all_predictions():
    predictions = []
    try:
        prediction_list = db["Predictions"].find({"resolved": False, "end_time": {"$gt": datetime.now(timezone.utc)}})
    except Exception as e:
        raise ValueError("Error fetching predictions: " + str(e))
    for prediction in prediction_list:
        prediction["_id"] = str(prediction["_id"])
        prediction["creator_id"] = str(prediction["creator_id"])
        predictions.append(prediction)
    return predictions
def get_prediction(prediction_id: str):
    try:
        prediction = db["Predictions"].find_one({"_id": ObjectId(prediction_id)})
    except Exception:
        raise ValueError("Invalid prediction ID")
    if not prediction:
        raise ValueError("Prediction not found")
    prediction["_id"] = str(prediction["_id"])
    prediction["creator_id"] = str(prediction["creator_id"])
    return prediction
def back_prediction(prediction_id: str, user_id: str, amount: float, is_yes: bool):
    prediction = db["Predictions"].find_one({"_id": ObjectId(prediction_id)})
    user = db["Users"].find_one({"_id": ObjectId(user_id)})
    if not user or user["balance"] < amount:
        return {"success": False, "message": "Insufficient balance"}
    if not prediction or prediction["resolved"] or prediction["end_time"] < datetime.now(timezone.utc):
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
    db["Market"].insert_one(bet)
    db["Users"].update_one({"_id": ObjectId(user_id)}, {"$inc": {"balance": -amount}})
    db["Predictions"].update_one(
        {"_id": ObjectId(prediction_id)},
        {"$inc": {field: amount}}
    )
    return {"success": True}