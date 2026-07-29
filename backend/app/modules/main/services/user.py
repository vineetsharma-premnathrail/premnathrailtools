from sqlalchemy.orm import Session
from app.modules.main.repositories.user import UserRepository
from app.modules.main.schemas.user import UserCreate, UserUpdate, UserResponse


class UserService:
    """Business logic layer for User. Uses repository for database access."""

    def __init__(self, db: Session):
        self.db = db
        self.repository = UserRepository(db)

    def create_user(self, user_data: UserCreate, azure_id: str | None = None) -> UserResponse:
        """Create a new user with validation."""
        # Business logic: Check if email already exists
        existing_user = self.repository.get_by_email(user_data.email)
        if existing_user:
            raise ValueError(f"User with email {user_data.email} already exists")

        # Create the user via repository
        user = self.repository.create(
            email=user_data.email,
            name=user_data.name,
            azure_id=azure_id
        )
        return UserResponse.model_validate(user)

    def get_user_by_id(self, user_id: int) -> UserResponse | None:
        """Fetch a user by ID."""
        user = self.repository.get_by_id(user_id)
        if not user:
            return None
        return UserResponse.model_validate(user)

    def get_user_by_email(self, email: str) -> UserResponse | None:
        """Fetch a user by email."""
        user = self.repository.get_by_email(email)
        if not user:
            return None
        return UserResponse.model_validate(user)

    def list_users(self, skip: int = 0, limit: int = 100) -> list[UserResponse]:
        """Fetch all users."""
        users = self.repository.get_all(skip=skip, limit=limit)
        return [UserResponse.model_validate(user) for user in users]

    def update_user(self, user_id: int, user_data: UserUpdate) -> UserResponse | None:
        """Update a user."""
        user = self.repository.update(user_id, **user_data.model_dump(exclude_unset=True))
        if not user:
            return None
        return UserResponse.model_validate(user)

    def delete_user(self, user_id: int) -> bool:
        """Delete a user."""
        return self.repository.delete(user_id)
