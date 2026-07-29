"""Bắn một webhook PayOS ĐÃ KÝ ĐÚNG vào backend của chính mình.

Vì sao cần: PayOS chỉ gọi được webhook khi domain có bản ghi DNS công cộng.
Trước khi mở tunnel (hoặc khi cố tình giữ site nội bộ), đây là cách duy nhất
kiểm chứng nửa còn lại của luồng nạp — verify chữ ký, sổ payos_webhook_events,
idempotency, cộng ví — mà không phụ thuộc PayOS gọi vào được.

KHÔNG phải giả lập tiền: script ký bằng đúng PAYOS_CHECKSUM_KEY thật, nên nếu
chữ ký sai (khoá chưa nạp/nạp nhầm) backend sẽ trả 401 — đó cũng là một kết
quả test có giá trị. Chỉ dùng với intent do CHÍNH MÌNH tạo để test.

Chạy TRONG container backend (nơi có env thật):

    # 1. Tạo lệnh nạp trên UI /wallet, lấy orderCode (= id intent) ở /admin/deposits
    # 2. Chuyển khoản thật, hoặc chỉ test đường xử lý webhook:
    docker-compose exec marketplace-svc python scripts/send_payos_webhook.py <orderCode> <amount>

Tuỳ chọn:
    --url http://localhost:8001/webhooks/payos   (mặc định)
    --reference REF     mã tham chiếu giao dịch (mặc định sinh theo orderCode)
    --twice             gửi 2 lần để kiểm chứng idempotency (lần 2 phải "duplicate")
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from src.config import settings  # noqa: E402
from src.payments.payos_client import sign_webhook_data  # noqa: E402


def build_payload(order_code: int, amount: int, reference: str) -> dict:
    # Shape đúng như PayOS gửi thật (docs §webhook) — handle_webhook chỉ đọc
    # paymentLinkId/reference/orderCode/amount/code, phần còn lại để giống thật.
    data = {
        "orderCode": order_code,
        "amount": amount,
        "description": f"NAP {order_code}",
        "accountNumber": "0000000000",
        "reference": reference,
        "transactionDateTime": "2026-07-29 10:00:00",
        "currency": "VND",
        "paymentLinkId": f"test-link-{order_code}",
        "code": "00",
        "desc": "success",
        "counterAccountBankId": None,
        "counterAccountName": None,
        "counterAccountNumber": None,
        "virtualAccountName": None,
        "virtualAccountNumber": None,
    }
    return {"code": "00", "desc": "success", "data": data, "signature": sign_webhook_data(data)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("order_code", type=int, help="orderCode = id của DepositIntent")
    ap.add_argument("amount", type=int, help="số tiền (đồng), phải khớp intent")
    ap.add_argument("--url", default="http://localhost:8001/webhooks/payos")
    ap.add_argument("--reference", default=None)
    ap.add_argument("--twice", action="store_true", help="gửi 2 lần để test idempotency")
    args = ap.parse_args()

    if not settings.payos_checksum_key:
        print("PAYOS_CHECKSUM_KEY chưa được nạp vào tiến trình này — chạy trong container backend.")
        return 1

    reference = args.reference or f"TEST{args.order_code}"
    payload = build_payload(args.order_code, args.amount, reference)

    rounds = 2 if args.twice else 1
    for i in range(1, rounds + 1):
        resp = httpx.post(args.url, json=payload, timeout=15.0)
        print(f"[lần {i}] HTTP {resp.status_code} {resp.text}")
        if resp.status_code == 401:
            print("→ Sai chữ ký: PAYOS_CHECKSUM_KEY trong container khác khoá dùng để ký.")
            return 1
    if args.twice:
        print("Kỳ vọng: lần 1 xử lý, lần 2 trả note 'duplicate' (idempotency theo paymentLinkId+reference).")
    print(json.dumps({"order_code": args.order_code, "reference": reference}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
