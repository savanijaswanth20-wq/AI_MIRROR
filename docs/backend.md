# Backend operation and API

The FastAPI backend runs without cloud credentials using durable SQLite. It seeds 44 synthetic catalogue products once, so product edits and deletes survive restarts. SQLite WAL and transaction boundaries protect related inventory, cart and order writes. The catalogue is shared with the frontend through `shared/catalog.json`.

## Start and validate

From `ai-smart-mirror/backend`:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

On Linux/macOS, substitute `.venv/bin/python`. The local API docs are at `http://localhost:8000/docs`. Configure environment variables using `.env.example`; Uvicorn can load them with `--env-file .env`. Set `ADMIN_TOKEN` for deployment and `ALLOW_DEMO_ADMIN=false`. The Docker image already disables tokenless administration.

```powershell
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m ruff check app tests seed_catalog.py
.venv/Scripts/python.exe -m compileall -q app
```

Windows Application Control on the development computer blocks native Ruff. The checked-in official Ruff WebAssembly runner provides the same lint rules:

```powershell
cd tooling
npm ci
npm run lint
```

The rules are E/F/I/UP/B, Python 3.12, 110 columns, with `app` marked as a first-party package. The WebAssembly package is maintained in [Ruff's official source repository](https://github.com/astral-sh/ruff/tree/main/crates/ruff_wasm).

## Authentication and session ownership

Catalogue reads are public. Admin product writes, staff dashboard reads/updates and analytics require `Authorization: Bearer <ADMIN_TOKEN>`. With no token configured, explicit demo administration is allowed only from IPv4/IPv6 loopback. The Next proxy sets `X-Mirror-Proxy: 1`; backend tokenless demo access is always denied for proxied requests, because a remote browser would otherwise appear to be the loopback proxy. The proxy overwrites this marker itself. Set an admin token before connecting the browser dashboard to persistent store data. Disable demo admin and configure a token before network deployment.

Sessions have random 192-bit opaque identifiers which act as anonymous session bearers. Cart, staff and transfer operations require the active identifier. Identifiers expire after 60 minutes; end-session deletes carts, item rows, transfer tokens and temporary records. Staff fulfilment history loses its live session identifier. Analytics retains a SHA-256 grouping key, catalogue IDs, numeric counts and timestamps, without the original bearer, customer identity or body profile. Anonymous analytics events older than 30 days are deleted; counts and rankings describe retained events rather than lifetime customer activity. A background job removes expired data each minute while the backend runs, and reads also trigger cleanup. On restart, cleanup runs before accepting requests. The retention test verifies that old records disappear from both storage and analytics while recent events remain counted.

QR transfer tokens are separate random 192-bit values and expire after 15 minutes. Ending the originating mirror session immediately invalidates its transfers. They expose only the chosen look, catalogue/rack details and the server-calculated cart. A transfer does not contain camera frames, body landmarks, calibration or the mirror session bearer.

The analytics `dailyUsers` field counts anonymous sessions, not recognized people. Orders are demo orders with no payment processor. The 5% tax is configurable demo arithmetic, not a tax compliance determination.

## Endpoint contract

All monetary values use INR, with prices before tax. `Product`, `Look`, `CartItem` and `BodyProfile` match `frontend/lib/types.ts`. Input objects reject unknown fields; supported analytics transport fields are explicitly declared. Errors use FastAPI's `{detail: ...}` response. Deletes return HTTP 204.

| Endpoint | Request / behavior |
| --- | --- |
| `GET /api/health` | Storage and recommendation engine status, photo-storage flag |
| `GET /api/products` | Returns `Product[]`; optional category/gender/q/occasion/inStock filters |
| `GET /api/products/{id}` | A product or 404 |
| `POST /api/products` | Admin: complete Product; SKU and ID uniqueness checked |
| `PUT` or `PATCH /api/products/{id}` | Admin: complete Product, including stock/chart/assets; ID immutable |
| `DELETE /api/products/{id}` | Admin; active cart references prevent deletion |
| `POST /api/admin/assets` | Admin: raw PNG/JPEG/WebP bytes, matching Content-Type, maximum 5 MB; returns `{url}` |
| `POST /api/sessions` | `{station?, mode: 'demo' \| 'camera'}` → id, createdAt, expiresAt |
| `GET /api/sessions/{id}` | Active session metadata |
| `DELETE /api/sessions/{id}` | End session and purge temporary metadata |
| `POST /api/body-analysis` | `{landmarks: Landmark[33], heightCm?, source?}` → BodyProfile; accepts numeric landmarks only |
| `POST /api/style-score` | `{productId, color?, occasion?, profile?, sessionId?}` → StyleScore |
| `POST /api/size-recommendation` | Same request → size, confidence, approximate-fit disclaimer |
| `POST /api/recommendation` | Same request → in-stock same-silhouette products, per-item scores and explanation |
| `POST /api/compare` | `{outfits: StyleRequest[2..4]}` → scores, recommendedIndex, reason |
| `POST /api/assistant` | `{message, occasion?, productId?, budget?, sessionId?}` → message, grounded products, mode |
| `GET /api/cart/{sessionId}` | Items with Product metadata, subtotal, discount, tax, total |
| `POST /api/cart` | `{sessionId, productId, color, size, quantity, score?}`; increments matching variant |
| `PUT /api/cart/{sessionId}` | `{items: CartItem[]}`; validates complete replacement before changing state |
| `PATCH /api/cart/{sessionId}/items/{itemId}` | `{quantity}` with total product-stock validation |
| `DELETE /api/cart/{sessionId}/items/{itemId}` | Remove only this session's item |
| `POST /api/orders` | `{sessionId}`; atomic demo checkout, decrements stock, records actual order events |
| `POST /api/staff-request` | `{sessionId, productId, color, size, station?, score?}` → StaffRequest |
| `GET /api/staff-requests` | Staff/admin list; session bearers omitted |
| `PATCH /api/staff-requests/{id}` | `{status}`; Waiting → Accepted → Bringing Product → Completed |
| `POST /api/events` | `{id?, timestamp?, sessionId, type, productId?, color?, size?}`; idempotent client event ingestion |
| `POST /api/transfers` | `{sessionId, look?, cart?}` → token, expiresAt, phone URL; uses authoritative cart |
| `GET /api/transfers/{token}` | TTL-limited outfit/cart/store metadata |
| `GET /api/admin/analytics` | Actual counts, conversions, rankings, session durations and anonymous events |
| `GET /api/admin/overview` | Categories, inventory, demo orders, mirror stations and runtime settings |

`/api/events` records frontend-only try_on, compare, recommendation and save_look events once per client ID. It accepts but skips duplicated session_start/session_end/add_to_cart/cart_add/staff_request/qr_transfer notifications, because their authoritative API operations already record them. The server sets event timestamps. A purchase cannot be claimed through this endpoint; checkout records it after inventory validation.

Product stock is a shared count across offered size/color variants. It is checked for aggregate quantities across variants in each cart and again at checkout. Adding to a cart does not reserve inventory. Per-variant warehouse stock and payment capture remain future integrations.

Local upload URLs use `PUBLIC_ASSET_URL=/api/garment-assets` by default. The frontend proxies these public garment files from backend `/assets/{filename}`, so saved catalogue images work on the same browser/phone origin without exposing loopback URLs. Set this variable to a public HTTPS asset origin if deploying the API separately. Supabase uploads already return their public Storage URL. Only authorized product assets are written here; camera frames have no upload endpoint.

## Optional Supabase

No Supabase account or credentials are bundled. To connect a project:

1. Apply `backend/app/database/001_supabase.sql` in the project's SQL editor.
2. Create an administrator through Supabase Auth. Insert its verified UUID with role `admin` into `public.users` as shown in the migration. A `staff` role only receives staff-dashboard access.
3. Set `STORAGE_BACKEND=supabase`, `SUPABASE_URL=https://...supabase.co`, and server-only `SUPABASE_SERVICE_ROLE_KEY`.
4. Keep the backend to one worker. Do not expose the service-role key through any `NEXT_PUBLIC_*` variable.

The adapter uses all 20 requested domain tables plus `qr_transfers` and `settings`. Tables use a versionable JSON payload and primary key for local/cloud parity; typed schemas and retail relations are enforced by service validation. The migration adds useful session/event indexes, RLS, protected role lookup, catalogue-only public reads, a staff state-transition guard and a restricted garment-assets Storage bucket. Anonymous session/cart/transfer tables have no browser grants. Verified Supabase Auth access tokens are accepted by backend admin endpoints, and role decisions come from the protected users table. A shared admin token remains supported for a controlled MVP deployment.

Related Supabase writes are batched into the service-role-only `mirror_apply_operations` SQL transaction RPC. This prevents partial cart/order writes during errors. Cross-process checkout read/stock conflicts still require database row locks/version checks in a dedicated checkout RPC before horizontal scaling. Live Supabase RLS/Auth/Storage behavior requires deployment credentials and has not been tested against a cloud project; mocked transport/batch tests verify the adapter contract.

## Measurement and recommendation limits

Physical height cannot be inferred from one uncalibrated monocular frame. The API returns dimensionless shoulder/hip/torso ratios until the customer supplies height and visible head/ankle landmarks. Estimated physical chest dimensions are a broad heuristic, with size confidence capped at 82%. Bottom sizing currently uses the generic sample chart and needs dedicated waist/hip charts in a retail deployment. Low-visibility and degenerate landmarks return actionable errors.

Style/color/occasion scores are transparent deterministic catalogue rules. They are preference scores, not measured accuracy, attractiveness or a trained fashion model. The assistant interprets common occasion, category and budget requests and returns only available catalogue inventory. Complete-outfit requests enforce the combined budget before tax. No LLM credentials are needed or fabricated. Photorealistic VTON, tailored measurement calibration, payments and retailer inventory systems are future adapters.

## Docker

Build from `ai-smart-mirror` with `docker build -f docker/backend.Dockerfile -t ai-smart-mirror-api .`. Persist `/workspace/backend/data` as a volume, set a random `ADMIN_TOKEN`, restrict CORS to the frontend origin and publish port 8000 through your deployment platform. The image runs as an unprivileged user. Camera frames are processed by the frontend; neither SQLite nor Supabase stores customer photos.
