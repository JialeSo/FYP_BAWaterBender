from pydantic import BaseModel
from datetime import datetime


class WeatherAlertMessage(BaseModel):
    id: int
    text: str
    date: datetime
    sender_id: int
