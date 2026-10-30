from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from app.core.config import settings

# Create the SQLAlchemy engine using the database URL from settings.
# pool_pre_ping: after a Postgres restart the pool would otherwise hand out
# dead connections ("terminating connection due to administrator command").
# pool_recycle: drop connections idle long enough to be cut by the network.
engine = create_engine(settings.database_url, pool_pre_ping=True, pool_recycle=1800)

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
