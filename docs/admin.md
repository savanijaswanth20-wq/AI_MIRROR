# Retail admin workspace

Open `/admin` for the separate retail workspace. It uses the same product and staff types as the customer mirror and has ten working views.

## Implemented

- **Dashboard:** recorded session and try-on counts, chronological session-to-cart conversion, actual activity over the last seven days, product rankings, low-stock attention and open staff requests.
- **Products:** search and category filtering; add, edit and remove products; name, SKU, brand, description, category, gender, price, discount, sizes, colors, stock, silhouette, five asset fields, per-size measurements, rack, floor, section, store and occasions. SKU and color names must be unique. Measurements and form limits match the backend schema.
- **Categories:** derives categories and available units from the catalogue. Selecting a category opens its filtered products. New category names are created through product editing.
- **Inventory:** editable quantities and rack locations with a save action for each changed row. Stock badges are computed from actual quantities.
- **Orders:** confirmed purchase-event rankings when they exist, with an explicit empty state otherwise. This panel is purchase analytics; it does not implement payments or an order fulfillment system.
- **Customers:** anonymous session activity only. It does not maintain customer identities, face images, saved body measurements or biometric profiles.
- **Mirror Stations:** configurable station names, physical placement, pause/enable flags and open-request counts. See the limitations below.
- **Staff Requests:** Waiting → Accepted → Bringing Product → Completed progression. Updates use the backend when available and retain local fallback behavior when it is offline.
- **AI Analytics:** actual try-ons, recommendations, compared products, selected sizes and colors, completed-session duration, and session conversion. CSV export contains recorded events, with spreadsheet formula escaping. A zero/empty state stays empty; charts contain no fabricated activity.
- **Settings:** session-only admin token configuration, locally saved brand size-chart JSON and a clear privacy summary.

## Connection and local development

The default API base is the same-origin `/api/backend` proxy. The local launcher provides an ephemeral backend admin token in server process memory and sets `MIRROR_LOCAL_DEMO=1` and `INTERNAL_ADMIN_TOKEN` for Next.js. The proxy adds the token to local backend requests, so a separate token entry is unnecessary in the default local demo. The browser does not receive this internal token.

For an independently hosted API, configure `NEXT_PUBLIC_API_URL` with the API base including `/api` and enter its backend admin token in Settings. That token is stored in `sessionStorage` under `mirror.admin.token`, cleared when the tab session ends, and sent as a bearer header only to the configured API. Production deployments must not enable the local demo bridge.

On entry, and every 15 seconds, the dashboard fetches products, staff requests and protected analytics. **Sync store** performs the same refresh on demand. Local store changes also trigger a debounced refresh. Protected API analytics replace local events as the authoritative dataset; hashed backend session identifiers are never merged with local session identifiers.

Only a local proxy `503` or a network connection failure enables mutation fallback to browser storage. Authentication failures (`401`/`403`), validation failures and other API errors remain visible and do not silently write local changes. The header distinguishes an actual successful protected connection from local demo mode.

Offline product and staff edits live in this browser; they are not an automatic synchronization queue. When the API returns, its catalogue and requests are authoritative. Use the connected store for durable edits.

## Garment asset handling

The **Real garment photo** studio locally prepares a front-facing garment photograph or existing transparent PNG. It previews the original and cutout, provides background sensitivity and reset controls, and preserves photographed colors. Use a plain contrasting backdrop: uneven backgrounds and same-color fabric cannot be reliably removed by the local color-based algorithm. Select **Apply photo to overlay**, then **Save product**. The catalogue/front image changes only when the explicit checkbox is enabled. Only the prepared PNG is uploaded, with no camera frames or customer photos involved. Source photos may be up to 12 MB; normalized exports still obey the 2 MB asset limit.

Uploads accept PNG, SVG, JPEG and WebP, limited to 2 MB. SVG uploads are parsed and reject scripts, active content, embedded images, styles, animation, entity declarations and external references. Connected SVG uploads are rasterized locally to a transparent PNG before posting raw bytes to `/api/admin/assets`. The backend validates uploaded files independently.

Default local backend asset URLs are displayed through the same-origin `/api/garment-assets/{file}` proxy, allowing a reachable frontend to serve assets to other devices. When the local backend is unavailable, validated assets remain as local data URLs. No uploaded SVG is inserted into HTML.

## Explicit MVP limits

- Station placement and availability configuration uses browser storage (`mirror.admin.stations`). It does not register devices with the backend, send live device heartbeats, remotely enable/disable a camera, or change the customer mirror's station identity. Those controls currently organise the store workspace only. Each card explicitly reports that a live heartbeat is not connected.
- Brand size charts use browser storage (`mirror.admin.sizeCharts`) keyed by brand and size. This is local configuration, not a cloud settings API. The customer recommendation engine can use it in the same browser.
- Product stock is an aggregate total per product. This MVP does not maintain separate quantities for every color/size combination.
- The Orders view reports purchase events rather than creating real purchases or fictional conversion data.
- Analytics report retained recorded events, not visitor identities. Average duration uses only sessions with a recorded start and end, and daily activity follows the browser's local date.

## Validation

The admin source passes TypeScript strict checking and ESLint. Earlier MVP browser verification confirmed the connected dashboard, its original 44 catalogue products, the complete product editor, and an unchanged product update through the local protected API bridge. The photo preparation helper has eight automated tests. See [verification.md](verification.md) for the 46-product photo update checks and the remaining upload walkthrough limitation.
