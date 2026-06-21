"""Authentication: verify Google ID tokens, enforce the company domain,
and issue/verify our own short-lived session JWT.

Flow:
  1. Frontend uses Google Identity Services to get an ID token (credential).
  2. POST /api/auth/login -> we verify it with Google, check the hosted
     domain, upsert the user, and return our own session JWT.
  3. Frontend sends that JWT as a Bearer token on every API call.
"""
import time
import jwt  # PyJWT
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from sqlmodel import Session, select

from .config import get_settings
from .db import get_session
from .models import User

settings = get_settings()
bearer = HTTPBearer(auto_error=False)


def verify_google_credential(credential: str) -> dict:
    """Verify a Google ID token and return its claims, or raise 401."""
    try:
        info = google_id_token.verify_oauth2_token(
            credential, google_requests.Request(), settings.google_client_id
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Google token")

    email = (info.get("email") or "").lower()
    if not info.get("email_verified"):
        raise HTTPException(status_code=401, detail="Email not verified")

    # Company-domain restriction (hosted domain claim 'hd').
    if settings.allowed_hosted_domain:
        hd = info.get("hd", "")
        domain_ok = hd == settings.allowed_hosted_domain or email.endswith(
            "@" + settings.allowed_hosted_domain
        )
        email_ok = email in settings.allowed_email_list
        if not (domain_ok or email_ok):
            raise HTTPException(
                status_code=403,
                detail="This app is restricted to your company Google domain.",
            )
    return info


def issue_session_jwt(email: str) -> str:
    now = int(time.time())
    payload = {
        "sub": email,
        "iat": now,
        "exp": now + settings.jwt_ttl_hours * 3600,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    session: Session = Depends(get_session),
) -> User:
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    email = payload.get("sub")
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
