import pytest

from src.database import SessionLocal
from src.models.product import Product
from tests.conftest import make_admin, make_seller, register_and_login


async def setup_seller_with_category(client):
    admin_token = await register_and_login(client, "prod_admin@example.com")
    await make_admin("prod_admin@example.com")
    admin_token = await register_and_login(client, "prod_admin@example.com")

    cat = await client.post("/admin/categories", json={"name": "ProdCat", "slug": "prodcat"},
                            headers={"Authorization": f"Bearer {admin_token}"})
    cat_id = cat.json()["id"]

    seller_token = await register_and_login(client, "prod_seller@example.com")
    await make_seller("prod_seller@example.com")
    seller_token = await register_and_login(client, "prod_seller@example.com")

    return seller_token, admin_token, cat_id


@pytest.mark.asyncio
async def test_create_product(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Twitter New", "description": "Best twitter",
        "escrow_days": 3,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 201
    assert resp.json()["title"] == "Twitter New"
    assert resp.json()["escrow_days"] == 3


@pytest.mark.asyncio
async def test_add_variant(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Twitter Variant Test",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    variant = await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Full 2FA + Cookies", "price": 990, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert variant.status_code == 201
    assert variant.json()["price"] == 990
    assert variant.json()["delivery_mode"] == "instant"


@pytest.mark.asyncio
async def test_list_products_public(client):
    resp = await client.get("/products")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["items"], list)
    assert isinstance(body["total"], int)


@pytest.mark.asyncio
async def test_list_items_are_slim_but_detail_is_full(client):
    """Item list không mang mô tả/specs/hoa hồng (payload + leak), nhưng vẫn
    kèm variants + tồn kho; trang chi tiết mới trả bản đầy đủ."""
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Slim Test", "status": "active",
        "description": "Mô tả rất dài " * 100, "specs": {"format": "ID|PASS"},
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]
    await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Gói A", "price": 1000,
    }, headers={"Authorization": f"Bearer {seller_token}"})

    item = next(p for p in (await client.get("/products")).json()["items"] if p["id"] == product_id)
    for heavy in ("description", "specs", "features", "warranty_text", "commission_rate"):
        assert heavy not in item
    assert item["variants"][0]["price"] == 1000

    detail = (await client.get(f"/products/{product_id}")).json()
    assert detail["description"].startswith("Mô tả rất dài")
    assert detail["specs"] == {"format": "ID|PASS"}
    assert "commission_rate" not in detail


