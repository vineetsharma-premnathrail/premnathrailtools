"""Print a sign-in token for the Playwright UI checks (frontend/e2e).

Sign-in is Microsoft-only, so the browser tests can't log in through the UI.
This mints the same session_token JWT the auth callback issues, signed with
the local SECRET_KEY, for an existing active user. It carries no `sid`, so it
isn't tied to a refresh session; it expires after `--minutes`.

Usage (from backend/):  venv/Scripts/python.exe scripts/e2e_token.py [email] [--minutes N]
With no email, the first active admin is used.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth.jwt_handler import create_access_token  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
import app.main  # noqa: E402,F401  (registers every model so relationships resolve)
from app.modules.main.models.user import User  # noqa: E402


def main() -> None:
    args = sys.argv[1:]
    minutes = 120
    if "--minutes" in args:
        i = args.index("--minutes")
        minutes = int(args[i + 1])
        del args[i:i + 2]
    email = args[0] if args else None

    if "localhost" not in settings.DATABASE_URL and "127.0.0.1" not in settings.DATABASE_URL:
        sys.exit("Refusing to mint a test token: DATABASE_URL is not a local database.")

    db = SessionLocal()
    try:
        q = db.query(User).filter(User.is_active.is_(True))
        user = q.filter(User.email == email).first() if email else q.filter(User.role == "admin").order_by(User.id).first()
        if not user:
            sys.exit(f"No active user {'with email ' + email if email else 'with role admin'} in the local database.")
        print(create_access_token({"sub": str(user.id), "email": user.email, "role": user.role}, minutes))
    finally:
        db.close()


if __name__ == "__main__":
    main()
