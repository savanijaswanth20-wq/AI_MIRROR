"""FastAPI entry point. Run with: uvicorn app.main:app --host 127.0.0.1 --port 8000."""

import asyncio
import contextlib
import hmac
import json
import secrets
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.ai.measurements.engine import analyze
from app.ai.recommendations.engine import score
from app.core.config import Settings
from app.database.repository import SQLiteRepository, SupabaseRepository
from app.schemas.domain import (
    AnalysisRequest,
    AssistantRequest,
    CartReplaceRequest,
    CartRequest,
    CheckoutRequest,
    CompareRequest,
    EventRequest,
    Product,
    QuantityRequest,
    SessionRequest,
    StaffRequestInput,
    StaffUpdate,
    StyleRequest,
    TransferRequest,
)
from app.services.mirror import MirrorService, iso, now


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings()
    repository = (
        SupabaseRepository(config.supabase_url, config.supabase_key)
        if config.storage_backend == "supabase"
        else SQLiteRepository(config.database_path)
    )
    service = MirrorService(repository, config)
    service.seed()

    async def cleanup_loop() -> None:
        while True:
            await asyncio.sleep(60)
            try:
                await asyncio.to_thread(service.cleanup)
            except httpx.HTTPError:
                # Keep the worker alive through a temporary cloud outage. API
                # calls surface a clean 503 and retry cleanup on the next minute.
                continue

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        service.cleanup()
        task = asyncio.create_task(cleanup_loop())
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        repository.close()

    app = FastAPI(title="AI SMART MIRROR API", version="1.0.0", lifespan=lifespan)
    app.state.service = service
    app.state.settings = config
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    asset_path = Path(config.database_path).parent / "garment-assets"
    asset_path.mkdir(parents=True, exist_ok=True)
    app.mount("/assets", StaticFiles(directory=asset_path), name="assets")

    @app.middleware("http")
    async def safety_headers(request: Request, call_next: Any) -> Response:
        raw_length = request.headers.get("content-length", "0")
        try:
            length = int(raw_length)
        except ValueError:
            return Response("Invalid content length", status_code=400)
        if length > 5 * 1024 * 1024:
            return Response("Payload too large", status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.exception_handler(httpx.HTTPError)
    async def cloud_unavailable(_: Request, __: httpx.HTTPError) -> Response:
        return Response(
            json.dumps({"detail": "Inventory service is temporarily unavailable. Please retry."}),
            status_code=503,
            media_type="application/json",
        )

    def admin(request: Request) -> str:
        authorization = request.headers.get("Authorization", "")
        token = authorization[7:] if authorization.startswith("Bearer ") else ""
        if config.admin_token and hmac.compare_digest(token, config.admin_token):
            return "admin"
        # Optional real Supabase Auth: user identity must come from Supabase's
        # verified endpoint; never trust a client-decoded JWT or user metadata role.
        if token and config.supabase_url and config.supabase_key:
            try:
                result = httpx.get(
                    config.supabase_url.rstrip("/") + "/auth/v1/user",
                    timeout=8,
                    headers={"apikey": config.supabase_key, "Authorization": f"Bearer {token}"},
                )
                if result.status_code == 200:
                    user = repository.get("users", result.json()["id"])
                    if user and user.get("role") in ("admin", "staff"):
                        if (
                            user["role"] == "staff"
                            and request.url.path not in ("/api/staff-requests", "/api/admin/staff-requests")
                            and not request.url.path.startswith("/api/staff-requests/")
                        ):
                            raise HTTPException(403, "Admin role required")
                        return user["role"]
            except httpx.HTTPError:
                raise HTTPException(503, "Authentication service is unavailable") from None
        if (
            not config.admin_token
            and config.allow_demo_admin
            and request.headers.get("X-Mirror-Proxy") != "1"
            and request.client
            and request.client.host in ("127.0.0.1", "::1")
        ):
            return "demo-admin"
        raise HTTPException(401, "Admin authorization required")

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "storage": config.storage_backend,
            "version": "1.0.0",
            "photoStorage": False,
            "recommendationEngine": "explainable-catalogue-rules",
            "demoAdmin": not bool(config.admin_token) and config.allow_demo_admin,
        }

    @app.get("/api/products", response_model=list[Product])
    def products(
        category: str | None = None,
        gender: str | None = None,
        q: str | None = None,
        occasion: str | None = None,
        inStock: bool = False,
    ) -> list[Product]:
        return [
            p
            for p in service.products()
            if (not category or p.category == category)
            and (not gender or p.gender in (gender, "Unisex"))
            and (not q or q.lower() in f"{p.name} {p.brand} {p.category}".lower())
            and (not occasion or occasion in p.occasions)
            and (not inStock or p.stock > 0)
        ]

    @app.get("/api/products/{product_id}", response_model=Product)
    def product(product_id: str) -> Product:
        return service.product(product_id)

    @app.post("/api/products", response_model=Product, dependencies=[Depends(admin)], status_code=201)
    def add_product(value: Product) -> Product:
        if repository.get("products", value.id):
            raise HTTPException(409, "Product ID already exists")
        service.save_product(value)
        return value

    @app.put("/api/products/{product_id}", response_model=Product, dependencies=[Depends(admin)])
    @app.patch("/api/products/{product_id}", response_model=Product, dependencies=[Depends(admin)])
    def edit_product(product_id: str, value: Product) -> Product:
        service.product(product_id)
        if product_id != value.id:
            raise HTTPException(422, "Product ID cannot change")
        service.save_product(value)
        return value

    @app.delete("/api/products/{product_id}", dependencies=[Depends(admin)], status_code=204)
    def delete_product(product_id: str) -> Response:
        service.product(product_id)
        if any(i["productId"] == product_id for i in repository.list("cart_items")):
            raise HTTPException(409, "Product is in an active cart; set stock to zero instead")
        for table in ("products", "inventory", "product_images", "product_variants"):
            repository.delete(table, product_id)
        return Response(status_code=204)

    @app.post("/api/admin/assets", dependencies=[Depends(admin)], status_code=201)
    async def upload_asset(request: Request) -> dict[str, str]:
        chunks = bytearray()
        async for chunk in request.stream():
            chunks.extend(chunk)
            if len(chunks) > 5 * 1024 * 1024:
                raise HTTPException(413, "Garment asset exceeds 5 MB")
        data = bytes(chunks)
        mime = request.headers.get("Content-Type", "").split(";")[0]
        signatures = {
            "image/png": (b"\x89PNG\r\n\x1a\n", ".png"),
            "image/jpeg": (b"\xff\xd8\xff", ".jpg"),
            "image/webp": (b"RIFF", ".webp"),
        }
        if mime not in signatures or not data.startswith(signatures[mime][0]):
            raise HTTPException(415, "Upload a PNG, JPEG or WebP garment asset")
        if mime == "image/webp" and data[8:12] != b"WEBP":
            raise HTTPException(415, "Invalid WebP file")
        filename = secrets.token_urlsafe(20) + signatures[mime][1]
        if config.storage_backend == "supabase":
            url = config.supabase_url.rstrip("/") + "/storage/v1/object/garment-assets/" + filename
            response = await asyncio.to_thread(
                httpx.post,
                url,
                content=data,
                timeout=15,
                headers={
                    "Authorization": f"Bearer {config.supabase_key}",
                    "apikey": config.supabase_key,
                    "Content-Type": mime,
                },
            )
            response.raise_for_status()
            return {
                "url": config.supabase_url.rstrip("/")
                + "/storage/v1/object/public/garment-assets/"
                + filename
            }
        (asset_path / filename).write_bytes(data)
        return {"url": config.public_asset_url.rstrip("/") + "/" + filename}

    @app.post("/api/sessions", status_code=201)
    def create_session(value: SessionRequest) -> dict[str, Any]:
        return service.create_session(value.station, value.mode)

    @app.get("/api/sessions/{session_id}")
    def get_session(session_id: str) -> dict[str, Any]:
        return service.session(session_id)

    @app.delete("/api/sessions/{session_id}", status_code=204)
    @app.post("/api/sessions/{session_id}/end", status_code=204)
    def end_session(session_id: str) -> Response:
        service.end_session(session_id)
        return Response(status_code=204)

    @app.post("/api/body-analysis")
    def body_analysis(value: AnalysisRequest):
        return analyze(value)

    def style_result(value: StyleRequest):
        if value.sessionId:
            service.session(value.sessionId)
        selected = service.product(value.productId)
        color = value.color or selected.colors[0].name
        if color not in [c.name for c in selected.colors]:
            raise HTTPException(422, "Color is not available")
        return score(selected, color, value.occasion, value.profile)

    @app.post("/api/style-score")
    def style_score(value: StyleRequest):
        return style_result(value)

    @app.post("/api/size-recommendation")
    def size_recommendation(value: StyleRequest) -> dict[str, Any]:
        result = style_result(value)
        return {
            "size": result.recommendedSize,
            "confidence": result.sizeConfidence,
            "disclaimer": "Camera-based size recommendations are approximate. "
            "Confirm using the store's official size chart.",
        }

    @app.post("/api/recommendation")
    def recommendation(value: StyleRequest) -> dict[str, Any]:
        style_result(value)
        selected = service.product(value.productId)
        ranked = [
            (p, score(p, p.colors[0].name, value.occasion, value.profile))
            for p in service.products()
            if p.stock > 0 and p.silhouette == selected.silhouette
        ]
        ranked.sort(key=lambda entry: entry[1].overall, reverse=True)
        chosen = ranked[:4]
        if value.sessionId:
            for p, _ in chosen:
                service.event(value.sessionId, "recommendation", productId=p.id)
        return {
            "products": [p.model_dump() for p, _ in chosen],
            "scores": [{"productId": p.id, **s.model_dump()} for p, s in chosen],
            "explanation": "Ranked from available catalogue items using occasion, silhouette "
            "and size-chart rules.",
        }

    @app.post("/api/compare")
    def compare(value: CompareRequest) -> dict[str, Any]:
        results = [
            {"productId": outfit.productId, **style_result(outfit).model_dump()} for outfit in value.outfits
        ]
        winner = max(range(len(results)), key=lambda index: results[index]["overall"])
        for outfit in value.outfits:
            if outfit.sessionId:
                service.event(outfit.sessionId, "compare", productId=outfit.productId)
        return {
            "outfits": results,
            "recommendedIndex": winner,
            "reason": "The recommended outfit has the highest weighted catalogue-rule score "
            "for your preferences.",
        }

    @app.post("/api/assistant")
    def assistant(value: AssistantRequest):
        return service.assistant(value)

    @app.get("/api/cart/{session_id}")
    def get_cart(session_id: str):
        return service.cart(session_id)

    @app.post("/api/cart")
    def add_cart(value: CartRequest):
        return service.add_cart(value)

    @app.put("/api/cart/{session_id}")
    def replace_cart(session_id: str, value: CartReplaceRequest):
        with repository.transaction():
            service.session(session_id)
            ids = [item.id for item in value.items]
            if len(set(ids)) != len(ids):
                raise HTTPException(422, "Cart item IDs must be unique")
            quantities: dict[str, int] = {}
            for item in value.items:
                p = service.validate_variant(item.productId, item.color, item.size)
                other = repository.get("cart_items", item.id)
                if other and other["sessionId"] != session_id:
                    raise HTTPException(409, "Cart item ID belongs to another session")
                quantities[p.id] = quantities.get(p.id, 0) + item.quantity
            for pid, quantity in quantities.items():
                if quantity > service.product(pid).stock:
                    raise HTTPException(409, "Quantity exceeds available stock")
            # Validate the entire replacement before making any mutations.
            for old in repository.list("cart_items"):
                if old["sessionId"] == session_id:
                    repository.delete("cart_items", old["id"])
            for item in value.items:
                repository.put("cart_items", item.id, {**item.model_dump(), "sessionId": session_id})
            return service.cart(session_id)

    @app.patch("/api/cart/{session_id}/items/{item_id}")
    def update_quantity(session_id: str, item_id: str, value: QuantityRequest):
        with repository.transaction():
            service.session(session_id)
            item = repository.get("cart_items", item_id)
            if not item or item["sessionId"] != session_id:
                raise HTTPException(404, "Cart item not found")
            p = service.validate_variant(item["productId"], item["color"], item["size"])
            existing = sum(
                i["quantity"]
                for i in repository.list("cart_items")
                if i["sessionId"] == session_id and i["productId"] == p.id and i["id"] != item_id
            )
            if existing + value.quantity > p.stock:
                raise HTTPException(409, "Quantity exceeds available stock")
            item["quantity"] = value.quantity
            repository.put("cart_items", item_id, item)
            return service.cart(session_id)

    @app.delete("/api/cart/{session_id}/items/{item_id}")
    def remove_item(session_id: str, item_id: str):
        service.session(session_id)
        item = repository.get("cart_items", item_id)
        if not item or item["sessionId"] != session_id:
            raise HTTPException(404, "Cart item not found")
        repository.delete("cart_items", item_id)
        return service.cart(session_id)

    @app.post("/api/orders", status_code=201)
    def checkout(value: CheckoutRequest):
        # Single-process serialisation protects the SQLite MVP inventory. Cloud
        # deployments must use one worker until checkout is an atomic DB RPC.
        with repository.transaction():
            cart = service.cart(value.sessionId)
            if not cart["items"]:
                raise HTTPException(422, "Cart is empty")
            quantities: dict[str, int] = {}
            for item in cart["items"]:
                p = service.validate_variant(item["productId"], item["color"], item["size"])
                quantities[p.id] = quantities.get(p.id, 0) + item["quantity"]
            for pid, quantity in quantities.items():
                if service.product(pid).stock < quantity:
                    raise HTTPException(409, "Stock changed; please update your cart")
            for pid, quantity in quantities.items():
                p = service.product(pid)
                p.stock -= quantity
                service.save_product(p)
            order_id = secrets.token_urlsafe(12)
            order = {
                "id": order_id,
                "createdAt": iso(),
                "status": "demo-confirmed",
                **{k: v for k, v in cart.items() if k != "sessionId"},
            }
            repository.put("orders", order_id, order)
            for item in cart["items"]:
                service.event(
                    value.sessionId, "purchase", productId=item["productId"], quantity=item["quantity"]
                )
                repository.delete("cart_items", item["id"])
            return order

    @app.post("/api/staff-request", status_code=201)
    def staff_request(value: StaffRequestInput):
        return service.staff_request(value)

    @app.get("/api/staff-requests", dependencies=[Depends(admin)])
    @app.get("/api/admin/staff-requests", dependencies=[Depends(admin)])
    def staff_requests():
        return [
            {k: v for k, v in row.items() if k != "sessionId"} for row in repository.list("staff_requests")
        ]

    @app.patch("/api/staff-requests/{request_id}", dependencies=[Depends(admin)])
    def update_staff(request_id: str, value: StaffUpdate):
        record = repository.get("staff_requests", request_id)
        if not record:
            raise HTTPException(404, "Staff request not found")
        flow = ["Waiting", "Accepted", "Bringing Product", "Completed"]
        current = flow.index(record["status"])
        target = flow.index(value.status.value)
        if target not in (current, current + 1):
            raise HTTPException(409, "Advance a staff request one stage at a time")
        record["status"] = value.status.value
        record["updatedAt"] = iso()
        repository.put("staff_requests", request_id, record)
        return {k: v for k, v in record.items() if k != "sessionId"}

    @app.post("/api/events", status_code=201)
    def record_event(value: EventRequest):
        service.session(value.sessionId)
        if value.productId:
            p = service.product(value.productId)
            if value.color and value.color not in [c.name for c in p.colors]:
                raise HTTPException(422, "Color is not available")
            if value.size and value.size not in p.sizes:
                raise HTTPException(422, "Size is not available")
        if value.type in (
            "session_start",
            "session_end",
            "add_to_cart",
            "cart_add",
            "staff_request",
            "qr_transfer",
        ):
            return {"recorded": False, "reason": "Event is recorded by its authoritative API operation"}
        service.event(
            value.sessionId,
            value.type,
            eventId=value.id,
            **value.model_dump(exclude={"sessionId", "type", "id", "timestamp"}, exclude_none=True),
        )
        return {"recorded": True}

    @app.post("/api/transfers", status_code=201)
    def create_transfer(value: TransferRequest):
        service.session(value.sessionId)
        if value.look:
            service.validate_variant(value.look.productId, value.look.color, value.look.size)
        # Always use the authoritative server cart, ignoring client price/quantity
        # claims. Optional cart looks are validated but cannot change the cart.
        for look in value.cart or []:
            service.validate_variant(look.productId, look.color, look.size)
        cart = service.cart(value.sessionId)
        token = secrets.token_urlsafe(24)
        expires = iso(now() + timedelta(minutes=config.transfer_ttl_minutes))
        record = {
            "id": token,
            "sessionId": value.sessionId,
            "expiresAt": expires,
            "look": value.look.model_dump() if value.look else None,
            "products": ([service.product(value.look.productId).model_dump()] if value.look else []),
            "cart": {k: v for k, v in cart.items() if k != "sessionId"},
            "store": {"name": "Atelier Central", "location": "Demo store · Bengaluru"},
        }
        repository.put("qr_transfers", token, record)
        service.event(value.sessionId, "qr_transfer", productId=value.look.productId if value.look else None)
        return {"token": token, "expiresAt": expires, "url": f"{config.frontend_url}/look/{token}"}

    @app.get("/api/transfers/{token}")
    def get_transfer(token: str):
        service.cleanup()
        record = repository.get("qr_transfers", token)
        if not record:
            raise HTTPException(404, "This transfer expired or the mirror session ended")
        return {k: v for k, v in record.items() if k not in ("sessionId", "id")}

    @app.get("/api/admin/analytics", dependencies=[Depends(admin)])
    def analytics():
        return service.analytics()

    @app.get("/api/admin/overview", dependencies=[Depends(admin)])
    def overview():
        service.cleanup()
        return {
            "analytics": service.analytics(),
            "categories": repository.list("categories"),
            "inventory": repository.list("inventory"),
            "orders": repository.list("orders"),
            "customers": [],
            "stations": repository.list("mirror_stations"),
            "settings": {
                "currency": "INR",
                "taxRate": config.tax_rate,
                "sessionTtlMinutes": config.session_ttl_minutes,
                "transferTtlMinutes": config.transfer_ttl_minutes,
                "cameraPhotoStorage": False,
                "storage": config.storage_backend,
            },
            "customerNote": "Anonymous sessions; no identity, face images or customer profiles "
            "are collected.",
        }

    return app


app = create_app()
