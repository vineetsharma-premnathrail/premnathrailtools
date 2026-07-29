from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from app.core.config import settings

# Create the SQLAlchemy engine using the database URL from settings
engine = create_engine(settings.database_url)

# Create a configured "Session" class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Dependency to get a database session
def get_db():
    """Yield a database session for use in FastAPI endpoints."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
