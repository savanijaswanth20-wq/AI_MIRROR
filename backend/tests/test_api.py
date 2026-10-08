"""Behavioral API tests cover privacy, authorization and stock-bearing workflows."""

import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.mirror import iso, now


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        database_path=str(tmp_path / "mirror.sqlite3"), admin_token="test-secret", storage_backend="sqlite"
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def session(client):
    response = client.post("/api/sessions", json={"station": "Station 04", "mode": "demo"})
    assert response.status_code == 201
    return response.json()["id"]


@pytest.fixture
def product(client):
    return client.get("/api/products").json()[0]


def cart_input(session, product, quantity=1):
    return {
        "sessionId": session,
        "productId": product["id"],
        "size": "M",
        "color": product["colors"][0]["name"],
        "quantity": quantity,
        "score": 82,
    }


AUTH = {"Authorization": "Bearer test-secret"}


def test_catalog_is_populated_and_filterable(client):
    products = client.get("/api/products").json()
    assert len(products) >= 30
    assert len({p["category"] for p in products}) >= 11
    assert any(p["id"] == "asm-photo-sweater" for p in products)
    assert all(p["measurements"][size]["chest"] > 0 for p in products for size in p["sizes"])
    assert {p["category"] for p in client.get("/api/products?category=Blazers").json()} == {"Blazers"}


def test_admin_authorization_and_product_validation(client, product):
    changed = {**product, "stock": 12}
    assert client.patch(f"/api/products/{product['id']}", json=changed).status_code == 401
    assert client.patch(f"/api/products/{product['id']}", json=changed, headers=AUTH).status_code == 200
    assert client.get(f"/api/products/{product['id']}").json()["stock"] == 12
    invalid = {**changed, "price": -1}
    assert client.patch(f"/api/products/{product['id']}", json=invalid, headers=AUTH).status_code == 422


def test_remote_clients_cannot_use_tokenless_admin(tmp_path):
    settings = Settings(
        database_path=str(tmp_path / "remote.sqlite3"), admin_token="", storage_backend="sqlite"
    )
    with TestClient(create_app(settings), client=("192.168.1.22", 8080)) as remote:
        assert remote.get("/api/admin/analytics").status_code == 401


def test_loopback_demo_admin(tmp_path):
    settings = Settings(
        database_path=str(tmp_path / "local.sqlite3"), admin_token="", storage_backend="sqlite"
    )
    with TestClient(create_app(settings), client=("127.0.0.1", 8080)) as local:
        assert local.get("/api/admin/analytics").status_code == 200
        assert local.get("/api/admin/analytics", headers={"X-Mirror-Proxy": "1"}).status_code == 401


def test_proxy_admin_requires_bearer_authorization(client):
    assert client.get("/api/admin/analytics", headers={"X-Mirror-Proxy": "1", **AUTH}).status_code == 200
    assert client.get("/api/admin/analytics", headers={"Authorization": "test-secret"}).status_code == 401


def test_cart_prices_are_authoritative_and_stock_is_validated(client, session, product):
    response = client.post("/api/cart", json=cart_input(session, product, 2))
    assert response.status_code == 200
    cart = response.json()
    expected_subtotal = product["price"] * 2
    assert cart["subtotal"] == expected_subtotal
    assert cart["discount"] == round(expected_subtotal * product["discount"] / 100, 2)
    assert cart["total"] == round((expected_subtotal - cart["discount"]) * 1.05, 2)
    assert client.post("/api/cart", json=cart_input(session, product, 99)).status_code == 409
    invalid = {**cart_input(session, product), "color": "Nonexistent"}
    assert client.post("/api/cart", json=invalid).status_code == 422
    supplied_price = {**cart_input(session, product), "price": 1}
    assert client.post("/api/cart", json=supplied_price).status_code == 422


def test_cart_ownership_and_quantity(client, session, product):
    cart = client.post("/api/cart", json=cart_input(session, product)).json()
    item_id = cart["items"][0]["id"]
    second = client.post("/api/sessions", json={}).json()["id"]
    assert client.delete(f"/api/cart/{second}/items/{item_id}").status_code == 404
    response = client.patch(f"/api/cart/{session}/items/{item_id}", json={"quantity": 3})
    assert response.json()["items"][0]["quantity"] == 3
    assert client.delete(f"/api/cart/{session}/items/{item_id}").json()["items"] == []


def test_delete_product_in_active_cart_is_protected(client, session, product):
    client.post("/api/cart", json=cart_input(session, product))
    assert client.delete(f"/api/products/{product['id']}", headers=AUTH).status_code == 409


def test_staff_fulfilment_state_machine(client, session, product):
    payload = {k: v for k, v in cart_input(session, product).items() if k not in ("quantity", "score")}
    record = client.post("/api/staff-request", json=payload).json()
    assert record["rack"] == product["rack"] and record["status"] == "Waiting"
    assert "sessionId" not in record
    url = f"/api/staff-requests/{record['id']}"
    assert client.patch(url, json={"status": "Completed"}, headers=AUTH).status_code == 409
    for status in ("Accepted", "Bringing Product", "Completed"):
        assert client.patch(url, json={"status": status}, headers=AUTH).json()["status"] == status
    assert client.patch(url, json={"status": "Waiting"}, headers=AUTH).status_code == 409


