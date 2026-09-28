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

- **Conversation (hội thoại):** Transcript scoped to a marketplace context. Implemented kinds are product inquiry, order conversation, Marketplace support (dispute review), and helpdesk.
- **Product inquiry (trao đổi trước mua):** Conversation opened by a buyer against one active product and that product's seller. It includes the buyer's initial message.
- **Order conversation (chat đơn hàng):** Conversation shared only by the buyer and seller of one order.
- **Marketplace support:** Conversation between a dispute party (buyer or seller) and Marketplace admins, scoped to one open dispute/order. The requester counterpart label is `Marketplace`. Buyer and seller each get their own thread; they do not share it. Admins list threads at `/admin/support`.
- **Helpdesk (chat với GMMO):** A standing conversation between an account and the Marketplace desk, not tied to an order (`kind = 'helpdesk'`, `requester_id` set, `order_id` null). Every account has at most a buyer thread, and a seller account also a separate shop thread; the side is the conversation's `requester_role` (`buyer` or `seller`), chosen by `?role=` on `GET /chat/helpdesk` and `POST /chat/helpdesk/messages` (default `buyer`). A thread is opened by the account's first message for that role from the storefront "Chat với GMMO" button and reused forever after; it has no topic, assignment or resolved state. The counterpart the requester sees is `Marketplace`; admins see the shop name on a shop thread and the email local part on a buyer thread. Conversation payloads carry `viewer_role`, the caller's side of the room, which is how clients tell a seller's two threads apart.
- **Participant:** An account represented by a `ChatParticipant` row. Reading and sending require membership, except admins may open `support` conversations and are joined on first access.
- **Context role:** The participant's role inside the conversation: `buyer` or `seller` in product/order chats, and `admin` in Marketplace support. It must come from the participant row, not be inferred from the account's global role list.
- **Read cursor:** `last_read_message_id` for one participant. Opening the newest conversation page advances it to the latest returned message and unread counts are calculated from it. Transcript pages contain the newest 50 messages and use `before_id`/`next_cursor` keyset pagination for older messages.
- **Client message ID:** Client-generated UUID used as an idempotency key within a conversation.
- **Read-only conversation:** A conversation that cannot accept messages. Order conversations become effectively read-only when the order is cancelled or refunded.
- **Safe counterpart:** The API response exposes the counterpart's public key (`accounts.public_key`, `"marketplace"` for the support desk), a display label, and a context role — never the sequential account id or a raw email field. Current seller-label fallback may derive a label from the local part of the seller email; changing this requires an explicit privacy decision and tests.

## Implemented invariants

