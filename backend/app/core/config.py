"""Environment-only configuration; camera data never reaches the persistence layer."""

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Settings:
    database_path: str = field(default_factory=lambda: os.getenv("DATABASE_PATH", "data/mirror.sqlite3"))
    storage_backend: str = field(default_factory=lambda: os.getenv("STORAGE_BACKEND", "sqlite"))
    supabase_url: str = field(default_factory=lambda: os.getenv("SUPABASE_URL", ""))
    supabase_key: str = field(default_factory=lambda: os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
    admin_token: str = field(default_factory=lambda: os.getenv("ADMIN_TOKEN", ""))
    allow_demo_admin: bool = field(
        default_factory=lambda: os.getenv("ALLOW_DEMO_ADMIN", "true").lower() == "true"
    )
    frontend_url: str = field(default_factory=lambda: os.getenv("FRONTEND_URL", "http://localhost:3000"))
    public_asset_url: str = field(
        default_factory=lambda: os.getenv("PUBLIC_ASSET_URL", "/api/garment-assets")
    )
    cors_origins: list[str] = field(
        default_factory=lambda: os.getenv(
            "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
    )
    session_ttl_minutes: int = 60
    transfer_ttl_minutes: int = 15
    analytics_retention_days: int = 30
    tax_rate: float = 0.05
    catalog_path: Path = field(
        default_factory=lambda: Path(__file__).resolve().parents[3] / "shared/catalog.json"
    )
