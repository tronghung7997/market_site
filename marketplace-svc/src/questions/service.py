"""Buyer-asked product questions.

A question is private to its asker and the product's seller until the seller
answers; answered, visible questions are public on the product page. Both
texts go through the off-platform contact filter. The seller may hide a
question on their own product; an admin may hide any, and an admin hide
cannot be lifted by the seller.
"""
from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.content_filter import screen_text
from src.exceptions import ErrorCode, api_error
from src.i18n.slug import canonical_path
from src.models.account import Account
from src.models.product import Product, ProductStatus
from src.models.question import ProductQuestion
from src.reviews.service import mask_reviewer

PRODUCT_PATH_PREFIX = "/products"
# Unanswered questions one account may have open at once, marketplace-wide.
MAX_PENDING_PER_ASKER = 5
# Questions one account may ask per rolling day.
MAX_PER_DAY = 20
PUBLIC_PAGE_SIZE = 10


async def _active_product(product_id: int, db: AsyncSession) -> Product:
    product = await db.get(Product, product_id)
    if product is None or product.status != ProductStatus.active:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return product


async def ask(account: Account, product_id: int, text: str, db: AsyncSession) -> ProductQuestion:
    product = await _active_product(product_id, db)
    if product.seller_id == account.id:
        raise api_error(ErrorCode.QUESTION_SELF, status.HTTP_400_BAD_REQUEST)
    pending = await db.scalar(
        select(func.count(ProductQuestion.id)).where(
            ProductQuestion.asker_id == account.id, ProductQuestion.status == "pending",
        )
    ) or 0
    today = await db.scalar(
        select(func.count(ProductQuestion.id)).where(
            ProductQuestion.asker_id == account.id,
            ProductQuestion.created_at >= datetime.now(timezone.utc) - timedelta(days=1),
        )
    ) or 0
    if pending >= MAX_PENDING_PER_ASKER or today >= MAX_PER_DAY:
        raise api_error(ErrorCode.QUESTION_LIMIT, status.HTTP_429_TOO_MANY_REQUESTS)
    text = await screen_text(db, text, actor_id=account.id, context="product_question", subject_id=str(product.id))
    row = ProductQuestion(product_id=product.id, asker_id=account.id, question=text)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def public_questions(product_id: int, db: AsyncSession, *, page: int = 1, per_page: int = PUBLIC_PAGE_SIZE) -> dict:
    await _active_product(product_id, db)
    visible = (ProductQuestion.product_id == product_id, ProductQuestion.status == "answered")
    total = await db.scalar(select(func.count(ProductQuestion.id)).where(*visible)) or 0
    rows = (await db.execute(
        select(ProductQuestion, Account.email)
        .join(Account, Account.id == ProductQuestion.asker_id)
        .where(*visible)
        .order_by(ProductQuestion.answered_at.desc(), ProductQuestion.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )).all()
    return {
        "items": [
            {
                "id": q.id, "question": q.question, "answer": q.answer, "asker_label": mask_reviewer(email),
                "created_at": q.created_at, "answered_at": q.answered_at,
            }
            for q, email in rows
        ],
        "total": int(total), "page": page, "per_page": per_page,
    }


async def my_questions(account: Account, product_id: int, db: AsyncSession) -> list[ProductQuestion]:
    return list((await db.scalars(
        select(ProductQuestion)
        .where(ProductQuestion.product_id == product_id, ProductQuestion.asker_id == account.id)
        .order_by(ProductQuestion.created_at.desc())
        .limit(20)
    )).all())


def _seller_row(q: ProductQuestion, product: Product, email: str | None) -> dict:
    return {
        "id": q.id, "product_id": product.id, "product_title": product.title,
        "product_path": canonical_path(PRODUCT_PATH_PREFIX, product.slug, product.public_key),
        "question": q.question, "answer": q.answer, "status": q.status, "hidden_by": q.hidden_by,
        "asker_label": mask_reviewer(email), "created_at": q.created_at, "answered_at": q.answered_at,
    }


async def _list(filters: list, db: AsyncSession, *, status_filter: str, page: int, per_page: int) -> dict:
    where = list(filters)
    if status_filter != "all":
        where.append(ProductQuestion.status == status_filter)
    total = await db.scalar(
        select(func.count(ProductQuestion.id)).join(Product, Product.id == ProductQuestion.product_id).where(*where)
    ) or 0
    pending = await db.scalar(
        select(func.count(ProductQuestion.id)).join(Product, Product.id == ProductQuestion.product_id)
        .where(*filters, ProductQuestion.status == "pending")
    ) or 0
    rows = (await db.execute(
        select(ProductQuestion, Product, Account.email)
        .join(Product, Product.id == ProductQuestion.product_id)
        .join(Account, Account.id == ProductQuestion.asker_id)
        .where(*where)
        # Unanswered first, oldest first among them, so nothing waits forever.
        .order_by((ProductQuestion.status != "pending"), ProductQuestion.created_at.asc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )).all()
    return {
        "items": [_seller_row(q, product, email) for q, product, email in rows],
        "total": int(total), "page": page, "per_page": per_page, "pending": int(pending),
    }


async def seller_questions(seller_id: int, db: AsyncSession, *, status_filter: str, page: int, per_page: int) -> dict:
    return await _list([Product.seller_id == seller_id], db, status_filter=status_filter, page=page, per_page=per_page)


async def admin_questions(db: AsyncSession, *, status_filter: str, page: int, per_page: int) -> dict:
    return await _list([], db, status_filter=status_filter, page=page, per_page=per_page)


async def seller_pending_count(seller_id: int, db: AsyncSession) -> int:
    """Same definition as the Hỏi đáp console's pending badge (every product of
    the shop), so the menu count and the list never disagree."""
    return int(await db.scalar(
        select(func.count(ProductQuestion.id))
        .join(Product, Product.id == ProductQuestion.product_id)
        .where(Product.seller_id == seller_id, ProductQuestion.status == "pending")
    ) or 0)


async def _seller_question(seller_id: int, question_id: int, db: AsyncSession) -> tuple[ProductQuestion, Product]:
    q = await db.get(ProductQuestion, question_id, with_for_update=True)
    product = await db.get(Product, q.product_id) if q else None
    # Another seller's question answers 404, like a missing one.
    if q is None or product is None or product.seller_id != seller_id:
        raise api_error(ErrorCode.QUESTION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return q, product


async def answer(seller: Account, question_id: int, text: str, db: AsyncSession) -> dict:
    from src.alerts.service import add_alert

    q, product = await _seller_question(seller.id, question_id, db)
    text = await screen_text(db, text, actor_id=seller.id, context="product_answer", subject_id=str(q.id))
    first_answer = q.answer is None
    q.answer = text
    q.answered_at = datetime.now(timezone.utc)
    if q.status == "pending":
        q.status = "answered"
    if first_answer:
        await add_alert(
            db, type_="product_question_answered", severity="info", target_type="buyer", target_id=q.asker_id,
            message=f"Shop đã trả lời câu hỏi của bạn về “{product.title}”.",
            href=f"{canonical_path(PRODUCT_PATH_PREFIX, product.slug, product.public_key)}#qa",
        )
        from src.notifications.history import notify
        await notify(
            db, q.asker_id, "question_answered", category="message", params={"product": product.title},
            href=f"{canonical_path(PRODUCT_PATH_PREFIX, product.slug, product.public_key)}#qa",
        )
    await db.commit()
    email = await db.scalar(select(Account.email).where(Account.id == q.asker_id))
    return _seller_row(q, product, email)


async def _set_hidden(q: ProductQuestion, hidden: bool, by: str) -> None:
    if hidden:
        q.status = "hidden"
        q.hidden_by = by
    else:
        q.status = "answered" if q.answer else "pending"
        q.hidden_by = None


async def seller_set_visibility(seller: Account, question_id: int, hidden: bool, db: AsyncSession) -> dict:
    q, product = await _seller_question(seller.id, question_id, db)
    if q.hidden_by == "admin":
        raise api_error(ErrorCode.QUESTION_HIDDEN_BY_ADMIN, status.HTTP_403_FORBIDDEN)
    await _set_hidden(q, hidden, "seller")
    await db.commit()
    email = await db.scalar(select(Account.email).where(Account.id == q.asker_id))
    return _seller_row(q, product, email)


async def admin_set_visibility(admin: Account, question_id: int, hidden: bool, db: AsyncSession) -> dict:
    from src.audit.service import log_event
    from src.logging import current_request_id

    q = await db.get(ProductQuestion, question_id, with_for_update=True)
    if q is None:
        raise api_error(ErrorCode.QUESTION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    product = await db.get(Product, q.product_id)
    await _set_hidden(q, hidden, "admin")
    await log_event(
        db, "info", f"Product question {q.id} {'hidden' if hidden else 'restored'} by admin",
        request_id=current_request_id(),
        metadata={
            "event": "product_question_visibility", "actor_id": admin.id, "actor_type": "admin",
            "subject_type": "product_question", "subject_id": q.id, "outcome": "success",
            "source": "admin", "hidden": hidden,
        },
    )
    await db.commit()
    email = await db.scalar(select(Account.email).where(Account.id == q.asker_id))
    return _seller_row(q, product, email)
