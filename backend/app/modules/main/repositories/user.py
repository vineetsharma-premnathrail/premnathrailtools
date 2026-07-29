from sqlalchemy.orm import Session
from app.modules.main.models.user import User


class UserRepository:
    """Database access layer for User model. No business logic here."""

    def __init__(self, db: Session):
        self.db = db

    def create(self, email: str, name: str, azure_id: str | None = None) -> User:
        """Insert a new user into the database."""
        user = User(email=email, name=name, azure_id=azure_id, role="user", is_active=True)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def get_by_email(self, email: str) -> User | None:
        """Fetch a user by email."""
        return self.db.query(User).filter(User.email == email).first()

    def get_by_id(self, user_id: int) -> User | None:
        """Fetch a user by ID."""
        return self.db.query(User).filter(User.id == user_id).first()

    def get_all(self, skip: int = 0, limit: int = 100) -> list[User]:
        """Fetch all users with pagination."""
        return self.db.query(User).offset(skip).limit(limit).all()

    def update(self, user_id: int, **kwargs) -> User | None:
        """Update user fields."""
        user = self.get_by_id(user_id)
        if not user:
            return None
        for key, value in kwargs.items():
            if value is not None:
                setattr(user, key, value)
        self.db.commit()
        self.db.refresh(user)
        return user

    def delete(self, user_id: int) -> bool:
        """Delete a user."""
        user = self.get_by_id(user_id)
        if not user:
            return False
        self.db.delete(user)
        self.db.commit()
        return True

