import json

import httpx
import pytest

from app.core.config import Settings
from app.database.repository import SQLiteRepository, SupabaseRepository
from app.services.mirror import MirrorService


def test_sqlite_transaction_rolls_back_related_writes(tmp_path):
    repository = SQLiteRepository(str(tmp_path / "atomic.sqlite3"))
    repository.put("products", "a", {"id": "a", "stock": 5})
    with pytest.raises(RuntimeError), repository.transaction():
        repository.put("products", "a", {"id": "a", "stock": 0})
        repository.put("orders", "order", {"id": "order"})
        raise RuntimeError("Interrupted checkout")
    assert repository.get("products", "a")["stock"] == 5
    assert repository.get("orders", "order") is None
    repository.close()


def test_photo_seed_upgrade_preserves_store_edits_and_applies_once(tmp_path):
    catalog = json.loads(Settings().catalog_path.read_text(encoding="utf-8"))
    original = next(p for p in catalog if not p["id"].startswith("asm-photo-"))
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps([original]), encoding="utf-8")
    repository = SQLiteRepository(str(tmp_path / "upgrade.sqlite3"))
    service = MirrorService(repository, Settings(catalog_path=path))
    service.seed()
    changed = {**original, "stock": 73}
    repository.put("products", original["id"], changed)
    photo = {
        **original,
        "id": "asm-photo-test",
        "sku": "PHOTO-TEST",
        "image": "/photo.png",
        "category": "Sweaters",
    }
    path.write_text(json.dumps([original, photo]), encoding="utf-8")
    service.seed()
    assert repository.get("products", original["id"])["stock"] == 73
    assert repository.get("products", photo["id"])["image"] == "/photo.png"
    assert repository.get("product_images", photo["id"]) is not None
    assert any(item["name"] == "Sweaters" for item in repository.list("categories"))
    repository.delete("products", photo["id"])
    service.seed()
    assert repository.get("products", photo["id"]) is None
    repository.close()


def test_supabase_transport_batches_related_writes_and_overlays_reads():
    requests = []

    def handler(request):
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=[{"payload": {"id": "p1", "stock": 8}}])
        return httpx.Response(204)

    repository = SupabaseRepository("https://example.supabase.co", "test-server-key")
    repository.client.close()
    repository.client = httpx.Client(
        base_url="https://example.supabase.co/rest/v1/", transport=httpx.MockTransport(handler)
    )
    with repository.transaction():
        repository.put("products", "p1", {"id": "p1", "stock": 7})
        repository.put("orders", "o1", {"id": "o1", "total": 100})
        assert repository.get("products", "p1")["stock"] == 7
        assert repository.list("products")[0]["stock"] == 7
    mutations = [r for r in requests if r.method == "POST"]
    assert len(mutations) == 1 and mutations[0].url.path.endswith("rpc/mirror_apply_operations")
    assert len(json.loads(mutations[0].content)["operations"]) == 2
    repository.close()


def test_supabase_failed_batch_does_not_leak_pending_mutations():
    repository = SupabaseRepository("https://example.supabase.co", "test-server-key")
    repository.client.close()
    repository.client = httpx.Client(
        base_url="https://example.supabase.co/rest/v1/",
        transport=httpx.MockTransport(lambda request: httpx.Response(503, json={"message": "Unavailable"})),
    )
    with pytest.raises(httpx.HTTPStatusError), repository.transaction():
        repository.put("orders", "order", {"id": "order"})
    assert repository._pending == {} and repository._transaction_depth == 0
    repository.close()
