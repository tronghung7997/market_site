"""Standalone mock TopProxy.vn backend.

Giả lập ĐÚNG wire format của TopProxy theo tài liệu chính thức (xem
docs/superpowers/specs/2026-07-23-topproxy-research.md): auth bằng query param
`key`, envelope `{"status": <int>}` với 100/101/102/103/104/201, endpoint PHP
GET/POST. TopProxyAdapter (src/adapters/topproxy.py) nói chuyện với process
này y hệt như với topproxy.vn thật — đổi sang thật chỉ là sửa base_url +
api_key trên provider row, không sửa code (nguyên tắc "mock at the HTTP
layer", như scripts/mock_seller.py và scripts/mock_dproxy.py).

Run:
    cd marketplace-svc
    uv run uvicorn scripts.mock_topproxy:app --port 9300 --reload

Provider mẫu do scripts/seed_topproxy.py tạo sẵn trỏ vào cổng 9300.

Mô phỏng có chủ đích:
- Số dư Xu (mặc định 1.000.000, chỉnh bằng env MOCK_TOPPROXY_XU) — mua trừ
  dần, hết → status 102 (đường alert "hết Xu" có thật để test).
- Tồn kho hữu hạn cho vài loại (Private/Datacenter riêng) → status 103.
- Key sai → status 101.
"""
import os
import random
import secrets
import time
import uuid
from datetime import datetime

import uvicorn
from fastapi import FastAPI, Request

MOCK_KEY = os.environ.get("MOCK_TOPPROXY_KEY", "mock-topproxy-key")
START_XU = int(os.environ.get("MOCK_TOPPROXY_XU", "1000000"))

# Giá vốn Xu/30 ngày cho 1 đơn vị — trùng bảng giá niêm yết trên site lúc
# nghiên cứu (tài liệu research §4).
PRICES_30D = {
    "Viettel": 14400, "FPT": 14400, "VNPT": 14400,
    "US": 4800,
    "DatacenterA": 28800, "DatacenterB": 19200, "DatacenterC": 9600,
    "GoiViettel": 675000, "GoiVNPT": 675000, "GoiFPT": 675000, "GoiDATACENTER": 480000,
    "4Gvinaphone": 15000,
}
XOAY_PRICES = {"ngay": 2500, "tuan": 14000, "thang": 45000}
STOCK = {"DatacenterA": 5}  # loại nào không có trong đây = không giới hạn

app = FastAPI(title="Mock TopProxy")

_state = {"xu": START_XU}
_proxies: dict[int, dict] = {}
# idproxy phải KHÔNG lặp lại qua các lần restart mock: proxy_allocations bên
# marketplace persist trong Postgres với UNIQUE(provider_id, external_id) —
# counter reset về hằng số sẽ cấp lại id cũ và làm bind nổ IntegrityError
# (TopProxy thật cấp id tăng dần, không có vấn đề này).
_next_id = {"v": int(time.time())}
_keys: dict[str, dict] = {}


def _log(tag: str, **fields) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    extra = " ".join(f"{k}={v!r}" for k, v in fields.items())
    print(f"[mock-topproxy {ts}] {tag} {extra} (xu còn {_state['xu']})", flush=True)


async def _params(request: Request) -> dict:
    """TopProxy nhận cả GET query lẫn POST form — gộp về một dict."""
    p = dict(request.query_params)
    if request.method == "POST":
        try:
            form = await request.form()
            p.update({k: str(v) for k, v in form.items()})
        except Exception:
            pass
    return p


def _check_key(p: dict) -> bool:
    return p.get("key") == MOCK_KEY


def _rand_ip() -> str:
    return f"27.73.{random.randint(1, 254)}.{random.randint(1, 254)}"