def test_session_end_cleans_cart_transfer_and_live_identifier(client, session, product):
    client.post("/api/cart", json=cart_input(session, product))
    transfer = client.post("/api/transfers", json={"sessionId": session}).json()
    assert client.delete(f"/api/sessions/{session}").status_code == 204
    assert client.get(f"/api/cart/{session}").status_code == 404
    assert client.get(f"/api/transfers/{transfer['token']}").status_code == 404
    assert client.app.state.service.db.list("cart_items") == []
    events = client.app.state.service.db.list("analytics_events")
    assert all(e["sessionId"] != session for e in events)


def test_session_expiry_cleans_without_customer_action(client, session):
    db = client.app.state.service.db
    row = db.get("try_on_sessions", session)
    row["expiresAt"] = iso(now() - timedelta(seconds=1))
    db.put("try_on_sessions", session, row)
    assert client.get(f"/api/sessions/{session}").status_code == 404
    assert db.get("try_on_sessions", session) is None


def test_transfer_has_no_camera_data_or_session_bearer(client, session, product):
    look = {k: v for k, v in cart_input(session, product).items() if k not in ("sessionId", "quantity")}
    token = client.post("/api/transfers", json={"sessionId": session, "look": look}).json()["token"]
    result = client.get(f"/api/transfers/{token}")
    assert result.status_code == 200
    assert session not in result.text
    assert len(token) >= 32
    assert result.json()["products"][0]["rack"] == product["rack"]
    db = client.app.state.service.db
    record = db.get("qr_transfers", token)
    record["expiresAt"] = iso(now() - timedelta(seconds=1))
    db.put("qr_transfers", token, record)
    assert client.get(f"/api/transfers/{token}").status_code == 404


def test_body_analysis_rejects_photos_and_unreliable_landmarks(client):
    assert client.post("/api/body-analysis", json={"photo": "data:image/jpeg;base64,xxx"}).status_code == 422
    points = [{"x": 0.5, "y": 0.5, "z": 0, "visibility": 1} for _ in range(33)]
    assert client.post("/api/body-analysis", json={"landmarks": points}).status_code == 422
    points[11] = {"x": 0.35, "y": 0.25, "z": 0, "visibility": 1}
    points[12] = {"x": 0.65, "y": 0.25, "z": 0, "visibility": 1}
    points[23] = {"x": 0.4, "y": 0.55, "z": 0, "visibility": 1}
    points[24] = {"x": 0.6, "y": 0.55, "z": 0, "visibility": 1}
    result = client.post("/api/body-analysis", json={"landmarks": points}).json()
    assert result["shoulderRatio"] == 1.5
    assert result["heightCm"] is None  # Absolute height cannot be inferred without calibration.
    assert client.app.state.service.db.list("customers") == []


def test_calibrated_measurements_and_rule_scores(client, product):
    points = [{"x": 0.5, "y": 0.5, "z": 0, "visibility": 1} for _ in range(33)]
    for index, x, y in (
        (0, 0.5, 0.05),
        (11, 0.4, 0.25),
        (12, 0.6, 0.25),
        (23, 0.42, 0.55),
        (24, 0.58, 0.55),
        (27, 0.44, 0.95),
        (28, 0.56, 0.95),
    ):
        points[index].update(x=x, y=y)
    profile = client.post("/api/body-analysis", json={"landmarks": points, "heightCm": 170}).json()
    assert profile["heightCm"] == 170
    result = client.post("/api/style-score", json={"productId": product["id"], "profile": profile}).json()
    assert result["recommendedSize"] in product["sizes"]
    assert 0 < result["sizeConfidence"] <= 82
    assert "not attractiveness" in result["explanation"]


def test_assistant_only_recommends_available_inventory_within_budget(client, product):
    disabled = {**product, "stock": 0}
    client.patch(f"/api/products/{product['id']}", json=disabled, headers=AUTH)
    result = client.post("/api/assistant", json={"message": "Show me outfits under ₹5000"}).json()
    assert result["products"]
    assert all(p["id"] != product["id"] and p["stock"] > 0 for p in result["products"])
    total = sum(p["price"] * (1 - p["discount"] / 100) for p in result["products"])
    assert total <= 5000


