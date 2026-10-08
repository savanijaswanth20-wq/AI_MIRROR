# AI SMART MIRROR

**TRY BEFORE YOU WEAR** — a working retail MVP with a Next.js fitting room, browser-local MediaPipe tracking, animated garment overlays and a FastAPI store service.

## Run locally

Dependencies are installed in this checkout. From this directory:

```powershell
node scripts/dev-local.mjs
```

Open **http://127.0.0.1:3000** and **http://127.0.0.1:3000/admin**. The launcher starts both servers, restricts them to this computer and generates local admin authorization in process memory. Stop it with Ctrl+C. If a server is already running, use it or stop that server before launching another copy.

For a fresh checkout:

```powershell
cd frontend
npm ci
cd ../backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-lock.txt
cd tooling
npm ci
cd ..
cd ..
node scripts/dev-local.mjs
```

## Try the demo

Choose a piece, switch colors and size, then compare or save looks. Add pieces to your bag, call staff and view the request in the store dashboard. The assistant filters the actual catalogue by occasion and budget. Scan QR creates an expiring metadata transfer. Demo models are original illustrations; no camera is needed.

Choose **Live camera** for pose, face and segmentation tracking. Allow camera permission, keep shoulders and hips visible, and step back for lower-body items. **Calibrate** accepts your height for approximate measurements. **Tracking details** shows body landmarks. Bundled model files avoid a CDN dependency. Camera pixels are never uploaded.

## Checks

```powershell
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
cd ../backend
.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider
.venv/Scripts/python.exe -m compileall -q app
node tooling/lint.cjs
```

The Ruff WebAssembly wrapper is provided because native Ruff execution is blocked by this machine’s application-control policy. This does not disable that policy.

## Store and deployment

There are 44 seeded products, with catalogue metadata, sizes, colors, charts, location, stock and original transparent SVG assets. The dashboard supports products, categories, inventory, orders, anonymous sessions, mirror stations, staff requests, analytics and settings.

SQLite is the default store. `.env.example` files document Supabase, authentication, storage and hosting configuration. The Supabase migrations and storage adapter are prepared; the user chose to skip cloud setup, so **Supabase, Vercel and Railway have not been configured or deployed**. Docker recipes are under `docker/`.

A phone cannot open this computer’s localhost address. Phone transfers need a reachable HTTPS frontend and backend. For an authenticated LAN demonstration, run the frontend on a LAN interface, set the reachable transfer origin, and configure admin authorization explicitly. Do not expose the automatic local-admin bridge or tokenless demo admin on a public interface.

Read [architecture and limits](docs/architecture.md), [backend API](docs/backend.md), [camera and overlay](docs/vision.md), and [verified checks](docs/verification.md). This MVP uses 2D tracking and rule-based recommendations; photorealistic VTON, exact sizing, real checkout and production cloud authentication remain future integrations.

Local Git history is included. No GitHub repository was created or pushed: the connected GitHub tools expose repository inspection, while repository creation is unavailable and the local GitHub CLI token is invalid. No unrelated repository was modified.
