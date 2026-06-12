const express = require('express');
const rfmService      = require('../services/rfmService');
const memberService   = require('../services/memberService');
const qrService       = require('../services/qrService');
const campaignService = require('../services/campaignService');
const { authenticateAdmin } = require('../middleware/auth');
const { query } = require('../config/database');

const router = express.Router();

router.use(authenticateAdmin);

// Overview stats
router.get('/stats', async (req, res) => {
  const { branchId } = req.query;
  const stats = await rfmService.getDashboardStats(branchId || null);
  res.json(stats);
});

// RFM segment breakdown
router.get('/rfm', async (req, res) => {
  const { branchId } = req.query;
  const rfm = await rfmService.getRFMReport(branchId || null);
  res.json({ rfm });
});

// Churn risk members
router.get('/churn-risk', async (req, res) => {
  const members = await rfmService.getChurnRisk();
  res.json({ members });
});

// Campaign performance
router.get('/campaigns', async (req, res) => {
  const res2 = await query(
    `SELECT c.name, c.type, c.status, c.target_segment,
       COUNT(cl.id) as sent,
       SUM(CASE WHEN cl.opened=TRUE THEN 1 ELSE 0 END) as opened
     FROM campaigns c
     LEFT JOIN campaign_logs cl ON cl.campaign_id=c.id
     GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50`
  );
  res.json({ campaigns: res2.rows });
});

// Branch-level bookings
router.get('/bookings', async (req, res) => {
  const { date, branchId } = req.query;
  const bookings = await (require('../services/bookingService').getBookingsByDate)(
    branchId, date || new Date().toISOString().slice(0,10)
  );
  res.json({ bookings });
});

// QR code stats
router.get('/qr', async (req, res) => {
  const { branchId } = req.query;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  const qrs = await qrService.getQRStats(branchId);
  res.json({ qrs });
});

// Generate new QR code
router.post('/qr', async (req, res) => {
  const qr = await qrService.generateUTMQR(req.body);
  res.status(201).json(qr);
});

// Badge leaderboard
router.get('/badges', async (req, res) => {
  const res2 = await query(
    `SELECT b.name, COUNT(mb.id) as awarded
     FROM badges b
     LEFT JOIN (
       SELECT (jsonb_array_elements_text(badges_earned::jsonb))::text as badge, id FROM members
     ) mb ON mb.badge = b.name
     GROUP BY b.name ORDER BY awarded DESC`
  );
  res.json({ badges: res2.rows });
});

module.exports = router;
