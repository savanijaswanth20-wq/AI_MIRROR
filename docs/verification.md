# Local verification · 8 October 2026

The MVP runs locally with Next.js on 127.0.0.1:3000 and FastAPI on 127.0.0.1:8000. Both are started by `node scripts/dev-local.mjs`, which generates admin authorization in memory. SQLite data remains outside Git.

## Automated checks

| Check | Result |
| --- | --- |
| Frontend ESLint | Passed, no warnings |
| TypeScript strict check | Passed |
| Frontend Vitest | 39 tests passed across geometry, photo crop/alignment, local background preparation, motion prediction, recommendations, customer session isolation and analytics privacy |
| Next.js production build | Passed; customer, admin, transfer and API proxy routes generated |
| Backend pytest | 26 tests passed; one upstream Starlette TestClient deprecation warning |
| Backend Ruff WebAssembly | Passed, zero diagnostics |
| Python compileall / pip check | Passed |
| Production npm dependency audit | Zero reported vulnerabilities |

Backend tests cover access control, frame rejection, validation, inventory and cart transactions, staff transitions, transfer/session expiry, orders, Supabase transaction adapters and removal of analytics older than 30 days. The SVG sanitizer was also checked with mocked DOMParser/FileReader against accepted standard namespaces and rejected scripts, events and external references.

The full npm audit still reports five high findings in development-only lint dependencies (braces/micromatch/fast-glob through eslint-config-next). The available compatible package tree does not yet remove them. They are absent from the production dependency audit.

## Browser checks

Verified with the Codex in-app browser:

- Catalogue filtering, selected product, garment color changes and moving illustrated overlay.
- Live camera model initialization, local inference, no-person guidance and camera stop. A no-person camera test displayed approximately 19 FPS; this is not a hardware benchmark or evidence of real-person fit accuracy.
- Bag addition, quantities, removal and displayed discount/tax/total.
- Saved outfit metadata, comparison scores and inventory-grounded assistant budget suggestions.
- Staff request appearing in the admin dashboard and its status transition.
- Expiring QR transfer showing product, color, size, quantity, price, score and rack location.
- Ending a customer session clears its metadata; a second tab cannot erase the first tab's bag.
- Browser analytics store independent anonymous identifiers; legacy session access tokens are sanitized without recursive store notifications.
- Narrow mobile layout without horizontal page overflow.

The saved [customer preview](preview.jpg) contains only an original illustrated mannequin, not a customer's photograph. A [dashboard preview](admin-preview.jpg) records the connected local store workspace.

For the photo-clothing update, browser checks confirmed both photographic samples in the 46-product catalogue, the photo-only filter, the rendered sweater overlay on the demo mannequin, width adjustment to 130%, and reset to 100% when switching garments. No browser console errors were recorded in that walkthrough. Subsequent localhost browser access was declined, so the final admin photo upload/save walkthrough was not completed. Updated live-camera motion has automated prediction/dropout tests and source review, but has not been validated with a person on camera.

## Remaining boundaries

Supabase, Vercel and Railway were skipped at the user's request. Supabase schema/adapters are prepared but not validated against a real cloud project. Docker recipes were source-reviewed, including SQLite volume ownership and build-context exclusions; no Docker engine build was performed.

QR links using a loopback address work on this computer. Physical phone transfer needs a reachable frontend address and a suitable HTTPS/LAN configuration. The default launcher intentionally binds to loopback.

The overlay is a 2D pose-tracked approximation. Recommendations and assistant replies use catalogue rules. Physical customer motion, fit, lighting, latency and occlusion must be evaluated on store hardware. Size estimates need optional height calibration and remain approximate. No photorealistic VTON, payment processor or production cloud authentication has been connected.

Git is local only. Connected GitHub tools allowed account/repository inspection but did not expose repository creation; the local GitHub CLI token was invalid. No remote repository was created or overwritten.
