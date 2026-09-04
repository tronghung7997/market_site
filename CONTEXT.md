# Chat domain context

## Purpose and status

This file is the domain contract for the **currently implemented chat MVP only**. It is not a general architecture document and not a product roadmap.

When this file conflicts with executable behavior, use these sources in order and update this file in the same change:

1. database constraints in `marketplace-svc/src/models/chat.py` and Alembic migrations;
2. authorization and lifecycle behavior in `marketplace-svc/src/chat/`;
3. tests in `marketplace-svc/tests/test_chat_inquiries.py` and `test_chat_orders.py`;
4. frontend types and callers under `frontend/lib/`, `frontend/hooks/`, and `frontend/components/chat/`.

A prototype under `frontend/app/[locale]/prototype/chat/` is visual exploration, not implemented product behavior.

## Implemented vocabulary

- **Conversation (hội thoại):** Transcript scoped to a marketplace context. Implemented kinds are product inquiry, order conversation, and Marketplace support (dispute review).
- **Product inquiry (trao đổi trước mua):** Conversation opened by a buyer against one active product and that product's seller. It includes the buyer's initial message.
- **Order conversation (chat đơn hàng):** Conversation shared only by the buyer and seller of one order.
- **Marketplace support:** Conversation between a dispute party (buyer or seller) and Marketplace admins, scoped to one open dispute/order. The requester counterpart label is `Marketplace`. Buyer and seller each get their own thread; they do not share it. Admins list threads at `/admin/support`.
- **Participant:** An account represented by a `ChatParticipant` row. Reading and sending require membership, except admins may open `support` conversations and are joined on first access.
- **Context role:** The participant's role inside the conversation: `buyer` or `seller` in product/order chats, and `admin` in Marketplace support. It must come from the participant row, not be inferred from the account's global role list.
- **Read cursor:** `last_read_message_id` for one participant. Opening conversation detail advances it to the latest returned message and unread counts are calculated from it.
- **Client message ID:** Client-generated UUID used as an idempotency key within a conversation.
- **Read-only conversation:** A conversation that cannot accept messages. Order conversations become effectively read-only when the order is cancelled or refunded.
- **Safe counterpart:** The API response exposes an ID, display label, and context role rather than a raw email field. Current seller-label fallback may derive a label from the local part of the seller email; changing this requires an explicit privacy decision and tests.

## Implemented invariants

- A seller cannot open a product inquiry for their own product.
- At most one product inquiry exists for `(buyer, seller, product)`; reopening reuses the existing conversation.
- At most one order conversation exists per order; calls by either order party reuse it.
- Only the order's buyer or seller may create/access its order conversation.
- Conversation access requires a matching participant row, except an admin may open a `support` conversation and is joined as `admin` on first access. Other non-participants receive a non-enumerating not-found response.
- Product inquiry and order conversation transcripts are separate. There is no implemented source-inquiry link or transcript merge.
- User messages are trimmed plain text from 1 to 4000 characters. Attachments, editing, and deletion are not implemented.
- Reusing a client message ID with the same sender and body returns the existing message; conflicting reuse is rejected.
- A cancelled or refunded order makes its order conversation read-only and sending is rejected. Marketplace support stays open so admin review can continue after the commercial order completes.
- At most one Marketplace support conversation exists for `(order, requester)`; reopening reuses it. Creating it is owned by dispute escalate (`POST /orders/{id}/dispute/escalate` or seller escalate): a required note plus idempotency key pauses auto-settlement (`review_requested_at`) and does not refund escrow. `POST /chat/orders/{id}/support` only reopens an existing thread and does not pause clocks.
- Admins list support conversations with `GET /chat/admin/support`. Non-admins receive 403. The support inbox projection is loaded in one bounded database query, polls as recovery, and active admins receive best-effort chat invalidation when a new review thread is created.
- The list API accepts `perspective=buyer`, `perspective=seller`, or `perspective=all`. Buyer/seller still validate against the account's global roles. `all` returns every non-archived conversation the account participates in, using each participant row's context role. The product inbox is unified at `/messages`; `/seller/messages` redirects there. Admin dispute review is a separate inbox at `/admin/support`.
- Unread counts appear as a non-dismissible action item (`unread_messages`) pointing at `/messages`, so the notification bell can refresh from the same chat events as the inbox.

## Reserved or prototype-only concepts — not implemented

The schema, frontend types, or visual prototype may mention the following, but agents must not assume product behavior exists:

- creating, assigning, resolving, or closing generic support cases unrelated to an open dispute;
- admin participation in ordinary product-inquiry or order conversations;
- conversation reports or moderation queues;
- participant/admin block and archive controls;
- system-authored lifecycle messages;
- next-action ownership or SLA workflow;
- source inquiry linkage from an order conversation;
- attachment, edit, delete, pagination beyond the current fixed query limits.

Implementing any item above requires an explicit product specification, backend authorization rules, schema/migration changes where needed, API tests, synchronized frontend types/UI, and an update to this file. Enum values or prototype screens alone are not acceptance criteria.
