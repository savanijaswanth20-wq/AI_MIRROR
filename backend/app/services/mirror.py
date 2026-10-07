"""Retail operations, explicit validation, session cleanup and aggregate analytics."""

import hashlib
import json
import re
import secrets
from collections import Counter
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from fastapi import HTTPException

from app.ai.recommendations.engine import score
from app.core.config import Settings
from app.database.repository import SQLiteRepository, SupabaseRepository
from app.schemas.domain import AssistantRequest, BodyProfile, CartRequest, Product, StaffRequestInput


def now() -> datetime:
    return datetime.now(UTC)


def iso(value: datetime | None = None) -> str:
    return (value or now()).isoformat()


def money(value: float | Decimal) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


class MirrorService:
    def __init__(self, repository: SQLiteRepository | SupabaseRepository, settings: Settings):
        self.db = repository
        self.settings = settings

    def seed(self) -> None:
        with self.db.transaction():
            if self.db.get("settings", "catalog_seeded") is not None:
                return
            products = json.loads(self.settings.catalog_path.read_text(encoding="utf-8"))
            for data in products:
                product = Product.model_validate(data)
                self.save_product(product)
            for index, name in enumerate(sorted({p["category"] for p in products})):
                self.db.put("categories", str(index), {"id": str(index), "name": name})
            for size in ("XS", "S", "M", "L", "XL", "XXL"):
                self.db.put("sizes", size, {"id": size, "name": size, "unit": "cm"})
            for color in {c["name"]: c for p in products for c in p["colors"]}.values():
                self.db.put("colors", color["name"], {"id": color["name"], **color})
            self.db.put(
                "stores",
                "atelier-central",
                {
                    "id": "atelier-central",
                    "name": "Atelier Central",
                    "address": "Demo store · Bengaluru",
                    "currency": "INR",
                },
            )
            self.db.put(
                "store_locations", "floor-1", {"id": "floor-1", "storeId": "atelier-central", "floor": 1}
            )
            self.db.put(
                "mirror_stations",
                "station-04",
                {"id": "station-04", "name": "Station 04", "status": "online"},
            )
            self.db.put("settings", "catalog_seeded", {"id": "catalog_seeded", "at": iso()})

    def products(self) -> list[Product]:
        return [Product.model_validate(value) for value in self.db.list("products")]

    def product(self, product_id: str) -> Product:
        value = self.db.get("products", product_id)
        if value is None:
            raise HTTPException(404, "Product not found")
        return Product.model_validate(value)

    def save_product(self, product: Product) -> None:
        with self.db.transaction():
            duplicate = next(
                (p for p in self.db.list("products") if p["sku"] == product.sku and p["id"] != product.id),
                None,
            )
            if duplicate:
                raise HTTPException(409, "SKU is already in use")
            self.db.put("products", product.id, product.model_dump())
            self.db.put(
                "inventory",
                product.id,
                {"id": product.id, "productId": product.id, "stock": product.stock, "rack": product.rack},
            )
            self.db.put(
                "product_images",
                product.id,
                {
                    "id": product.id,
                    "productId": product.id,
                    "main": product.image,
                    "garment": product.garmentImage,
                    "front": product.frontImage,
                    "back": product.backImage,
                    "mask": product.mask,
                },
            )
            self.db.put(
                "product_variants",
                product.id,
                {
                    "id": product.id,
                    "productId": product.id,
                    "sizes": product.sizes,
                    "colors": [c.model_dump() for c in product.colors],
                    "measurements": {k: v.model_dump() for k, v in product.measurements.items()},
                },
            )

    def validate_variant(self, product_id: str, color: str, size: str) -> Product:
        product = self.product(product_id)
        if color not in [c.name for c in product.colors] or size not in product.sizes:
            raise HTTPException(422, "This size or color is not available for the product")
        if product.stock < 1:
            raise HTTPException(409, "This product is out of stock")
        return product

    def create_session(self, station: str, mode: str) -> dict[str, Any]:
        with self.db.transaction():
            self.cleanup()
            session_id = secrets.token_urlsafe(24)
            value = {
                "id": session_id,
                "station": station,
                "mode": mode,
                "createdAt": iso(),
                "expiresAt": iso(now() + timedelta(minutes=self.settings.session_ttl_minutes)),
                "status": "active",
            }
            self.db.put("try_on_sessions", session_id, value)
            self.event(session_id, "session_start")
            return value

    def session(self, session_id: str) -> dict[str, Any]:
        self.cleanup()
        value = self.db.get("try_on_sessions", session_id)
        if value is None:
            raise HTTPException(404, "Session ended or expired. Start a new experience.")
        return value

    def end_session(self, session_id: str, expired: bool = False) -> None:
        with self.db.transaction():
            value = self.db.get("try_on_sessions", session_id)
            if value is None:
                raise HTTPException(404, "Session not found")
            duration = max(0, (now() - datetime.fromisoformat(value["createdAt"])).total_seconds())
            self.event(session_id, "session_end", durationSeconds=round(duration), expired=expired)
            for table in ("carts", "cart_items", "qr_transfers", "try_on_products", "recommendations"):
                for row in self.db.list(table):
                    if row.get("sessionId") == session_id:
                        self.db.delete(table, row["id"])
            # Staff need their fulfilment history but lose the live session bearer.
            for row in self.db.list("staff_requests"):
                if row.get("sessionId") == session_id:
                    row.pop("sessionId", None)
                    self.db.put("staff_requests", row["id"], row)
            self.db.delete("try_on_sessions", session_id)

    def cleanup(self) -> None:
        with self.db.transaction():
            for value in self.db.list("try_on_sessions"):
                if datetime.fromisoformat(value["expiresAt"]) <= now():
                    self.end_session(value["id"], expired=True)
            for value in self.db.list("qr_transfers"):
                if datetime.fromisoformat(value["expiresAt"]) <= now():
                    self.db.delete("qr_transfers", value["id"])
            cutoff = now() - timedelta(days=self.settings.analytics_retention_days)
            for value in self.db.list("analytics_events"):
                if datetime.fromisoformat(value["timestamp"]) < cutoff:
                    self.db.delete("analytics_events", value["id"])

    def event(self, session_id: str, event_type: str, **dimensions: Any) -> None:
        event_id = dimensions.pop("eventId", None) or secrets.token_urlsafe(12)
        if self.db.get("analytics_events", event_id):
            return
        # Analytics receive a one-way anonymous grouping key, never the session bearer.
        event = {
            "id": event_id,
            "type": event_type,
            "sessionId": hashlib.sha256(session_id.encode()).hexdigest(),
            "timestamp": iso(),
            **dimensions,
        }
        self.db.put("analytics_events", event_id, event)

    def cart(self, session_id: str) -> dict[str, Any]:
        self.session(session_id)
        items = [value for value in self.db.list("cart_items") if value["sessionId"] == session_id]
        subtotal = Decimal("0")
        discounted = Decimal("0")
        result_items = []
        for item in items:
            product = self.product(item["productId"])
            line = Decimal(str(product.price)) * item["quantity"]
            line_discount = line * Decimal(str(product.discount)) / 100
            subtotal += line
            discounted += line_discount
            result_items.append(
                {
                    **{k: v for k, v in item.items() if k != "sessionId"},
                    "product": product.model_dump(),
                    "unitPrice": product.price,
                    "discount": product.discount,
                    "lineTotal": money(line - line_discount),
                }
            )
        net = subtotal - discounted
        tax = money(net * Decimal(str(self.settings.tax_rate)))
        return {
            "sessionId": session_id,
            "items": result_items,
            "subtotal": money(subtotal),
            "discount": money(discounted),
            "tax": tax,
            "taxRate": self.settings.tax_rate,
            "total": money(net + Decimal(str(tax))),
            "currency": "INR",
        }

    def add_cart(self, request: CartRequest) -> dict[str, Any]:
        with self.db.transaction():
            self.session(request.sessionId)
            product = self.validate_variant(request.productId, request.color, request.size)
            items = [i for i in self.db.list("cart_items") if i["sessionId"] == request.sessionId]
            product_quantity = sum(i["quantity"] for i in items if i["productId"] == product.id)
            if product_quantity + request.quantity > product.stock:
                raise HTTPException(409, f"Only {product.stock} units are available")
            existing = next(
                (
                    i
                    for i in items
                    if i["productId"] == product.id
                    and i["color"] == request.color
                    and i["size"] == request.size
                ),
                None,
            )
            if existing:
                existing["quantity"] += request.quantity
                self.db.put("cart_items", existing["id"], existing)
            else:
                item_id = secrets.token_urlsafe(12)
                self.db.put("cart_items", item_id, {"id": item_id, **request.model_dump()})
            self.db.put(
                "carts",
                request.sessionId,
                {"id": request.sessionId, "sessionId": request.sessionId, "updatedAt": iso()},
            )
            self.event(
                request.sessionId,
                "add_to_cart",
                productId=product.id,
                color=request.color,
                size=request.size,
                quantity=request.quantity,
            )
            return self.cart(request.sessionId)

    def staff_request(self, request: StaffRequestInput) -> dict[str, Any]:
        with self.db.transaction():
            session = self.session(request.sessionId)
            product = self.validate_variant(request.productId, request.color, request.size)
            request_id = secrets.token_urlsafe(12)
            value = {
                "id": request_id,
                "sessionId": request.sessionId,
                "station": request.station or session["station"],
                "productId": product.id,
                "productName": product.name,
                "size": request.size,
                "color": request.color,
                "rack": product.rack,
                "status": "Waiting",
                "createdAt": iso(),
            }
            self.db.put("staff_requests", request_id, value)
            self.event(request.sessionId, "staff_request", productId=product.id)
            return {k: v for k, v in value.items() if k != "sessionId"}

    def assistant(self, request: AssistantRequest) -> dict[str, Any]:
        if request.sessionId:
            self.session(request.sessionId)
        text = request.message.lower()
        occasion = request.occasion
        for word, value in (
            ("interview", "Interview"),
            ("office", "Office"),
            ("wedding", "Wedding"),
            ("festival", "Festival"),
            ("travel", "Travel"),
            ("party", "Party"),
        ):
            if word in text:
                occasion = value
                break
        budget = request.budget
        match = re.search(r"(?:under|below|budget|₹|rs\.?)[\s₹]*(\d[\d,]*)", text)
        if match:
            budget = float(match[1].replace(",", ""))
        available = [
            p
            for p in self.products()
            if p.stock > 0 and (budget is None or p.price * (1 - p.discount / 100) <= budget)
        ]
        selected = self.product(request.productId) if request.productId else None
        if selected and ("match" in text or "outfit" in text):
            available = [p for p in available if p.silhouette != selected.silhouette]
        category_words = {
            "shirt": "Shirts",
            "t-shirt": "T-shirts",
            "jeans": "Jeans",
            "dress": "Dresses",
            "blazer": "Blazers",
            "kurti": "Kurtis",
            "hoodie": "Hoodies",
        }
        if not (selected and ("match" in text or "outfit" in text)):
            for word, category in category_words.items():
                if word in text:
                    available = [p for p in available if p.category == category]
                    break
        ranked = sorted(
            available,
            key=lambda p: (
                occasion not in p.occasions,
                -score(p, p.colors[0].name, occasion, BodyProfile()).overall,
            ),
        )
        chosen = ranked[:4]
        # Complete-outfit prompts are constrained by the combined budget, not just
        # each item's price. Avoid recommending multiple tops as a complete outfit.
        if "complete" in text or "outfit" in text:
            chosen = []
            silhouettes: set[str] = set()
            spent = 0.0
            for product in ranked:
                cost = product.price * (1 - product.discount / 100)
                if product.silhouette in silhouettes or (budget is not None and spent + cost > budget):
                    continue
                chosen.append(product)
                silhouettes.add(product.silhouette)
                spent += cost
                if len(chosen) == 2:
                    break
        message = (
            f"For {occasion.lower()}, try " + ", ".join(p.name for p in chosen) + ". "
            "These are in-stock catalogue items; use the official size chart to confirm fit."
            if chosen
            else "No in-stock catalogue items match that request. Try a higher budget or another occasion."
        )
        if budget is not None and chosen:
            message += f" Your budget is ₹{budget:,.0f}; discounted prices are shown before 5% demo tax."
        return {
            "message": message,
            "products": [p.model_dump() for p in chosen],
            "occasion": occasion,
            "mode": "catalogue-rules",
        }

    def analytics(self) -> dict[str, Any]:
        self.cleanup()
        events = self.db.list("analytics_events")
        starts = [e for e in events if e["type"] == "session_start"]
        tries = [e for e in events if e["type"] == "try_on"]
        purchases = [e for e in events if e["type"] == "purchase"]
        carts = [e for e in events if e["type"] in ("cart_add", "add_to_cart")]
        tried_sessions = {e["sessionId"] for e in tries}
        cart_sessions = {e["sessionId"] for e in carts}
        purchased_sessions = {e["sessionId"] for e in purchases}
        durations = [e["durationSeconds"] for e in events if e["type"] == "session_end"]
        for session in self.db.list("try_on_sessions"):
            durations.append(max(0, (now() - datetime.fromisoformat(session["createdAt"])).total_seconds()))

        def rank(event_type: str, key: str = "productId") -> list[dict[str, Any]]:
            counter = Counter(e[key] for e in events if e["type"] == event_type and e.get(key))
            return [
                {"name": value, "productId": value if key == "productId" else None, "count": count}
                for value, count in counter.most_common(8)
            ]

        def conversion(target: set[str]) -> float:
            return round(len(tried_sessions & target) / len(tried_sessions) * 100, 1) if tried_sessions else 0

        tried_counter = Counter(e["productId"] for e in tries if e.get("productId"))
        bought_counter = Counter(e["productId"] for e in purchases if e.get("productId"))
        daily = Counter(e["timestamp"][:10] for e in starts)
        return {
            "totalSessions": len(starts),
            "dailyUsers": daily.get(now().date().isoformat(), 0),
            "events": events,
            "activeSessions": len(self.db.list("try_on_sessions")),
            "totalTryOns": len(tries),
            "cartAdds": len(carts),
            "totalOrders": len(self.db.list("orders")),
            "revenue": money(sum(o["total"] for o in self.db.list("orders"))),
            "tryOnToCartConversion": conversion(cart_sessions),
            "tryOnToPurchaseConversion": conversion(purchased_sessions),
            "averageSessionDuration": round(sum(durations) / len(durations)) if durations else 0,
            "mostTriedProducts": rank("try_on"),
            "mostPurchasedProducts": rank("purchase"),
            "mostRecommendedProducts": rank("recommendation"),
            "mostComparedProducts": rank("compare"),
            "popularColors": rank("try_on", "color"),
            "popularSizes": rank("add_to_cart", "size"),
            "dailySessions": [{"date": date, "count": count} for date, count in sorted(daily.items())],
            "rarelyPurchased": [
                {"productId": pid, "tries": count, "purchases": bought_counter[pid]}
                for pid, count in tried_counter.most_common()
                if count > bought_counter[pid] * 3
            ],
            "notes": "Daily users represent anonymous sessions. Orders are demo orders "
            "without payment processing.",
        }
