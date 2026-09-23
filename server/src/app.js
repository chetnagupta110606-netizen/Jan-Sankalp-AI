const path = require('path');
const express = require('express');
const config = require('./config');
const routes = require('./routes');

function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', '..', 'client')));

  app.get('/api/config', (_req, res) => {
    res.json({
      targetH3Cell: config.targetH3Cell,
      maxDistanceMeters: config.maxDistanceMeters,
      similarityThreshold: config.similarityThreshold,
    });
  });

  app.use('/api', routes);

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
