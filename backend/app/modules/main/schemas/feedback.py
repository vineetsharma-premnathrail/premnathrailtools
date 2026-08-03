from datetime import datetime
from pydantic import BaseModel, Field, field_validator


class FeedbackCreate(BaseModel):
    """Schema for submitting feedback/a suggestion (POST request body)."""
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def strip_and_require_content(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Feedback message cannot be blank")
        return stripped


class FeedbackResponse(BaseModel):
    """Schema for feedback API response, as seen by an admin. Always built
    manually via routes.feedback._to_response(), never via model_validate()."""

    id: int
    user_id: int
    user_name: str
    user_email: str
    message: str
    is_read: bool
    created_at: datetime
