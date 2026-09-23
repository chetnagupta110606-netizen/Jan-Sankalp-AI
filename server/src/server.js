/**
 * Jan-Sankalp AI — Backend Microservice Entry Point
 * ------------------------------------------------------------------
 * Runs independently on port 5000 and exposes the versioned REST API
 * under /api/v1. CORS is enabled so the decoupled SPA client (served
 * from any origin, e.g. http://localhost:5500) can consume the API.
 * ------------------------------------------------------------------
 */

// Load environment variables from .env (if present) before anything else.
try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const express = require('express');
const cors = require('cors');

const db = require('./config/database');
const { runMigration } = require('./config/migrate');
const apiRoutes = require('./routes/apiRoutes');
const { startEscalationScheduler } = require('./services/escalationService');

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// ── Global middleware ──────────────────────────────────────────────
// Allow cross-origin requests from the decoupled client.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Lightweight request logger (defensive; never throws).
app.use((req, res, next) => {
  try {
    console.log(`[api] ${req.method} ${req.originalUrl}`);
  } catch (_) { /* no-op */ }
  next();
});

// ── Routes ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'Jan-Sankalp AI Backend',
    status: 'online',
    docs: '/api/v1/health',
    persistence: db.mode
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', persistence: db.mode, timestamp: new Date().toISOString() });
});

app.use('/api', apiRoutes);
app.use('/api/v1', apiRoutes);

// ── 404 + error handlers ───────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err && err.message);
  res.status(500).json({ success: false, error: 'Internal server error.', details: err && err.message });
});

// ── Bootstrap ──────────────────────────────────────────────────────
async function start() {
  try {
    await db.init();
    await runMigration();
  } catch (err) {
    console.warn('[server] Startup DB init warning (continuing):', err.message);
  }

  // Start escalation scheduler
  try {
    startEscalationScheduler(60); // Check every 60 minutes
  } catch (err) {
    console.warn('[server] Escalation scheduler warning (continuing):', err.message);
  }

  const server = app.listen(PORT, () => {
    console.log('');
    console.log('════════════════════════════════════════════════════════');
    console.log(`  Jan-Sankalp AI Backend running on http://localhost:${PORT}`);
    console.log(`  API base        : http://localhost:${PORT}/api/v1`);
    console.log(`  Persistence mode: ${db.mode}`);
    console.log(`  Escalation scheduler: Active (60min intervals)`);
    console.log('════════════════════════════════════════════════════════');
    console.log('');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] Port ${PORT} is already in use. Set PORT to override.`);
    } else {
      console.error('[server] Fatal server error:', err.message);
    }
    process.exit(1);
  });

  process.on('SIGINT', () => {
    console.log('\n[server] Shutting down gracefully...');
    server.close(() => process.exit(0));
  });
}

start();

module.exports = app;