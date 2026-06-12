const express = require('express');
const bookingService = require('../services/bookingService');
const memberService  = require('../services/memberService');
const { authenticateLiff } = require('../middleware/auth');
const { query } = require('../config/database');
const logger = require('../config/logger');

const router = express.Router();

// ─── WALK-IN (Type 1a) ────────────────────────────────────────────────────────

// Start a walk-in order (scan QR at table)
router.post('/walkin', authenticateLiff, async (req, res) => {
  try {
    const member = await memberService.getMemberByLineId(req.lineUserId);
    const { branchId, tableNumber, items } = req.body;
    if (!branchId || !tableNumber || !items?.length)
      return res.status(400).json({ error: 'branchId, tableNumber, items required' });

    const order = await bookingService.createWalkinOrder({
      memberId: member?.id || null, branchId, tableNumber, items
    });
    res.status(201).json({ success: true, order });
  } catch (err) {
    logger.error('Walk-in order error', err);
    res.status(500).json({ error: err.message });
  }
});

// Add more items to existing walk-in order
router.post('/walkin/:id/items', authenticateLiff, async (req, res) => {
  try {
    await bookingService.addWalkinItems(req.params.id, req.body.items);
    const order = await bookingService.getWalkinOrder(req.params.id);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get walk-in order status
router.get('/walkin/:id', async (req, res) => {
  const order = await bookingService.getWalkinOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  res.json(order);
});

// ─── RESERVATION (Type 1b — จองล่วงหน้า + 50% deposit) ──────────────────────

router.post('/reservation', authenticateLiff, async (req, res) => {
  try {
    const member = await memberService.getMemberByLineId(req.lineUserId);
    if (!member) return res.status(404).json({ error: 'Not registered' });

    const { branchId, partySize, bookingDate, bookingTime, notes, preOrderItems } = req.body;
    if (!branchId || !partySize || !bookingDate || !bookingTime)
      return res.status(400).json({ error: 'branchId, partySize, bookingDate, bookingTime required' });
    if (!preOrderItems?.length)
      return res.status(400).json({ error: 'กรุณาเลือกเมนูอย่างน้อย 1 รายการเพื่อชำระมัดจำ' });

    const result = await bookingService.createReservation({
      memberId: member.id, branchId, partySize,
      bookingDate, bookingTime, notes, preOrderItems
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    logger.error('Reservation error', err);
    res.status(500).json({ error: err.message });
  }
});

// Confirm deposit paid (called after LINE Pay / payment gateway callback)
router.post('/reservation/:id/deposit', authenticateLiff, async (req, res) => {
  try {
    const { txRef } = req.body;
    if (!txRef) return res.status(400).json({ error: 'txRef required' });
    const booking = await bookingService.confirmDeposit(req.params.id, txRef);
    res.json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GROUP BOOKING (Type 2) ────────────────────────────────────────────────────

router.post('/group', authenticateLiff, async (req, res) => {
  try {
    const member = await memberService.getMemberByLineId(req.lineUserId);
    if (!member) return res.status(404).json({ error: 'Not registered' });

    const { branchId, partySize, bookingDate, bookingTime,
            packageId, contactName, contactPhone, occasion, preOrderItems } = req.body;
    if (!contactName || !contactPhone)
      return res.status(400).json({ error: 'contactName and contactPhone required for group booking' });
    if (partySize < 6)
      return res.status(400).json({ error: 'การจองหมู่คณะต้องมีอย่างน้อย 6 ท่าน' });

    const result = await bookingService.createGroupBooking({
      memberId: member.id, branchId, partySize, bookingDate, bookingTime,
      packageId, contactName, contactPhone, occasion,
      preOrderItems: preOrderItems || []
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    logger.error('Group booking error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get group packages
router.get('/packages', async (req, res) => {
  const res2 = await query('SELECT * FROM group_packages WHERE is_active=TRUE ORDER BY min_persons');
  res.json({ packages: res2.rows });
});

// ─── SHARED ────────────────────────────────────────────────────────────────────

router.get('/', authenticateLiff, async (req, res) => {
  const member = await memberService.getMemberByLineId(req.lineUserId);
  if (!member) return res.status(404).json({ error: 'Not registered' });
  const res2 = await query(
    `SELECT b.*, COUNT(po.id) as pre_order_count
     FROM bookings b
     LEFT JOIN pre_orders po ON po.booking_id=b.id
     WHERE b.member_id=$1
     GROUP BY b.id ORDER BY b.booking_date DESC LIMIT 20`,
    [member.id]
  );
  res.json({ bookings: res2.rows });
});

router.get('/:id', authenticateLiff, async (req, res) => {
  const booking = await bookingService.getBookingWithPreOrders(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Not found' });
  res.json(booking);
});

router.delete('/:id', authenticateLiff, async (req, res) => {
  const member = await memberService.getMemberByLineId(req.lineUserId);
  if (!member) return res.status(404).json({ error: 'Not registered' });
  const result = await bookingService.cancelBooking(req.params.id, member.id);
  res.json({ success: true, ...result });
});

module.exports = router;

// ─── Walk-in real-time actions ───────────────────────────
const lineService = require('../services/lineService');

// 🔔 Call staff
router.post('/walkin/:id/call-staff', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await bookingService.getWalkinOrder(id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Push Flex Message to LINE OA group/staff channel
    await lineService.pushMessage(process.env.STAFF_LINE_GROUP_ID, {
      type: 'flex',
      altText: `🔔 โต๊ะ ${order.table_number} เรียกพนักงาน`,
      contents: {
        type: 'bubble',
        header: { type: 'box', layout: 'vertical', backgroundColor: '#e6538d',
          contents: [{ type: 'text', text: '🔔 เรียกพนักงาน', color: '#ffffff', weight: 'bold', size: 'lg' }]
        },
        body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: `โต๊ะ: ${order.table_number}`, weight: 'bold', size: 'xl' },
          { type: 'text', text: `สาขา: ${order.branch_id}`, color: '#666666' },
          { type: 'text', text: `เวลา: ${new Date().toLocaleTimeString('th-TH')}`, color: '#888888', size: 'sm' }
        ]}
      }
    });

    res.json({ success: true, message: 'เรียกพนักงานแล้ว' });
  } catch (err) {
    logger.error('call-staff error', err);
    res.status(500).json({ error: err.message });
  }
});

// 🧾 Request bill + generate verify QR
router.post('/walkin/:id/request-bill', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await bookingService.getWalkinOrder(id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Generate a one-time verify token
    const verifyToken = require('uuid').v4();
    const redis = require('../config/redis');
    await redis.set(`bill_verify:${verifyToken}`, JSON.stringify({ orderId: id, tableNumber: order.table_number }), 'EX', 900);

    // QR code URL for staff to scan
    const QRCode = require('qrcode');
    const verifyUrl = `${process.env.APP_URL}/liff/staff-verify.html?token=${verifyToken}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl);

    // Push bill notification to staff
    await lineService.pushMessage(process.env.STAFF_LINE_GROUP_ID, {
      type: 'flex',
      altText: `🧾 โต๊ะ ${order.table_number} ขอเช็คบิล`,
      contents: {
        type: 'bubble',
        header: { type: 'box', layout: 'vertical', backgroundColor: '#4dc8f4',
          contents: [{ type: 'text', text: '🧾 ขอเช็คบิล', color: '#ffffff', weight: 'bold', size: 'lg' }]
        },
        body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: `โต๊ะ: ${order.table_number}`, weight: 'bold', size: 'xl' },
          { type: 'text', text: `ยอด: ฿${order.total_amount?.toLocaleString('th-TH') || '—'}`, color: '#e6538d', weight: 'bold', size: 'lg' },
          { type: 'text', text: 'สแกน QR เพื่อ verify ก่อนรับเงิน', color: '#555555', wrap: true }
        ]},
        footer: { type: 'box', layout: 'vertical', contents: [{
          type: 'button', action: { type: 'uri', label: '🔍 เปิด Staff Verify', uri: verifyUrl },
          style: 'primary', color: '#e6538d'
        }]}
      }
    });

    res.json({ success: true, verifyToken, qrDataUrl, verifyUrl });
  } catch (err) {
    logger.error('request-bill error', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Staff verify bill
router.post('/walkin/verify-bill', async (req, res) => {
  try {
    const { token, staffId, action } = req.body; // action: 'confirm' | 'add_item'
    const redis = require('../config/redis');
    const data = await redis.get(`bill_verify:${token}`);
    if (!data) return res.status(400).json({ error: 'Token หมดอายุ หรือไม่ถูกต้อง' });

    const { orderId } = JSON.parse(data);
    const order = await bookingService.getWalkinOrder(orderId);

    if (action === 'confirm') {
      await bookingService.markBillVerified(orderId, staffId);
      await redis.del(`bill_verify:${token}`);
      // Award points to customer
      if (order.member_id) {
        const loyaltyService = require('../services/loyaltyService');
        await loyaltyService.earnPoints(order.member_id, order.total_amount, 'WALKIN', orderId);
      }
    }

    res.json({ success: true, order, action });
  } catch (err) {
    logger.error('verify-bill error', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Quotation ────────────────────────────────────────
const quotationService = require('../services/quotationService');
const path = require('path');
const fs   = require('fs');

// Generate + send quotation
router.post('/group/:id/quotation', async (req, res) => {
  try {
    const { lineUserId, email } = req.body;
    const result = await quotationService.sendQuotation(req.params.id, { lineUserId, email });
    res.json(result);
  } catch (err) {
    logger.error('Quotation error', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve quotation HTML
router.get('/quotations/:number', async (req, res) => {
  const QDIR = process.env.QUOTATION_DIR || '/tmp/quotations';
  const files = fs.readdirSync(QDIR).filter(f => f.includes(req.params.number));
  if (!files.length) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(fs.readFileSync(path.join(QDIR, files[0]), 'utf8'));
});

// Save group menu selection
router.post('/group/:id/menu', async (req, res) => {
  try {
    const { items, totalBudget, headCount } = req.body;
    const { query: dbQuery } = require('../config/database');
    // Clear old pre-orders
    await dbQuery('DELETE FROM pre_orders WHERE booking_id=$1', [req.params.id]);
    // Insert new
    for (const item of items) {
      await dbQuery(
        `INSERT INTO pre_orders (booking_id, menu_item_id, quantity, special_requests)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, item.menuItemId, item.quantity, item.name]
      );
    }
    await dbQuery(
      `UPDATE bookings SET total_amount=$1, party_size=COALESCE($2,party_size) WHERE id=$3`,
      [totalBudget, headCount, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