@app.api_route("/apiv2/muaproxy.php", methods=["GET", "POST"])
async def muaproxy(request: Request):
    p = await _params(request)
    if not _check_key(p):
        return {"status": 101}
    loaiproxy = p.get("loaiproxy", "")
    if loaiproxy not in PRICES_30D:
        return {"status": 104}
    if loaiproxy in STOCK and STOCK[loaiproxy] <= 0:
        return {"status": 103}
    try:
        ngay = max(1, int(p.get("ngay", "30")))
        soluong = max(1, int(p.get("soluong", "1")))
    except ValueError:
        return {"status": 104}
    cost = round(PRICES_30D[loaiproxy] * ngay / 30) * soluong
    if _state["xu"] < cost:
        return {"status": 102}
    _state["xu"] -= cost
    if loaiproxy in STOCK:
        STOCK[loaiproxy] -= 1

    user = p.get("user") or f"u{secrets.token_hex(3)}"
    if user == "Random":
        user = f"u{secrets.token_hex(3)}"
    password = p.get("password") or secrets.token_hex(4)
    if password == "Random":
        password = secrets.token_hex(4)

    idproxy = _next_id["v"]
    _next_id["v"] += 1
    ip, port = _rand_ip(), random.randint(20000, 60000)
    expires = int(time.time()) + ngay * 86400
    _proxies[idproxy] = {
        "idproxy": idproxy, "loaiproxy": loaiproxy, "ip": ip, "port": port,
        "user": user, "password": password, "type": p.get("type", "HTTP"), "time": expires,
    }
    _log("muaproxy", loaiproxy=loaiproxy, idproxy=idproxy, user=user, cost=cost)
    return {
        "status": 100, "loaiproxy": loaiproxy, "idproxy": idproxy,
        "ip": ip, "port": port, "user": user, "password": password,
        "type": p.get("type", "HTTP"), "proxy": f"{ip}:{port}:{user}:{password}",
        "time": expires,
    }


@app.api_route("/apiv2/listproxy.php", methods=["GET", "POST"])
async def listproxy(request: Request):
    p = await _params(request)
    if not _check_key(p):
        return {"status": 101}
    idproxy = p.get("idproxy", "all")
    loaiproxy = p.get("loaiproxy")
    rows = []
    for row in _proxies.values():
        if idproxy != "all" and str(row["idproxy"]) != str(idproxy):
            continue
        if loaiproxy and idproxy == "all" and row["loaiproxy"] != loaiproxy:
            continue
        rows.append({
            "status": 100, "idproxy": row["idproxy"], "ip": row["ip"],
            "proxy": f"{row['ip']}:{row['port']}:{row['user']}:{row['password']}",
            "type": row["type"], "time": row["time"],
        })
    _log("listproxy", loaiproxy=loaiproxy, idproxy=idproxy, rows=len(rows))
    return rows


@app.api_route("/apiv2/doibaomat.php", methods=["GET", "POST"])
async def doibaomat(request: Request):
    p = await _params(request)
    if not _check_key(p):
        return {"status": 101}
    try:
        idproxy = int(p.get("idproxy", "0"))
    except ValueError:
        return {"status": 101}
    row = _proxies.get(idproxy)
    if not row:
        return {"status": 101}
    row["user"] = p.get("user") or row["user"]
    row["password"] = p.get("password") or row["password"]
    _log("doibaomat", idproxy=idproxy)
    return {
        "status": 100, "loaiproxy": row["loaiproxy"], "idproxy": idproxy,
        "ip": row["ip"], "port": row["port"], "user": row["user"],
        "password": row["password"], "type": row["type"],
        "proxy": f"{row['ip']}:{row['port']}:{row['user']}:{row['password']}",
    }


@app.api_route("/apiv2/giahanproxy.php", methods=["GET", "POST"])
async def giahanproxy(request: Request):
    p = await _params(request)
    if not _check_key(p):
        return {"status": 101}
    try:
        idproxy = int(p.get("idproxy", "0"))
        ngay = max(1, int(p.get("ngay", "30")))
    except ValueError:
        return {"status": 104}
    row = _proxies.get(idproxy)
    if not row:
        return {"status": 104}
    cost = round(PRICES_30D.get(row["loaiproxy"], 14400) * ngay / 30)
    if _state["xu"] < cost:
        return {"status": 102}
    _state["xu"] -= cost
    row["time"] += ngay * 86400
    _log("giahan", idproxy=idproxy, ngay=ngay, cost=cost)
    return {"status": 100, "idproxy": idproxy, "time": row["time"]}