@pytest.mark.asyncio
async def test_list_products_pagination(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    for i in range(3):
        await client.post("/seller/products", json={
            "category_id": cat_id, "title": f"Page Test {i}", "status": "active",
        }, headers={"Authorization": f"Bearer {seller_token}"})

    resp = await client.get("/products", params={"page": 1, "per_page": 2})
    body = resp.json()
    assert len(body["items"]) == 2
    assert body["total"] == 3
    assert body["page"] == 1 and body["per_page"] == 2

    page2 = (await client.get("/products", params={"page": 2, "per_page": 2})).json()
    assert len(page2["items"]) == 1
    assert {p["id"] for p in body["items"]}.isdisjoint({p["id"] for p in page2["items"]})


@pytest.mark.asyncio
async def test_list_products_filters_whole_category_subtree(client):
    """?category_id=cha phải ra cả sản phẩm nằm ở danh mục CON — cùng ngữ
    nghĩa subtreeIds() client dùng để lọc tay trước đây."""
    seller_token, admin_token, parent_id = await setup_seller_with_category(client)
    child = await client.post("/admin/categories", json={
        "name": "ChildCat", "slug": "childcat", "parent_id": parent_id,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    child_id = child.json()["id"]
    other = await client.post("/admin/categories", json={
        "name": "OtherCat", "slug": "othercat",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    other_id = other.json()["id"]

    product = await client.post("/seller/products", json={
        "category_id": child_id, "title": "In Child", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    by_parent = (await client.get("/products", params={"category_id": parent_id})).json()
    assert any(p["id"] == product_id for p in by_parent["items"])
    by_child = (await client.get("/products", params={"category_id": child_id})).json()
    assert any(p["id"] == product_id for p in by_child["items"])
    by_other = (await client.get("/products", params={"category_id": other_id})).json()
    assert all(p["id"] != product_id for p in by_other["items"])


@pytest.mark.asyncio
async def test_admin_product_detail_requires_admin(client):
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Admin Only",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    denied = await client.get(f"/admin/products/{product_id}",
                              headers={"Authorization": f"Bearer {seller_token}"})
    assert denied.status_code == 403

    ok = await client.get(f"/admin/products/{product_id}",
                          headers={"Authorization": f"Bearer {admin_token}"})
    assert ok.status_code == 200
    assert "commission_rate" in ok.json()


@pytest.mark.asyncio
async def test_product_detail_includes_variants(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Detail Test", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Variant A", "price": 500,
    }, headers={"Authorization": f"Bearer {seller_token}"})

    resp = await client.get(f"/products/{product_id}")
    assert resp.status_code == 200
    assert len(resp.json()["variants"]) >= 1


@pytest.mark.asyncio
async def test_suspended_product_is_hidden_from_public_storefront(client):
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Hidden Product", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    suspended = await client.post(
        f"/admin/products/{product_id}/suspend",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert suspended.status_code == 200
    assert suspended.json()["status"] == "suspended"

    listing = await client.get("/products")
    assert all(item["id"] != product_id for item in listing.json()["items"])

    detail = await client.get(f"/products/{product_id}")
    assert detail.status_code == 404

    # Management endpoints remain available so the product can be restored.
    seller_detail = await client.get(
        f"/seller/products/{product_id}/detail",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert seller_detail.status_code == 200


@pytest.mark.asyncio
async def test_buyer_cannot_create_product(client):
    buyer_token = await register_and_login(client, "prod_buyer@example.com")
    resp = await client.post("/seller/products", json={
        "category_id": 1, "title": "Nope",
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_seller_cannot_set_commission_rate(client):
    """commission_rate is admin-controlled; seller create/update must ignore it."""
    seller_token, _, cat_id = await setup_seller_with_category(client)
    created = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Commission Product",
        "commission_rate": 7.5,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert created.status_code == 201
    assert created.json()["commission_rate"] is None

    product_id = created.json()["id"]
    updated = await client.patch(f"/seller/products/{product_id}", json={
        "commission_rate": 12.0,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert updated.status_code == 200
    assert updated.json()["commission_rate"] is None


@pytest.mark.asyncio
async def test_admin_sets_product_commission_via_operations(client):
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Commission Update",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]
    assert product.json()["commission_rate"] is None

    resp = await client.put(f"/admin/products/{product_id}/operations", json={
        "commission_rate": 12.0,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200

    # Hoa hồng chỉ còn ở endpoint admin — detail public không phát trường này.
    admin_detail = await client.get(f"/admin/products/{product_id}",
                                    headers={"Authorization": f"Bearer {admin_token}"})
    assert admin_detail.json()["commission_rate"] == 12.0
    assert "commission_rate" not in (await client.get(f"/products/{product_id}")).json()


@pytest.mark.asyncio
async def test_admin_commission_left_untouched_when_omitted(client):
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Commission Keep",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    await client.put(f"/admin/products/{product_id}/operations", json={
        "commission_rate": 9.0,
    }, headers={"Authorization": f"Bearer {admin_token}"})

    # An operations update that omits commission_rate must not wipe it.
    resp = await client.put(f"/admin/products/{product_id}/operations", json={
        "pricing_strategy": "fixed",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200

    detail = await client.get(f"/admin/products/{product_id}",
                              headers={"Authorization": f"Bearer {admin_token}"})
    assert detail.json()["commission_rate"] == 9.0


# ---------------------------------------------------------------------------
# Seller tự đặt chiến lược giá (PUT /seller/products/{id}/pricing)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_seller_sets_own_pricing_strategy(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Seller Pricing Test",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    resp = await client.put(f"/seller/products/{product_id}/pricing", json={
        "pricing_strategy": "config",
        "pricing_params": {"base_price": 75000, "type_mult": {"datacenter": 1.0}, "network_mult": {"viettel": 1.0}},
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 200
    assert resp.json()["pricing_strategy"] == "config"

    # Draft products stay hidden from the public storefront. Read the persisted
    # seller-owned configuration through the management seam instead.
    public_detail = await client.get(f"/products/{product_id}")
    assert public_detail.status_code == 404

    detail = await client.get(
        f"/seller/products/{product_id}/detail",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert detail.status_code == 200
    assert detail.json()["pricing_params"]["base_price"] == 75000


@pytest.mark.asyncio
async def test_seller_cannot_set_pricing_on_others_product(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Not Yours",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    other_token = await register_and_login(client, "prod_seller_other@example.com")
    await make_seller("prod_seller_other@example.com")
    other_token = await register_and_login(client, "prod_seller_other@example.com")

    resp = await client.put(f"/seller/products/{product_id}/pricing", json={
        "pricing_strategy": "config",
    }, headers={"Authorization": f"Bearer {other_token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_seller_cannot_set_commission_via_pricing_endpoint(client):
    """SellerPricingUpdate schema không có commission_rate — gửi kèm phải bị
    Pydantic bỏ qua âm thầm, không được lén set qua endpoint này."""
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "No Sneaky Fields",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    resp = await client.put(f"/seller/products/{product_id}/pricing", json={
        "pricing_strategy": "fixed",
        "commission_rate": 50.0,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 200

    detail = await client.get(f"/admin/products/{product_id}",
                              headers={"Authorization": f"Bearer {admin_token}"})
    assert detail.json()["commission_rate"] is None


@pytest.mark.asyncio
async def test_seller_cannot_attach_a_provider_they_do_not_own_via_pricing_endpoint(client):
    """provider_id GIỜ có trong SellerPricingUpdate (seller self-service —
    spec 2026-07-21), nhưng chỉ nhận provider do CHÍNH seller đó tự đăng ký
    và đã được duyệt. Một provider admin tạo (seller_id=None, "dùng chung")
    không tự dưng gắn được qua đường này — đó vẫn là quyết định của admin
    qua /admin/products/{id}/operations."""
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "No Sneaky Provider",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    provider = await client.post("/admin/providers", json={
        "name": "SharedProvider", "type": "proxy", "config": {},
    }, headers={"Authorization": f"Bearer {admin_token}"})
    provider_id = provider.json()["id"]

    resp = await client.put(f"/seller/products/{product_id}/pricing", json={
        "pricing_strategy": "fixed",
        "provider_id": provider_id,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 400

    async with SessionLocal() as db:
        product_row = await db.get(Product, product_id)
        assert product_row.provider_id is None


@pytest.mark.asyncio
async def test_seller_pricing_blocked_when_incompatible_with_assigned_provider(client):
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Incompatible Strategy Test",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    provider = await client.post("/admin/providers", json={
        "name": "ManualOnlyProvider", "type": "proxy",
        "config": {}, "adapter_type": "manual",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    provider_id = provider.json()["id"]

    # admin gán provider "manual" (chỉ tương thích strategy "task") cho sản phẩm
    await client.put(f"/admin/products/{product_id}/operations", json={
        "provider_id": provider_id, "pricing_strategy": "task",
        "pricing_params": {"base_price": 1000, "platform_mult": {"youtube": 1.0}},
    }, headers={"Authorization": f"Bearer {admin_token}"})

    # seller cố đổi sang "config" — không tương thích với adapter "manual" đang gắn
    resp = await client.put(f"/seller/products/{product_id}/pricing", json={
        "pricing_strategy": "config",
        "pricing_params": {"base_price": 1000, "type_mult": {"a": 1.0}, "network_mult": {"b": 1.0}},
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Sửa / xoá biến thể
# ---------------------------------------------------------------------------


async def _variant_for_edit(client, email: str):
    from tests.test_resources import _seller_with_variant
    return await _seller_with_variant(client, email)


@pytest.mark.asyncio
async def test_update_variant_fields(client):
    token, _, vid = await _variant_for_edit(client, "var1@example.com")
    resp = await client.patch(f"/seller/variants/{vid}", json={
        "name": "Gói mới", "price": 99000, "delivery_mode": "manual", "sla_hours": 48,
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Gói mới"
    assert body["price"] == 99000
    assert body["delivery_mode"] == "manual"
    assert body["sla_hours"] == 48


@pytest.mark.asyncio
async def test_duration_days_can_be_cleared_back_to_forever(client):
    """Từng không làm được: service bỏ qua mọi giá trị None, nên đặt thời hạn rồi
    thì không bao giờ quay lại 'vĩnh viễn'."""
    token, _, vid = await _variant_for_edit(client, "var2@example.com")

    await client.patch(f"/seller/variants/{vid}", json={"duration_days": 30},
                       headers={"Authorization": f"Bearer {token}"})
    resp = await client.patch(f"/seller/variants/{vid}", json={"duration_days": None},
                              headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["duration_days"] is None


@pytest.mark.asyncio
async def test_update_does_not_blank_out_fields_left_unsent(client):
    token, _, vid = await _variant_for_edit(client, "var3@example.com")
    await client.patch(f"/seller/variants/{vid}", json={"name": "Giữ tên"},
                       headers={"Authorization": f"Bearer {token}"})
    resp = await client.patch(f"/seller/variants/{vid}", json={"price": 5000},
                              headers={"Authorization": f"Bearer {token}"})
    assert resp.json()["name"] == "Giữ tên"
    assert resp.json()["price"] == 5000


@pytest.mark.asyncio
async def test_variant_can_be_turned_off(client):
    token, _, vid = await _variant_for_edit(client, "var4@example.com")
    resp = await client.patch(f"/seller/variants/{vid}", json={"is_active": False},
                              headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


@pytest.mark.asyncio
async def test_cannot_delete_variant_that_still_has_stock(client):
    """Trước đây FK violation lọt thành 500 và nút Xoá im lặng không làm gì."""
    token, _, vid = await _variant_for_edit(client, "var5@example.com")
    await client.post(f"/seller/variants/{vid}/resources", json={"items": ["a|1", "b|2"]},
                      headers={"Authorization": f"Bearer {token}"})

    resp = await client.delete(f"/seller/variants/{vid}",
                               headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400
    assert "2 tài nguyên" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_empty_variant_can_still_be_deleted(client):
    token, _, vid = await _variant_for_edit(client, "var6@example.com")
    resp = await client.delete(f"/seller/variants/{vid}",
                               headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_seller_detail_still_shows_a_variant_after_turning_it_off(client):
    """Tắt bán rồi thì gói biến mất khỏi /products/{id} (đúng, trang mua không nên
    thấy) — nhưng trang quản lý dùng chung endpoint đó thì seller mất luôn gói và
    không còn đường bật lại."""
    token, product_id, vid = await _variant_for_edit(client, "var7@example.com")
    await client.patch(f"/seller/variants/{vid}", json={"is_active": False},
                       headers={"Authorization": f"Bearer {token}"})

    public = await client.get(f"/products/{product_id}")
    assert all(v["id"] != vid for v in public.json()["variants"]), "trang mua không nên thấy gói đã tắt"

    own = await client.get(f"/seller/products/{product_id}/detail",
                           headers={"Authorization": f"Bearer {token}"})
    assert own.status_code == 200, own.text
    turned_off = next(v for v in own.json()["variants"] if v["id"] == vid)
    assert turned_off["is_active"] is False


@pytest.mark.asyncio
async def test_seller_detail_rejects_someone_elses_product(client):
    token, product_id, _ = await _variant_for_edit(client, "var8@example.com")
    other, _, _ = await _variant_for_edit(client, "var9@example.com")
    resp = await client.get(f"/seller/products/{product_id}/detail",
                            headers={"Authorization": f"Bearer {other}"})
    assert resp.status_code in (403, 404)
