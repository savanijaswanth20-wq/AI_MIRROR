"""Strict API schemas exclude images, identity and arbitrary analytics payloads."""

from enum import StrEnum
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


Size = Literal["XS", "S", "M", "L", "XL", "XXL"]
Occasion = Literal[
    "Casual",
    "Office",
    "Interview",
    "College",
    "Party",
    "Wedding",
    "Festival",
    "Travel",
    "Date",
    "Formal event",
]


class ProductColor(Model):
    name: str = Field(min_length=1, max_length=40)
    hex: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")


class Measurements(Model):
    chest: float = Field(gt=0, le=200)
    length: float = Field(gt=0, le=200)
    shoulder: float = Field(gt=0, le=100)


class Product(Model):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    sku: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=120)
    brand: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=1500)
    category: str = Field(min_length=1, max_length=60)
    gender: Literal["Men", "Women", "Unisex"]
    price: float = Field(gt=0, le=1_000_000)
    discount: float = Field(ge=0, le=90)
    sizes: list[Size] = Field(min_length=1, max_length=6)
    colors: list[ProductColor] = Field(min_length=1, max_length=12)
    stock: int = Field(ge=0, le=100000)
    image: str = Field(max_length=500)
    garmentImage: str = Field(max_length=500)
    frontImage: str = Field(max_length=500)
    backImage: str = Field(max_length=500)
    mask: str = Field(max_length=500)
    measurements: dict[Size, Measurements]
    rack: str = Field(min_length=1, max_length=30)
    floor: int = Field(ge=0, le=50)
    section: str = Field(max_length=100)
    store: str = Field(max_length=100)
    occasions: list[Occasion] = Field(min_length=1)
    silhouette: Literal["top", "bottom", "dress"]
    featured: bool = False

    @field_validator("image", "garmentImage", "frontImage", "backImage", "mask")
    @classmethod
    def safe_asset(cls, value: str) -> str:
        url = urlparse(value)
        loopback = url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1")
        if (
            not (value.startswith("/") and not value.startswith("//"))
            and not value.startswith("https://")
            and not loopback
        ):
            raise ValueError("Asset must be a local absolute path or HTTPS URL")
        return value

    @model_validator(mode="after")
    def check_variants(self) -> "Product":
        if len(set(self.sizes)) != len(self.sizes):
            raise ValueError("Sizes must be unique")
        names = [c.name.lower() for c in self.colors]
        if len(set(names)) != len(names):
            raise ValueError("Colors must be unique")
        if any(size not in self.measurements for size in self.sizes):
            raise ValueError("Every size requires a size chart entry")
        return self


class BodyProfile(Model):
    shoulderRatio: float = Field(default=1, gt=0, le=5)
    torsoRatio: float = Field(default=1, gt=0, le=5)
    hipRatio: float = Field(default=1, gt=0, le=5)
    heightCm: float | None = Field(default=None, ge=80, le=230)
    shoulderCm: float | None = Field(default=None, gt=0, le=100)
    chestCm: float | None = Field(default=None, gt=0, le=200)
    torsoCm: float | None = Field(default=None, gt=0, le=100)
    armCm: float | None = Field(default=None, gt=0, le=150)
    legCm: float | None = Field(default=None, gt=0, le=150)
    faceShape: Literal["Oval", "Round", "Square", "Rectangle", "Heart", "Diamond"] | None = None
    skinTone: Literal["Light", "Medium", "Deep", "Unknown"] | None = None
    confidence: float = Field(default=0.5, ge=0, le=1)
    source: Literal["demo", "camera"] = "demo"


class Landmark(Model):
    x: float = Field(ge=-2, le=3, allow_inf_nan=False)
    y: float = Field(ge=-2, le=3, allow_inf_nan=False)
    z: float = Field(default=0, ge=-10, le=10, allow_inf_nan=False)
    visibility: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)


class AnalysisRequest(Model):
    landmarks: list[Landmark] = Field(min_length=33, max_length=33)
    heightCm: float | None = Field(default=None, ge=80, le=230)
    source: Literal["demo", "camera"] = "camera"


class StyleRequest(Model):
    productId: str
    color: str = ""
    occasion: Occasion = "Casual"
    profile: BodyProfile = Field(default_factory=BodyProfile)
    sessionId: str | None = None


class StyleScore(Model):
    style: int
    color: int
    fit: int
    occasion: int
    overall: int
    explanation: str
    recommendedSize: Size
    sizeConfidence: int
    colors: list[str]


class SessionRequest(Model):
    station: str = Field(default="Station 04", max_length=60)
    mode: Literal["demo", "camera"] = "demo"


class Look(Model):
    productId: str
    color: str
    size: Size
    score: float = Field(default=0, ge=0, le=100)


class CartRequest(Look):
    sessionId: str
    quantity: int = Field(default=1, ge=1, le=99)


class CartItemInput(Look):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    quantity: int = Field(default=1, ge=1, le=99)


class CartReplaceRequest(Model):
    items: list[CartItemInput] = Field(max_length=30)


class QuantityRequest(Model):
    quantity: int = Field(ge=1, le=99)


class StaffRequestInput(Model):
    sessionId: str
    productId: str
    color: str
    size: Size
    station: str | None = Field(default=None, max_length=60)
    score: float | None = Field(default=None, ge=0, le=100)


class StaffStatus(StrEnum):
    WAITING = "Waiting"
    ACCEPTED = "Accepted"
    BRINGING = "Bringing Product"
    COMPLETED = "Completed"


class StaffUpdate(Model):
    status: StaffStatus


class EventRequest(Model):
    id: str | None = Field(default=None, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    timestamp: str | None = Field(default=None, max_length=60)
    sessionId: str
    type: Literal[
        "session_start",
        "session_end",
        "try_on",
        "add_to_cart",
        "cart_add",
        "compare",
        "recommendation",
        "save_look",
        "staff_request",
        "qr_transfer",
    ]
    productId: str | None = None
    color: str | None = Field(default=None, max_length=40)
    size: Size | None = None


class TransferRequest(Model):
    sessionId: str
    look: Look | None = None
    cart: list[CartItemInput] | None = Field(default=None, max_length=30)


class AssistantRequest(Model):
    message: str = Field(min_length=1, max_length=1000)
    occasion: Occasion = "Casual"
    productId: str | None = None
    budget: float | None = Field(default=None, gt=0, le=1_000_000)
    sessionId: str | None = None


class CompareRequest(Model):
    outfits: list[StyleRequest] = Field(min_length=2, max_length=4)


class CheckoutRequest(Model):
    sessionId: str