- A seller cannot open a product inquiry for their own product.
- At most one product inquiry exists for `(buyer, seller, product)`; reopening reuses the existing conversation.
- At most one order conversation exists per order; calls by either order party reuse it.
- Only the order's buyer or seller may create/access its order conversation.
- Conversation access requires a matching participant row, except an admin may open a `support` conversation and is joined as `admin` on first access. Other non-participants receive a non-enumerating not-found response.
- Product inquiry and order conversation transcripts are separate. There is no implemented source-inquiry link or transcript merge.
- User messages are trimmed plain text up to 4000 characters plus up to 4 image attachments; a message needs text, images, or both. Attachments are the sender's own `chat_attachment` uploads (`POST /media/uploads`), re-encoded to WebP and stored as private media; they are served only by `GET /chat/conversations/{id}/attachments/{media_id}` to participants and to admins (read-only, for dispute review). Editing and deletion are not implemented.
- Reusing a client message ID with the same sender, body and attachments returns the existing message; conflicting reuse is rejected.
- A cancelled or refunded order makes its order conversation read-only and sending is rejected. Marketplace support stays open so admin review can continue after the commercial order completes.
- At most one Marketplace support conversation exists for `(order, requester)`; reopening reuses it. Creating it is owned by dispute escalate (`POST /orders/{id}/dispute/escalate` or seller escalate): a required note plus idempotency key pauses auto-settlement (`review_requested_at`) and does not refund escrow. `POST /chat/orders/{id}/support` only reopens an existing thread and does not pause clocks.
- At most one helpdesk conversation exists per account and role (`uq_chat_helpdesk_requester` on `requester_id, requester_role`); concurrent first messages reuse it. `GET /chat/helpdesk?role=` returns it (null before the first message) and marks it read, so the storefront launcher reads its unread badges from the conversation list instead. Admin accounts cannot open one (`CHAT_HELPDESK_UNAVAILABLE`); only seller accounts have the shop thread (`CHAT_HELPDESK_SELLER_ONLY`, 403 for reading or writing). Any admin may open a helpdesk thread and is joined as `admin` on first access, as with dispute support; every customer message in it notifies all active admins' streams. `admin_helpdesk_waiting` counts helpdesk threads whose newest message is not from an admin. Helpdesk and dispute-support text, both ways, skip the off-platform contact filter.
- Admins list support conversations with `GET /chat/admin/support`, which returns dispute-support and helpdesk threads together. Non-admins receive 403. The support inbox projection is loaded in one bounded database query, polls as recovery, and active admins receive best-effort chat invalidation when a new review thread is created.
- The list API accepts `perspective=buyer`, `perspective=seller`, or `perspective=all`. Buyer/seller still validate against the account's global roles. `all` returns every non-archived conversation the account participates in, using each participant row's context role. The product inbox is unified at `/messages`; `/seller/messages` redirects there. Admin dispute review is a separate inbox at `/admin/support`.
- Unread counts appear as a non-dismissible action item (`unread_messages`) pointing at `/messages`, so the notification bell can refresh from the same chat events as the inbox.
- A new message (and a buyer's first inquiry) also writes a notification for the other side in the same transaction: one unread `notifications` row per thread (`kind = chat_message`, `collapse_key = chat:{conversation_id}`), bumped with a message count by later messages and marked read when that participant opens the thread. A desk reply notifies the requester; a customer's message to the desk notifies no admin (the desk queue and `admin_helpdesk_waiting` cover it). Notification text is rendered by the client; the row carries only who wrote (`shop`, `buyer`, `desk`) and the shop's approved name.
- A seller who connected their own Telegram bot (`seller_telegram`, switch `chat_messages`, on by default) gets the text of buyer messages in product-inquiry and order conversations forwarded to their linked Telegram chats: only messages the seller has not read, at most one round-up per 10 minutes, labelled `Khách hàng #<public_key>` like the inbox, images shown as a count, never desk or dispute-support threads. Telegram is outside retention and deletion; turning the switch off or disconnecting stops future forwarding only.
- Chat retention runs in bounded batches. Inactive product inquiries and terminal order chats expire after 30 days; Marketplace support expires 90 days after its dispute resolves; helpdesk messages expire individually 90 days after they were sent. Open disputes and each conversation's final preview message are retained. Dispute timeline/audit records are outside chat retention. Images of purged messages are detached and deleted by the media garbage collector after its grace period.
- The admin dispute case file includes the buyer↔seller order conversation (last 200 messages, with attachments) read-only; this is not admin participation in the conversation.

## Reserved or prototype-only concepts — not implemented

The schema, frontend types, or visual prototype may mention the following, but agents must not assume product behavior exists:

- assigning, resolving, or closing helpdesk threads, topics or tickets, or more than one helpdesk thread per account and role;
- admin participation in ordinary product-inquiry or order conversations;
- conversation reports or moderation queues;
- participant/admin block and archive controls;
- system-authored lifecycle messages;
- next-action ownership or SLA workflow;
- source inquiry linkage from an order conversation;
- non-image attachments (files, archives, video), edit, or user-triggered deletion.

Implementing any item above requires an explicit product specification, backend authorization rules, schema/migration changes where needed, API tests, synchronized frontend types/UI, and an update to this file. Enum values or prototype screens alone are not acceptance criteria.
