# Jan-Sankalp AI

A decoupled, production-ready civic grievance platform. Citizens report
infrastructure issues by voice; the platform parses the transcript, grounds it
geospatially (H3 hexagons), assigns a government SLA target date, verifies
claims against dual-layer satellite imagery, and persists everything in a real
database so records survive server restarts.

```
┌──────────────────────┐        HTTP / CORS        ┌───────────────────────────┐
│   /client  (SPA)     │  ───────────────────────▶ │   /server  (REST API)      │
│   port 5500          │   http://localhost:5000   │   port 5000                │
│   Leaflet • Speech   │ ◀───────────────────────  │   Express • /api/v1        │
│   Web Speech API     │                           │   PostgreSQL/PostGIS       │
│   DPR PDF export     │                           │   (file-store fallback)    │
└──────────────────────┘                           └───────────────────────────┘
                                                                  │
                                                                  ▼
                                                   incidents table / .data store
```

---

## 1. Architecture

### Frontend — `/client`
| Path | Purpose |
|------|---------|
| `client/package.json` | Zero-dependency `npm start` static server |
| `client/server.js` | Static SPA server on **port 5500** |
| `client/src/index.html` | Application shell (Tailwind + Leaflet + jsPDF) |
| `client/src/app.js` | Voice ingestion, map rendering, satellite verification, DPR export |
| `client/src/styles.css` | Design system / theme |

### Backend — `/server`
| Path | Purpose |
|------|---------|
| `server/package.json` | Express + `pg` + `cors` + `dotenv` |
| `server/src/server.js` | Express entry point, **port 5000**, CORS enabled |
| `server/src/config/database.js` | DB service layer (PostgreSQL pool + file-backed fallback) |
| `server/src/config/migrate.js` | Idempotent schema/migration for the `incidents` table |
| `server/src/models/incidentModel.js` | Typed DB schema queries |
| `server/src/services/civicService.js` | Region catalogue, transcript parsing, H3, SLA logic |
| `server/src/controllers/` | `ingest`, `geospatial`, `satellite`, `dpr` handlers |
| `server/src/routes/apiRoutes.js` | All endpoints under `/api/v1` |

---

## 2. API Endpoints (`http://localhost:5000/api/v1`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/health` | Service health probe |
| `POST` | `/ingest` | Parse transcript → SLA target → persist → return incident JSON |
| `GET`  | `/incidents` | Fetch all reported incidents from the database |
| `GET`  | `/incidents/:id` | Fetch one incident |
| `GET`  | `/heatmap` | GeoJSON feature collection of incidents + monitored regions |
| `POST` | `/update-cluster-status` | Update an incident's status/ministry/target date |
| `POST` | `/verify-satellite` | Dual-layer spatial imagery comparison telemetry |
| `POST` | `/dpr` | Generate complete report metadata from DB records |
| `GET`  | `/dpr` · `/dpr/:id` | Convenience DPR lookups |

---

## 3. Running the project

### Prerequisites
- Node.js **≥ 18**

### One-time install
```bash
npm run install:all
```

### Start both services (recommended)
```bash
npm start
```
This launches the backend on `http://localhost:5000` and the SPA on
`http://localhost:5500`.

### Start services separately
```bash
npm run start:server   # http://localhost:5000
npm run start:client   # http://localhost:5500
```

Then open **http://localhost:5500** in Chrome or Edge (required for the Web
Speech API).

---

## 4. Database & Persistence

The server ships with a **dynamic two-mode persistence layer**:

1. **PostgreSQL + PostGIS** — used automatically when any of these environment
   variables are present: `DATABASE_URL`, `PGHOST`, `PGDATABASE`, or `PGUSER`.
2. **File-backed store** — used automatically when no DB env vars are set.
   Records are written to `server/.data/incidents.json` and reloaded on
   startup, so data persists across restarts with zero infrastructure.

To enable PostgreSQL:
```bash
cd server
cp .env.example .env       # then edit .env with your credentials
npm run migrate            # creates the incidents table + indexes
npm start
```

### `incidents` table schema
| Column | Type |
|--------|------|
| `id` | SERIAL PRIMARY KEY |
| `transcript` | TEXT |
| `category` | VARCHAR(255) |
| `urgency` | VARCHAR(64) |
| `status` | VARCHAR(64) |
| `location_name` | VARCHAR(255) |
| `h3_index` | VARCHAR(128) |
| `latitude` | DOUBLE PRECISION |
| `longitude` | DOUBLE PRECISION |
| `assigned_ministry` | VARCHAR(255) |
| `target_completion_date` | DATE |
| `created_at` | TIMESTAMP (default `CURRENT_TIMESTAMP`) |

---

## 5. Key frontend behaviours
- **Real-time voice streaming** via the Web Speech API with interim results,
  recording-state toggles and explicit handlers for blocked microphones
  (`not-allowed`), missing devices (`audio-capture`) and silence (`no-speech`).
- **Leaflet maps** render reliably using layered `map.invalidateSize()` calls
  after mount, after data load and on window resize — eliminating gray tiles.
- **DPR PDF export** fetches live records from `/api/v1/dpr` and opens a
  multi-section official print preview.
- **Defensive null checks** throughout so missing DOM nodes or API fields never
  throw console errors.