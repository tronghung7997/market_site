# Warranty, return, and refund contract

This document describes the implemented digital-goods workflow. “Return” means
the affected delivered resource is invalidated (`error`) before replacement or
refund; Proxora does not implement physical reverse shipping.

## Lifecycle checklist

- [x] Buyer may open a case only for their delivered order and before escrow expiry.
- [x] Buyer may claim one, many, or all affected resources, up to 2,000 per request.
- [x] Duplicate resources and resources from another order are rejected.
- [x] Buyer may append later claim batches and case messages while the case is open.
- [x] Seller sees the buyer reason, evidence, affected resources, and pending/resolved counts.
- [x] Seller may respond, replace claimed instant-inventory resources, refund them, or escalate.
- [x] Seller cannot remedy an unclaimed resource or another seller's order.
- [x] Buyer can accept only after every claimed resource has a remedy, or after a seller response for a whole-order case.
- [x] Admin may reject, fully refund, partially refund, replace, or extend warranty.
- [x] Cancelled, refunded, and resolved cases cannot be mutated through the open-case paths.
- [x] Buyer and seller actions use idempotency keys; concurrent final decisions settle once.

## Escrow and seller payment checklist

- [x] Each delivered resource receives an immutable share of the order escrow for safe per-resource refunds.
- [x] Every refund increments `orders.refunded_amount` and credits the buyer once.
- [x] Final seller settlement is always `total_amount - refunded_amount`.
- [x] Platform fee and affiliate commission are calculated from that same remaining amount.
- [x] A full refund pays the seller nothing and claws back an existing affiliate commission.
- [x] Replacement without refund leaves the full remaining escrow payable to the seller.
- [x] Buyer acceptance, admin resolution, manual confirmation, automatic escrow expiry, unanswered seller-offer timeout, and abandoned-case timeout use the same settlement calculation.
- [x] An untouched open case cannot hold escrow after the original deadline plus a buyer-silence grace; remaining escrow then goes to the seller (`resolved_abandoned`). A seller note is not a remedy. A resource remedy or an armed buyer-response deadline uses the existing offer-timeout path instead.
- [x] Purchase release and platform fee transactions are idempotent per order.

## Large-order UX checklist

- [x] Buyer can search and select all matching unclaimed resources across pagination.
- [x] Buyer can see the selected count and clear the selection before submitting.
- [x] Per-resource warranty action remains visible and touchable on mobile.
- [x] Seller can search affected resources and works with a paginated 100-row view.
- [x] Seller can select and resolve up to 2,000 affected resources atomically.
- [x] Buyer sees the case timeline, seller response, replacements, and refund events.
- [x] Buyer receives an explicit warning that accepting releases remaining escrow to the seller.

## Settlement examples

| Outcome | Buyer refund | Seller settlement base |
|---|---:|---:|
| All resources accepted/replaced | 0 | Full order total |
| 500 of 2,000 equal-price resources refunded | 25% of total | 75% of total |
| Admin partial refund | Approved refund amount | Total minus all refunds |
| Full refund | Full remaining escrow | 0 |

Platform fee is deducted from the seller settlement base. It is never charged
against the amount returned to the buyer.
