const express = require('express');
const multer = require('multer');
const config = require('./config');
const reportController = require('./controllers/reportController');
const resolutionController = require('./controllers/resolutionController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

const router = express.Router();

router.get('/reports', reportController.list);
router.post('/reports', upload.single('photo'), reportController.create);
router.get('/reports/:id', reportController.get);
router.post(
  '/reports/:id/resolution',
  upload.single('photo'),
  resolutionController.submitResolution,
);

module.exports = router;
