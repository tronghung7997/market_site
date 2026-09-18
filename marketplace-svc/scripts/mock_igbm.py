"""Mock igbm.net — đúng wire format đã probe bằng key thật 2026-09-17
(docs/superpowers/specs/2026-09-17-igbm-reseller-research.md §1–2).

    uv run uvicorn scripts.mock_igbm:app --port 9400

Điểm cố ý giữ giống thật:
- `api_key` qua query/form; sai key → profile: "API Key không hợp lệ",
  buy: "Vui lòng đăng nhập".
- products.php trả id/price/min/max dạng STRING, product.php trả INT.
- Thứ tự check khi mua: key → action → id → amount → số dư → tồn kho.
- Mua thành công: trừ tiền, trừ tồn, trả `trans_id` + `data[]`.

Điều khiển kịch bản (chỉ mock): `POST /__mock/state` JSON
    {"balance": 7200, "stock": {"145883": 0}, "fail_mode": "timeout"|"http500"|"garbage"|null}
`fail_mode` áp cho lệnh MUA kế tiếp rồi tự tắt — để diễn ca "mua không rõ
kết quả" (timeout thì mock VẪN trừ tiền để giả lập tiền đã đi mà response mất).
"""
from __future__ import annotations

import asyncio
import secrets
from decimal import Decimal
from urllib.parse import parse_qsl

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

API_KEY = "mock-igbm-key"

app = FastAPI(title="mock igbm")

# id → {name, price, amount, description, min, max, category}
CATALOG: dict[str, dict] = {
    "130956": {"name": "H362. Clone Instagram Name US | Đã Qua Reg BM | Reg Android | FULL 2FA",
               "price": 1680, "amount": 16513, "description": "ID | Mật khẩu | 2FA | Cookie",
               "cat": ("Clone Instagram + Threads", "Instagram + Threads")},
    "128630": {"name": "H160. Clone Name Random Nuôi Tương Tác | Reg Trên 1-7 Ngày | FULL 2FA",
               "price": 3920, "amount": 30472, "description": "UID | Password | 2FA | Cookie | Token | Email",
               "cat": ("Facebook", "Clone Việt/Ngoại Nuôi 2025 - 2026 + Reg Tay ANDROID")},
    "146530": {"name": "H292. Clone Name Random Nuôi Tương Tác | Reg Trên 15-30 Ngày | NO2FA",
               "price": 4200, "amount": 22446, "description": "UID | Password | Cookie | Token | Email",
               "cat": ("Facebook", "Clone Việt/Ngoại Nuôi 2025 - 2026 + Reg Tay ANDROID")},
    "128629": {"name": "H159. Clone Name Random Nuôi Tương Tác | Reg Trên 15-30 Ngày | FULL 2FA",
               "price": 4480, "amount": 13429, "description": "UID | Password | 2FA | Cookie | Token | Email",
               "cat": ("Facebook", "Clone Việt/Ngoại Nuôi 2025 - 2026 + Reg Tay ANDROID")},
    "145883": {"name": "H30. Clone Ngoại TUT 2$ / 250$ / Reg BM / Spam | Live Ads | FULL 2FA",
               "price": 2800, "amount": 5026, "description": "UID | Pass | 2FA |Mail",
               "cat": ("Facebook", "Clone Fb Việt/Ngoại + Ngâm Nuôi + TUT $")},
    "59917": {"name": "H14. Clone Name USA Ngâm | Phù Hợp Reg Page + Spam | NO2FA",
              "price": 3358, "amount": 1053, "description": "UID_PASS_COOKIE_TOKEN_MAIL",
              "cat": ("Facebook", "Clone USA Chơi ADS - Nhiều Bạn Bè + Bài Viết")},
    "32749": {"name": "HOTMAIL TRUSTED + MAIL KHÔI PHỤC | LIVE 6-12 THÁNG",
              "price": 280, "amount": 50007, "description": "Mail|Pass|Refresh_Token|Client_id",
              "cat": ("GmaiL Hotmail Outlook", "GmaiL / Hotmail / Outlook")},
    "157393": {"name": "Proxy dân cư VN | 30 Ngày", "price": 2700, "amount": 1375, "description": ".",
               "cat": ("Proxy - IP -  VPN", "Proxy - IP - VPN")},
    "149256": {"name": "Clone Tiktok  South Korea | Năm 2025 | Mail - Oauth2", "price": 2380, "amount": 14408,
               "description": "./", "cat": ("TikTok", "Clone TikTok")},
    "147083": {"name": "H287. Clone X Twitter | Reg Trên 5 Ngày", "price": 2100, "amount": 1566,
               "description": ",.", "cat": ("Twitter", "X Twitter Việt - Ngoại")},
    # hết hàng sẵn — để diễn ca "Số lượng còn lại trong hệ thống không đủ"
    "133947": {"name": "H114. CLONE EU NGÂM IP EU | NO2FA", "price": 4060, "amount": 0,
               "description": "uid|pass|cookie|token| mail|pass|refresh_token|client_id",
               "cat": ("Facebook Các Loại", "EU")},
}

STATE = {"balance": Decimal("10000.00"), "fail_mode": None}
ORDERS: dict[str, list[str]] = {}


def _err(msg: str, status: int = 200) -> JSONResponse:
    return JSONResponse({"status": "error", "msg": msg}, status_code=status)


def _ok(**extra) -> JSONResponse:
    return JSONResponse({"status": "success", "msg": extra.pop("msg", "Lấy dữ liệu thành công!"), **extra})