# ---------------------------------------------------------------------------
# Proxy xoay — mua/gia hạn/list key bằng master key, get proxy bằng key xoay
# ---------------------------------------------------------------------------


def _mua_keyxoay(p: dict, ky: str, unit_days: int):
    if not _check_key(p):
        return {"status": 101}
    try:
        thoigian = max(1, int(p.get("thoigian", "1")))
    except ValueError:
        return {"status": 104}
    cost = XOAY_PRICES[ky] * thoigian
    if _state["xu"] < cost:
        return {"status": 102}
    _state["xu"] -= cost
    keyxoay = secrets.token_urlsafe(16).replace("-", "").replace("_", "")[:22]
    _keys[keyxoay] = {"expires": time.time() + unit_days * thoigian * 86400, "ky": ky}
    _log("mua_keyxoay", ky=ky, thoigian=thoigian, keyxoay=keyxoay, cost=cost)
    return {"status": 100, "keyxoay": keyxoay}


@app.api_route("/proxyxoay/apimuangay.php", methods=["GET", "POST"])
async def apimuangay(request: Request):
    return _mua_keyxoay(await _params(request), "ngay", 1)


@app.api_route("/proxyxoay/apimuatuan.php", methods=["GET", "POST"])
async def apimuatuan(request: Request):
    return _mua_keyxoay(await _params(request), "tuan", 7)


@app.api_route("/proxyxoay/apimuathang.php", methods=["GET", "POST"])
async def apimuathang(request: Request):
    return _mua_keyxoay(await _params(request), "thang", 30)


@app.api_route("/proxyxoay/apigetkeyxoay.php", methods=["GET", "POST"])
async def apigetkeyxoay(request: Request):
    p = await _params(request)
    if not _check_key(p):
        return {"status": 101}
    alive = {k: v for k, v in _keys.items() if v["expires"] > time.time()}
    if not alive:
        return {"status": 100, "keyxoay": "", "expired": ""}
    # Tài liệu thật trả object 1 key — mock trả key mới nhất, đủ cho health check.
    k, v = list(alive.items())[-1]
    return {
        "status": 100, "keyxoay": k,
        "expired": datetime.fromtimestamp(v["expires"]).strftime("%H:%M %d-%m-%y"),
    }


@app.api_route("/api/get.php", methods=["GET", "POST"])
async def get_proxy_xoay(request: Request):
    """proxyxoay.shop/api/get.php — buyer gọi bằng keyxoay. Trong dev,
    provider config `xoay_get_url` trỏ vào đây."""
    p = await _params(request)
    key = p.get("key", "")
    info = _keys.get(key)
    if not info or info["expires"] <= time.time():
        return {"status": 101, "message": "key khong ton tai hoac het han"}
    ip, port = _rand_ip(), random.randint(10000, 40000)
    nhamang = p.get("nhamang", "Random")
    if nhamang == "Random":
        nhamang = random.choice(["viettel", "fpt", "vnpt"])
    ttl = random.randint(900, 1800)
    _log("get_xoay", key=key[:8] + "...", nhamang=nhamang)
    return {
        "status": 100,
        "message": f"proxy nay se die sau {ttl}s",
        "proxyhttp": f"{ip}:{port}::",
        "proxysocks5": f"{ip}:{port + 10000}::",
        "Nha Mang": nhamang,
        "Vi Tri": random.choice(["HaNoi1", "HCM2", "DaNang1"]),
        "Token expiration date": datetime.fromtimestamp(info["expires"]).strftime("%H:%M %d-%m-%Y"),
    }


if __name__ == "__main__":
    port = int(os.environ.get("MOCK_TOPPROXY_PORT", "9300"))
    print(
        f"Mock TopProxy listening on :{port} — provider config: "
        f"base_url=http://127.0.0.1:{port}, api_key={MOCK_KEY!r}, "
        f"xoay_get_url=http://127.0.0.1:{port}/api/get.php"
    )
    uvicorn.run(app, host="0.0.0.0", port=port)
