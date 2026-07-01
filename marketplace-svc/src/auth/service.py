from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.exceptions import DuplicateEmail
from src.models.account import Account
from src.models.wallet import Wallet
from src.auth.utils import generate_unique_affiliate_code


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(account_id: int, roles: list[str]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(account_id), "roles": roles, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def register_account(email: str, password: str, db: AsyncSession) -> Account:
    existing = await db.scalar(select(Account).where(Account.email == email))
    if existing:
        raise DuplicateEmail()
    affiliate_code = await generate_unique_affiliate_code(db)
    account = Account(
        email=email,
        password_hash=hash_password(password),
        affiliate_code=affiliate_code,
    )
    db.add(account)
    await db.flush()
    wallet = Wallet(account_id=account.id)
    db.add(wallet)
    await db.commit()
    await db.refresh(account)
    return account


async def authenticate(email: str, password: str, db: AsyncSession) -> Account:
    account = await db.scalar(select(Account).where(Account.email == email))
    if not account or not verify_password(password, account.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return account
