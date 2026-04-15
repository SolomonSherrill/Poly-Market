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
def create_prediction(creator_id: str, bet_string: str, is_high_low: bool, is_yes_no: bool, end_time: datetime) -> str:
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
def get_prediction(prediction_id: str) -> dict:
    prediction = db["Predictions"].find_one({"_id": ObjectId(prediction_id)})
    if prediction:
        prediction["_id"] = str(prediction["_id"])
        prediction["creator_id"] = str(prediction["creator_id"])
    return prediction
def back_prediction(prediction_id: str, user_id: str, amount: float, is_yes: bool) -> bool:
    prediction = db["Predictions"].find_one({"_id": ObjectId(prediction_id)})
    if not prediction or prediction["resolved"] or prediction["end_time"] < datetime.now(timezone.utc):
        return False
    bet_type = "yes" if is_yes else "no"
    bet = {
        "user_id": ObjectId(user_id),
        "amount": amount,
        "bet_type": bet_type,
        "created_at": datetime.now(timezone.utc),
    }
    db["Bets"].insert_one({**bet, "prediction_id": ObjectId(prediction_id)})
    if is_yes:
        db["Market"].insert_one({"_id": ObjectId(prediction_id)}, {"$inc": {"total_yes": amount}})
    else:
        db["Market"].insert_one({"_id": ObjectId(prediction_id)}, {"$inc": {"total_no": amount}})
    return True
