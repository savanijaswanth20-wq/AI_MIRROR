import json

import httpx
import pytest

from app.database.repository import SQLiteRepository, SupabaseRepository


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
