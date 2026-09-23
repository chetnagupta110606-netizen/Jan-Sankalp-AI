const config = require('../config');
const { createReport, getReport, listReports, toPublicJson } = require('../store');

function create(req, res) {
  const { title, description, h3Cell } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  const report = createReport({
    title,
    description,
    h3Cell: h3Cell || config.targetH3Cell,
    photo: req.file
      ? { buffer: req.file.buffer, mimetype: req.file.mimetype }
      : null,
  });

  return res.status(201).json(toPublicJson(report));
}

function list(_req, res) {
  return res.json(listReports().map(toPublicJson));
}

function get(req, res) {
  const report = getReport(req.params.id);
  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }
  return res.json(toPublicJson(report));
}

module.exports = { create, list, get };
