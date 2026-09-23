# Civic Resolution Gate

Citizen issue reports with an anti-fraud **Proof-of-Resolution AI gate**: a field worker's
"after" photo is accepted only when its EXIF GPS places it inside the reported H3 cell and it is
structurally similar enough to the original issue photo.

## Layout

- `server/` — Express API (in-memory store, `multer` uploads, `exifr` EXIF parsing, `h3-js` geo math)
- `client/` — static UI served by the API

## Gate rules

| Check | Rule | Outcome |
| --- | --- | --- |
| EXIF location audit | photo GPS within `MAX_DISTANCE_METERS` (50m) of the target H3 cell centre (`8c2a100d36bffff`) | fails → `REJECTED_LOCATION_MISMATCH` |
| Structural similarity audit | SSIM confidence ≥ `SIMILARITY_THRESHOLD` (65%) | fails → `PENDING_MANUAL_AUDIT`, flagged for District Collector Review |
| Both pass | — | `RESOLVED_VERIFIED` + "AI Ground Verified" badge in the UI |

Configuration lives in `server/src/config.js` and can be overridden with env vars.

## Running

```bash
cd server
npm install
npm start          # http://localhost:4000
npm test
```

## API

- `GET /api/config`
- `GET /api/reports`, `POST /api/reports` (multipart: `title`, `description`, `h3Cell`, `photo`)
- `GET /api/reports/:id`
- `POST /api/reports/:id/resolution` (multipart: `photo`) — runs the gate
