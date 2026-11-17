"""Giriş ve yetki: argon2 şifre özeti, JWT oturumu, çalışma alanı rolleri."""

from __future__ import annotations

from datetime import timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from .db import now

_ph = PasswordHasher()

ROLES = ("viewer", "contributor", "member", "admin")
ROLE_LABEL = {"admin": "Yönetici", "member": "Üye", "contributor": "Katkıda bulunan", "viewer": "İzleyici"}

# Power BI çalışma alanı yetkileri (sadeleştirilmiş)
CAN_PUBLISH = {"admin", "member", "contributor"}
CAN_SHARE = {"admin", "member"}
CAN_REFRESH = {"admin", "member", "contributor"}


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(stored: str, password: str) -> bool:
    try:
        return _ph.verify(stored, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def issue_token(user_id: int, secret: str, hours: int = 12) -> str:
    t = now()
    return jwt.encode({"sub": str(user_id), "iat": t, "exp": t + timedelta(hours=hours)}, secret, algorithm="HS256")


def read_token(token: str, secret: str) -> int | None:
    try:
        data = jwt.decode(token, secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
        return int(data["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return None
