from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

QUESTION_MAX = 500
ANSWER_MAX = 1000


def _meaningful(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Nội dung không được để trống")
    return value


class QuestionCreate(BaseModel):
    question: str = Field(min_length=1, max_length=QUESTION_MAX)

    @field_validator("question")
    @classmethod
    def trimmed(cls, value: str) -> str:
        return _meaningful(value)


class AnswerUpdate(BaseModel):
    answer: str = Field(min_length=1, max_length=ANSWER_MAX)

    @field_validator("answer")
    @classmethod
    def trimmed(cls, value: str) -> str:
        return _meaningful(value)


class VisibilityUpdate(BaseModel):
    hidden: bool


class PublicQuestion(BaseModel):
    """Answered and visible; the asker is masked like a reviewer."""
    id: int
    question: str
    answer: str
    asker_label: str
    created_at: datetime
    answered_at: datetime


class PublicQuestionList(BaseModel):
    items: list[PublicQuestion]
    total: int
    page: int
    per_page: int


class MyQuestion(BaseModel):
    id: int
    question: str
    answer: str | None
    status: Literal["pending", "answered", "hidden"]
    created_at: datetime
    answered_at: datetime | None


class SellerQuestion(BaseModel):
    id: int
    product_id: int
    product_title: str
    product_path: str
    question: str
    answer: str | None
    status: Literal["pending", "answered", "hidden"]
    hidden_by: str | None
    asker_label: str
    created_at: datetime
    answered_at: datetime | None


class SellerQuestionList(BaseModel):
    items: list[SellerQuestion]
    total: int
    page: int
    per_page: int
    pending: int
