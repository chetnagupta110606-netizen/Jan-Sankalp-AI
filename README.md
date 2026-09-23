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

## WhatsApp / webhook ingestion

`POST /api/v1/telecom/whatsapp-webhook` ingests Twilio WhatsApp messages (text, voice notes,
photos, shared location pins):

1. Twilio signature is verified when `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` are set.
2. Voice media is transcribed through the speech-to-text provider (`STT_PROVIDER=openai` with
   `OPENAI_API_KEY`); without a provider the message text body is used instead.
3. The transcript/text is run through the NLP location extractor (shared pin wins over the
   gazetteer) and mapped to an H3 cell — "Jaipur" resolves to `8c2a100d36bffff`.
4. The report is written to PostGIS when `DATABASE_URL` is set (table `telecom_reports`,
   `GEOGRAPHY(POINT, 4326)`), otherwise kept in memory.
5. A DPR PDF is generated into `server/generated/dpr/<trackingId>.pdf`.
6. An acknowledgement is sent back over WhatsApp via the Twilio REST API, falling back to a
   TwiML `<Message>` reply when credentials are absent:

   > Jan-Sankalp AI: Your emergency infrastructure report for Jaipur Walled City has been grounded. H3 Cell ID: 8c2a100d36bffff. Track DPR Audit: https://jansankalp.ai/track/JS-2026-001

### Environment variables

| Variable | Purpose |
| --- | --- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | outbound WhatsApp replies + signature validation |
| `TWILIO_VALIDATE_SIGNATURE=false` | disable signature checks locally |
| `PUBLIC_WEBHOOK_URL` | exact public URL Twilio signs (behind a proxy/tunnel) |
| `STT_PROVIDER`, `OPENAI_API_KEY`, `STT_MODEL`, `STT_ENDPOINT` | speech-to-text |
| `DATABASE_URL` | PostGIS connection string |
| `TRACKING_BASE_URL`, `DPR_OUTPUT_DIR` | tracking links and DPR output location |

## API

- `GET /api/config`
- `POST /api/v1/telecom/whatsapp-webhook` (Twilio form encoded; `?format=json` returns the parsed report)
- `GET /api/v1/telecom/reports`, `GET /api/v1/telecom/reports/:id/dpr`
- `GET /api/reports`, `POST /api/reports` (multipart: `title`, `description`, `h3Cell`, `photo`)
- `GET /api/reports/:id`
- `POST /api/reports/:id/resolution` (multipart: `photo`) — runs the gate
