"""Internal admin notes on an account or a seller application.

The caller checks that the subject exists; this module owns storage, the
author lookup and the audit row.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.logging import current_request_id
from src.models.account import Account
from src.models.admin_note import ADMIN_NOTE_SUBJECTS, AdminNote


async def list_notes(db: AsyncSession, subject_type: str, subject_id: int) -> list[dict]:
    rows = (await db.execute(
        select(AdminNote, Account.email)
        .outerjoin(Account, Account.id == AdminNote.author_id)
        .where(AdminNote.subject_type == subject_type, AdminNote.subject_id == subject_id)
        .order_by(AdminNote.created_at.desc(), AdminNote.id.desc())
    )).all()
    return [
        {"id": note.id, "body": note.body, "author_email": email, "created_at": note.created_at}
        for note, email in rows
    ]


async def add_note(db: AsyncSession, subject_type: str, subject_id: int, body: str, *, author_id: int) -> dict:
    """Append a note and its audit row, then commit."""
    if subject_type not in ADMIN_NOTE_SUBJECTS:
        raise ValueError(f"unknown note subject {subject_type}")
    note = AdminNote(subject_type=subject_type, subject_id=subject_id, author_id=author_id, body=body)
    db.add(note)
    await db.flush()
    await log_event(
        db, "info", f"Admin note added to {subject_type} {subject_id}",
        request_id=current_request_id(),
        metadata={
            "event": "admin_note_added",
            "actor_id": author_id,
            "actor_type": "admin",
            "subject_type": subject_type,
            "subject_id": subject_id,
            "outcome": "success",
            "source": "admin",
            "note_id": note.id,
        },
    )
    await db.commit()
    await db.refresh(note)
    author = await db.get(Account, author_id)
    return {"id": note.id, "body": note.body, "author_email": author.email if author else None, "created_at": note.created_at}