def _fake_line(pid: str, i: int) -> str:
    uid = 1000000000000 + secrets.randbelow(99999999999)
    fmt = CATALOG[pid]["description"]
    if "Mail|Pass" in fmt:
        return f"mock{uid}@hotmail.com|Pw{secrets.token_hex(3)}|M.C5_{secrets.token_hex(8)}|9e5f94bc-e8a4-4e73-b8be-63364c29d753"
    return f"{uid}|Pw{secrets.token_hex(3)}|{secrets.token_hex(8).upper()}|mock{uid}@any.pink"


@app.get("/api/profile.php")
async def profile(api_key: str = ""):
    if api_key != API_KEY:
        return _err("API Key không hợp lệ")
    return _ok(data={"username": "mockuser", "money": f"{STATE['balance']:.2f}"})


@app.get("/api/products.php")
async def products(api_key: str = ""):
    if api_key != API_KEY:
        return _err("API Key không hợp lệ")
    roots: dict[str, dict] = {}
    subs: dict[tuple[str, str], dict] = {}
    cats: list[dict] = []
    next_id = 1000
    for pid, p in CATALOG.items():
        root, sub = p["cat"]
        if root not in roots:
            next_id += 1
            roots[root] = {"id": str(next_id), "parent_id": 0, "name": root, "icon": None, "products": []}
            cats.append(roots[root])
        if (root, sub) not in subs:
            next_id += 1
            subs[(root, sub)] = {"id": str(next_id), "parent_id": int(roots[root]["id"]), "name": sub,
                                 "icon": None, "products": []}
            cats.append(subs[(root, sub)])
        subs[(root, sub)]["products"].append({
            "id": pid, "name": p["name"], "price": str(p["price"]), "amount": p["amount"],
            "description": p["description"], "flag": None, "min": "1", "max": "1000000",
        })
    return _ok(categories=cats)


@app.get("/api/product.php")
async def product(api_key: str = "", product: str | None = None):
    if api_key != API_KEY:
        return _err("API Key không hợp lệ")
    if product is None:
        return _err("Thiếu product")
    p = CATALOG.get(product)
    if p is None:
        return _ok(product=[])
    return _ok(product=[{
        "id": int(product), "name": p["name"], "price": p["price"], "amount": p["amount"],
        "description": p["description"], "flag": None, "min": 1, "max": 1000000,
    }])


@app.get("/api/order.php")
async def order(api_key: str = "", order: str = ""):
    if api_key != API_KEY:
        return _err("API Key không hợp lệ")
    lines = ORDERS.get(order)
    if lines is None:
        return _err("Đơn hàng không tồn tại")
    return _ok(msg="Lấy đơn hàng thành công!", trans_id=order, data=lines)


@app.api_route("/api/buy_product", methods=["GET", "POST"])
async def buy(request: Request):
    form = dict(request.query_params)
    if request.method == "POST":
        # parse_qsl thay vì request.form(): không kéo thêm python-multipart
        # vào dependency chỉ vì một script mock.
        form.update(dict(parse_qsl((await request.body()).decode("utf-8", "replace"))))
    if form.get("api_key") != API_KEY:
        return _err("Vui lòng đăng nhập")
    action = form.get("action")
    if action is None:
        return _err("The Request Not Found")
    if action != "buyProduct":
        return _err("Request does not exist")
    pid = form.get("id", "")
    if not pid.isdigit():
        return _err("ID sản phẩm không hợp lệ!")
    p = CATALOG.get(pid)
    if p is None:
        return _err("Sản phẩm không tồn tại trong hệ thống")
    try:
        amount = int(form.get("amount", ""))
    except ValueError:
        amount = 0
    if amount < 1:
        return _err("Số lượng không hợp lệ!")
    cost = Decimal(p["price"] * amount)
    if STATE["balance"] < cost:
        return _err("Số dư không đủ, vui lòng nạp thêm")
    if p["amount"] < amount:
        return _err("Số lượng còn lại trong hệ thống không đủ")

    fail_mode, STATE["fail_mode"] = STATE["fail_mode"], None
    # Tiền đi trước response — đúng bản chất ca "timeout mà đã trừ tiền".
    STATE["balance"] -= cost
    p["amount"] -= amount
    trans_id = "MK" + secrets.token_hex(7)
    ORDERS[trans_id] = [_fake_line(pid, i) for i in range(amount)]
    if fail_mode == "timeout":
        await asyncio.sleep(60)
    if fail_mode == "http500":
        return Response("Internal Server Error", status_code=500)
    if fail_mode == "garbage":
        return Response("<html>Cloudflare 520</html>", media_type="text/html")
    return _ok(msg="Tạo đơn hàng thành công!", trans_id=trans_id, data=ORDERS[trans_id])


@app.post("/__mock/state")
async def set_state(body: dict):
    if "balance" in body:
        STATE["balance"] = Decimal(str(body["balance"]))
    for pid, n in (body.get("stock") or {}).items():
        if pid in CATALOG:
            CATALOG[pid]["amount"] = int(n)
    if "fail_mode" in body:
        STATE["fail_mode"] = body["fail_mode"]
    return {"balance": f"{STATE['balance']:.2f}", "fail_mode": STATE["fail_mode"],
            "stock": {pid: p["amount"] for pid, p in CATALOG.items()}}


@app.get("/__mock/state")
async def get_state():
    return {"balance": f"{STATE['balance']:.2f}", "fail_mode": STATE["fail_mode"],
            "stock": {pid: p["amount"] for pid, p in CATALOG.items()}, "orders": len(ORDERS)}