def test_analytics_are_events_and_checkout_changes_stock(client, session, product):
    event = {
        "sessionId": session,
        "type": "try_on",
        "productId": product["id"],
        "color": product["colors"][0]["name"],
    }
    assert client.post("/api/events", json=event).status_code == 201
    assert client.post("/api/events", json={**event, "type": "purchase"}).status_code == 422
    client.post("/api/cart", json=cart_input(session, product))
    order = client.post("/api/orders", json={"sessionId": session})
    assert order.status_code == 201 and order.json()["status"] == "demo-confirmed"
    assert client.get(f"/api/products/{product['id']}").json()["stock"] == product["stock"] - 1
    metrics = client.get("/api/admin/analytics", headers=AUTH).json()
    assert metrics["totalSessions"] == 1 and metrics["totalTryOns"] == 1
    assert metrics["tryOnToCartConversion"] == 100 and metrics["tryOnToPurchaseConversion"] == 100
    assert metrics["revenue"] == order.json()["total"]


def test_two_checkout_requests_do_not_oversell(client, product):
    client.patch(f"/api/products/{product['id']}", json={**product, "stock": 1}, headers=AUTH)
    sessions = [client.post("/api/sessions", json={}).json()["id"] for _ in range(2)]
    for sid in sessions:
        client.post("/api/cart", json=cart_input(sid, product))
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda sid: client.post("/api/orders", json={"sessionId": sid}), sessions))
    assert sorted(r.status_code for r in responses) == [201, 409]
    assert client.get(f"/api/products/{product['id']}").json()["stock"] == 0


def test_durable_products_and_deleted_seed_not_recreated(tmp_path):
    config = Settings(
        database_path=str(tmp_path / "durable.sqlite3"), admin_token="test-secret", storage_backend="sqlite"
    )
    with TestClient(create_app(config)) as first:
        products = first.get("/api/products").json()
        assert first.delete(f"/api/products/{products[0]['id']}", headers=AUTH).status_code == 204
    with TestClient(create_app(config)) as second:
        assert second.get(f"/api/products/{products[0]['id']}").status_code == 404
        assert len(second.get("/api/products").json()) == len(products) - 1


def test_garment_upload_requires_admin_and_image_signature(client):
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII="
    )

    assert (
        client.post("/api/admin/assets", content=png, headers={"Content-Type": "image/png"}).status_code
        == 401
    )
    response = client.post("/api/admin/assets", content=png, headers={**AUTH, "Content-Type": "image/png"})
    assert response.status_code == 201
    filename = response.json()["url"].rsplit("/", 1)[1]
    assert response.json()["url"].startswith("/api/garment-assets/")
    assert client.get(f"/assets/{filename}").content == png
    assert (
        client.post(
            "/api/admin/assets",
            content=b"<script>alert(1)</script>",
            headers={**AUTH, "Content-Type": "image/png"},
        ).status_code
        == 415
    )


def test_frontend_event_transport_is_idempotent_and_not_double_counted(client, session, product):
    client.post("/api/cart", json=cart_input(session, product))
    event = {
        "id": "frontend-event-1",
        "timestamp": iso(),
        "sessionId": session,
        "type": "add_to_cart",
        "productId": product["id"],
    }
    assert client.post("/api/events", json=event).json()["recorded"] is False
    event["type"] = "try_on"
    assert client.post("/api/events", json=event).status_code == 201
    assert client.post("/api/events", json=event).status_code == 201
    metrics = client.get("/api/admin/analytics", headers=AUTH).json()
    assert metrics["totalTryOns"] == 1 and metrics["cartAdds"] == 1


def test_analytics_retention_removes_old_events_and_preserves_recent_metrics(client, session, product):
    service = client.app.state.service
    service.event(session, "try_on", eventId="retained-event", productId=product["id"])
    service.event(session, "try_on", eventId="expired-event", productId=product["id"])
    retained = service.db.get("analytics_events", "retained-event")
    retained["timestamp"] = iso(now() - timedelta(days=29))
    service.db.put("analytics_events", retained["id"], retained)
    expired = service.db.get("analytics_events", "expired-event")
    expired["timestamp"] = iso(now() - timedelta(days=31))
    service.db.put("analytics_events", expired["id"], expired)
    metrics = client.get("/api/admin/analytics", headers=AUTH).json()
    assert service.db.get("analytics_events", "expired-event") is None
    assert service.db.get("analytics_events", "retained-event") is not None
    assert metrics["totalTryOns"] == 1
    assert metrics["mostTriedProducts"] == [{"name": product["id"], "productId": product["id"], "count": 1}]
    assert all(event["id"] != "expired-event" for event in metrics["events"])


def test_bulk_cart_replacement_validates_before_changing_items(client, session, product):
    client.post("/api/cart", json=cart_input(session, product))
    item = {
        "id": "frontend-item-1",
        "productId": product["id"],
        "color": product["colors"][0]["name"],
        "size": "M",
        "score": 80,
        "quantity": 2,
    }
    assert client.put(f"/api/cart/{session}", json={"items": [item]}).json()["items"][0]["id"] == item["id"]
    invalid = {**item, "quantity": 99}
    assert client.put(f"/api/cart/{session}", json={"items": [invalid]}).status_code == 409
    assert client.get(f"/api/cart/{session}").json()["items"][0]["quantity"] == 2
    assert client.put(f"/api/cart/{session}", json={"items": []}).json()["items"] == []
