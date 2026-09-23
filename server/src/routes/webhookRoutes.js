const express = require('express');
const webhookController = require('../controllers/webhookController');

const router = express.Router();

router.post(
  '/whatsapp-webhook',
  express.urlencoded({ extended: false }),
  webhookController.handleWhatsAppWebhook,
);
router.get('/reports', webhookController.listReports);
router.get('/reports/:id/dpr', webhookController.getDpr);

module.exports = router;
