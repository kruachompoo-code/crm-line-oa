const express = require('express');
const memberService  = require('../services/memberService');
const loyaltyService = require('../services/loyaltyService');
const pdpaService    = require('../services/pdpaService');
const rfmService     = require('../services/rfmService');
const { authenticateLiff } = require('../middleware/auth');
const logger = require('../config/logger');

const router = express.Router();

// Register new member from LIFF onboarding
router.post('/register', async (req, res) => {
  try {
    const { lineUserId, displayName, pictureUrl, phone, birthday, branchId, referralCode } = req.body;
    if (!lineUserId) return res.status(400).json({ error: 'lineUserId required' });

    let member = await memberService.getMemberByLineId(lineUserId);
    if (member) return res.status(409).json({ error: 'Already registered', member });

    member = await memberService.createMember({
      lineUserId, displayName, pictureUrl, phone, birthday, branchId, referralCode
    });

    await loyaltyService.issueWelcomeCoupon(member.id);
    res.status(201).json({ success: true, member });
  } catch (err) {
    logger.error('Register error', err);
    res.status(500).json({ error: err.message });
  }
});

// Get member profile + points + tier
router.get('/profile', authenticateLiff, async (req, res) => {
  try {
    const member  = await memberService.getMemberByLineId(req.lineUserId);
    if (!member) return res.status(404).json({ error: 'Not registered' });
    const rfm     = await rfmService.getMemberRFM(member.id);
    const coupons = await loyaltyService.getMemberCoupons(member.id);
    res.json({ member, rfm, coupons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update profile (name, phone, birthday, prefs)
router.put('/profile', authenticateLiff, async (req, res) => {
  try {
    const member = await memberService.getMemberByLineId(req.lineUserId);
    if (!member) return res.status(404).json({ error: 'Not registered' });

    const allowed = ['name', 'phone', 'birthday', 'email'];
    const updates = {};
    for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }

    const updated = await memberService.updateMember(member.id, updates);
    res.json({ success: true, member: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PDPA consent center
router.get('/consents', authenticateLiff, async (req, res) => {
  const member = await memberService.getMemberByLineId(req.lineUserId);
  if (!member) return res.status(404).json({ error: 'Not registered' });
  const consents = await pdpaService.getConsents(member.id);
  res.json({ consents });
});

router.post('/consents', authenticateLiff, async (req, res) => {
  const member = await memberService.getMemberByLineId(req.lineUserId);
  if (!member) return res.status(404).json({ error: 'Not registered' });
  const { type, consented } = req.body;
  await pdpaService.updateConsent(member.id, type, consented, req.ip);
  res.json({ success: true });
});

// Data portability
router.get('/export', authenticateLiff, async (req, res) => {
  const member = await memberService.getMemberByLineId(req.lineUserId);
  if (!member) return res.status(404).json({ error: 'Not registered' });
  const data = await pdpaService.exportMemberData(member.id);
  res.setHeader('Content-Disposition', 'attachment; filename="my-data.json"');
  res.json(data);
});

// Right to erasure
router.delete('/me', authenticateLiff, async (req, res) => {
  const member = await memberService.getMemberByLineId(req.lineUserId);
  if (!member) return res.status(404).json({ error: 'Not registered' });
  await pdpaService.deleteMemberData(member.id);
  res.json({ success: true });
});

module.exports = router;
