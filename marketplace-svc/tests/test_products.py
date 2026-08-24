import pytest

from src.database import SessionLocal
from src.models.pricing_config import PricingConfig
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
async def test_seller_cannot_create_admin_suspended_product(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)

    response = await client.post("/seller/products", json={
        "category_id": cat_id,
        "title": "Invalid Seller Suspension",
        "status": "suspended",
    }, headers={"Authorization": f"Bearer {seller_token}"})

    assert response.status_code == 422, response.text


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
async def test_seller_product_list_exposes_effective_pricing_fallback(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id,
        "title": "Configured Proxy",
        "service_type": "proxy",
        "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    params = {
        "base_price": 10000,
        "type_mult": {"datacenter": 1.0},
        "network_mult": {"shared": 1.0},
    }
    async with SessionLocal() as db:
        db.add(PricingConfig(
            service_type="proxy", strategy="config", params=params, is_active=True,
        ))
        await db.commit()

    response = await client.get(
        "/seller/products", headers={"Authorization": f"Bearer {seller_token}"},
    )

    item = next(row for row in response.json() if row["id"] == product.json()["id"])
    assert item["pricing_strategy"] == "config"
    assert item["pricing_params"] == params
    assert item["total_stock"] == 0


@pytest.mark.asyncio
async def test_variant_delivery_mode_rejects_frontend_alias(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Strict Delivery Mode",
    }, headers={"Authorization": f"Bearer {seller_token}"})

    response = await client.post(
        f"/seller/products/{product.json()['id']}/variants",
        json={"name": "Invalid Auto", "price": 1000, "delivery_mode": "auto"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    assert response.status_code == 422, response.text


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
async def test_seller_can_pause_and_reactivate_own_product(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Seller Lifecycle", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    paused = await client.put(
        f"/seller/products/{product_id}/status",
        json={"status": "paused"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert paused.status_code == 200, paused.text
    assert paused.json()["status"] == "paused"

    active = await client.put(
        f"/seller/products/{product_id}/status",
        json={"status": "active"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert active.status_code == 200, active.text
    assert active.json()["status"] == "active"


@pytest.mark.asyncio
async def test_seller_product_status_rejects_unknown_lifecycle_value(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Invalid Lifecycle", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})

    response = await client.put(
        f"/seller/products/{product.json()['id']}/status",
        json={"status": "suspended"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_seller_cannot_change_another_sellers_product_status(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Owned Lifecycle", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})

    other_token = await register_and_login(client, "status_other@example.com")
    await make_seller("status_other@example.com")
    other_token = await register_and_login(client, "status_other@example.com")
    response = await client.put(
        f"/seller/products/{product.json()['id']}/status",
        json={"status": "paused"},
        headers={"Authorization": f"Bearer {other_token}"},
    )

    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_seller_cannot_reactivate_admin_suspended_product(client):
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Admin Suspension", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]
    await client.post(
        f"/admin/products/{product_id}/suspend",
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    response = await client.put(
        f"/seller/products/{product_id}/status",
        json={"status": "active"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    assert response.status_code == 409, response.text
    detail = await client.get(
        f"/seller/products/{product_id}/detail",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert detail.json()["status"] == "suspended"


@pytest.mark.asyncio
async def test_legacy_pause_endpoint_cannot_clear_admin_suspension(client):
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Protected Suspension", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]
    await client.post(
        f"/admin/products/{product_id}/suspend",
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    response = await client.delete(
        f"/seller/products/{product_id}",
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    assert response.status_code == 409, response.text
    detail = await client.get(
        f"/seller/products/{product_id}/detail",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert detail.json()["status"] == "suspended"


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
async def test_admin_operations_cannot_mix_dynamic_pricing_with_variants(client):
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Admin Mixed Model",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]
    await client.post(
        f"/seller/products/{product_id}/variants",
        json={"name": "Fixed Package", "price": 1000, "delivery_mode": "instant"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    response = await client.put(f"/admin/products/{product_id}/operations", json={
        "pricing_strategy": "task",
        "pricing_params": {"base_price": 5000, "platform_mult": {"facebook": 1.0}},
    }, headers={"Authorization": f"Bearer {admin_token}"})

    assert response.status_code == 409, response.text


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
async def test_product_with_variants_rejects_service_type_dynamic_fallback(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Fixed Service Migration",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]
    await client.post(
        f"/seller/products/{product_id}/variants",
        json={"name": "Fixed Package", "price": 1000, "delivery_mode": "instant"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    async with SessionLocal() as db:
        db.add(PricingConfig(
            service_type="proxy", strategy="config",
            params={
                "base_price": 10000,
                "type_mult": {"residential": 1.0},
                "network_mult": {"shared": 1.0},
            },
            is_active=True,
        ))
        await db.commit()

    response = await client.patch(
        f"/seller/products/{product_id}",
        json={"service_type": "proxy"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    assert response.status_code == 409, response.text
    detail = await client.get(
        f"/seller/products/{product_id}/detail",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert detail.json()["service_type"] == "other"


@pytest.mark.asyncio
async def test_product_with_variants_rejects_switch_to_dynamic_pricing(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Fixed With Variant",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]
    variant = await client.post(
        f"/seller/products/{product_id}/variants",
        json={"name": "Fixed Package", "price": 1000, "delivery_mode": "instant"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert variant.status_code == 201, variant.text

    response = await client.put(f"/seller/products/{product_id}/pricing", json={
        "pricing_strategy": "credit",
        "pricing_params": {
            "credit_price": 10,
            "packages": [{"size": 1000, "label": "1k"}],
        },
    }, headers={"Authorization": f"Bearer {seller_token}"})

    assert response.status_code == 409, response.text
    detail = await client.get(
        f"/seller/products/{product_id}/detail",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert detail.json()["pricing_strategy"] is None
    assert len(detail.json()["variants"]) == 1


@pytest.mark.asyncio
async def test_dynamic_pricing_product_rejects_variant_creation(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Dynamic Without Variants",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]
    pricing = await client.put(f"/seller/products/{product_id}/pricing", json={
        "pricing_strategy": "config",
        "pricing_params": {
            "base_price": 10000,
            "type_mult": {"residential": 1.0},
            "network_mult": {"shared": 1.0},
        },
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert pricing.status_code == 200, pricing.text

    response = await client.post(
        f"/seller/products/{product_id}/variants",
        json={"name": "Should Not Exist", "price": 1000, "delivery_mode": "instant"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    assert response.status_code == 409, response.text


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
async def test_variant_with_inventory_cannot_switch_to_manual_delivery(client):
    token, _, variant_id = await _variant_for_edit(client, "var_delivery@example.com")
    added = await client.post(
        f"/seller/variants/{variant_id}/resources",
        json={"items": ["existing|stock"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert added.status_code == 201, added.text

    response = await client.patch(
        f"/seller/variants/{variant_id}",
        json={"delivery_mode": "manual"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 409, response.text
    detail = await client.get(
        f"/seller/variants/{variant_id}/resources",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert len(detail.json()) == 1


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


async def _cover_seller(client, tag: str):
    admin_email = f"cover_admin_{tag}@example.com"
    seller_email = f"cover_seller_{tag}@example.com"
    admin_token = await register_and_login(client, admin_email)
    await make_admin(admin_email)
    admin_token = await register_and_login(client, admin_email)
    cat = await client.post(
        "/admin/categories",
        json={"name": f"CoverCat {tag}", "slug": f"covercat-{tag}"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert cat.status_code == 201, cat.text
    seller_token = await register_and_login(client, seller_email)
    await make_seller(seller_email)
    seller_token = await register_and_login(client, seller_email)
    return seller_token, cat.json()["id"]


def test_cover_helpers_reject_legacy_blobs():
    from src.products.covers import catalog_items, default_cover_id, parse_cover_id, public_images

    assert default_cover_id("proxy") == "proxy"
    assert default_cover_id(None) == "other"
    assert parse_cover_id({"cover_id": "facebook"}) == "facebook"
    assert parse_cover_id(["http://old.example/a.png"]) is None
    assert parse_cover_id({"cover_id": "not-a-cover"}) is None
    assert public_images(["http://old.example/a.png"]) is None
    assert public_images({"cover_id": "facebook"}) == {"cover_id": "facebook"}
    assert [item["id"] for item in catalog_items()][0] == "facebook"


@pytest.mark.asyncio
async def test_product_covers_catalog_is_public(client):
    resp = await client.get("/product-covers")
    assert resp.status_code == 200, resp.text
    ids = [item["id"] for item in resp.json()["items"]]
    assert ids == [
        "facebook", "instagram", "tiktok", "youtube", "x",
        "proxy", "token", "endpoint", "cloud",
        "payment", "takedown", "account", "other",
    ]
    assert {item["group"] for item in resp.json()["items"]} == {"social", "infra", "service"}
    facebook = next(item for item in resp.json()["items"] if item["id"] == "facebook")
    assert facebook["label"]["vi"] == "Facebook"
    assert facebook["label"]["en"] == "Facebook"


@pytest.mark.asyncio
async def test_create_product_defaults_cover_from_service_type(client):
    seller_token, cat_id = await _cover_seller(client, "default")
    resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Residential Proxy", "service_type": "proxy",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["cover_id"] == "proxy"
    assert body["images"] == {"cover_id": "proxy"}


@pytest.mark.asyncio
async def test_create_product_accepts_explicit_cover_id(client):
    seller_token, cat_id = await _cover_seller(client, "explicit")
    resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "FB BM", "service_type": "account",
        "cover_id": "facebook", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["cover_id"] == "facebook"
    assert resp.json()["images"] == {"cover_id": "facebook"}

    public = await client.get(f"/products/{resp.json()['id']}")
    assert public.status_code == 200, public.text
    assert public.json()["cover_id"] == "facebook"


@pytest.mark.asyncio
async def test_create_product_rejects_unknown_cover_id(client):
    seller_token, cat_id = await _cover_seller(client, "unknown")
    resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Bad cover", "cover_id": "not-a-cover",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_create_product_rejects_images_blob(client):
    seller_token, cat_id = await _cover_seller(client, "blob")
    resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Upload attempt",
        "images": ["https://evil.example/a.png"],
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_seller_can_change_and_clear_cover_id(client):
    seller_token, cat_id = await _cover_seller(client, "patch")
    created = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Cover edit", "cover_id": "facebook",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert created.status_code == 201, created.text
    product_id = created.json()["id"]

    patched = await client.patch(
        f"/seller/products/{product_id}",
        json={"cover_id": "tiktok"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["cover_id"] == "tiktok"

    cleared = await client.patch(
        f"/seller/products/{product_id}",
        json={"cover_id": None},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["cover_id"] is None
    assert cleared.json()["images"] is None


@pytest.mark.asyncio
async def test_changing_service_type_does_not_overwrite_cover(client):
    seller_token, cat_id = await _cover_seller(client, "keep")
    created = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Keep cover",
        "service_type": "account", "cover_id": "instagram",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert created.status_code == 201, created.text
    product_id = created.json()["id"]

    patched = await client.patch(
        f"/seller/products/{product_id}",
        json={"service_type": "other"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["service_type"] == "other"
    assert patched.json()["cover_id"] == "instagram"


@pytest.mark.asyncio
async def test_seller_cannot_patch_someone_elses_cover(client):
    seller_token, cat_id = await _cover_seller(client, "owner")
    created = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Owned",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert created.status_code == 201, created.text
    other_email = "cover_thief_owner@example.com"
    other_token = await register_and_login(client, other_email)
    await make_seller(other_email)
    other_token = await register_and_login(client, other_email)

    resp = await client.patch(
        f"/seller/products/{created.json()['id']}",
        json={"cover_id": "facebook"},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp.status_code in (403, 404)


@pytest.mark.asyncio
async def test_legacy_images_blob_reads_as_no_cover(client):
    seller_token, cat_id = await _cover_seller(client, "legacy")
    created = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Legacy images", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert created.status_code == 201, created.text
    product_id = created.json()["id"]

    async with SessionLocal() as db:
        product = await db.get(Product, product_id)
        product.images = ["http://old.example/cover.png"]
        await db.commit()

    detail = await client.get(f"/products/{product_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["cover_id"] is None
    assert detail.json()["images"] is None
