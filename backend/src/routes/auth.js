const express = require('express');
const axios = require('axios');
const { issueToken } = require('../middleware/auth');
const memberService = require('../services/memberService');
const { recordScan } = require('../services/qrService');

const router = express.Router();

// Exchange LINE ID token for system JWT
router.post('/line', async (req, res) => {
  const { idToken, branchId, qrRef } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });

  try {
    // Verify with LINE
    const verifyRes = await axios.post('https://api.line.me/oauth2/v2.1/verify', null, {
      params: { id_token: idToken, client_id: process.env.LINE_LOGIN_CHANNEL_ID }
    });
    const { sub: lineUserId } = verifyRes.data;

    // Track QR scan
    if (qrRef) await recordScan(qrRef).catch(() => {});

    const token = issueToken(lineUserId, branchId);
    const member = await memberService.getMemberByLineId(lineUserId);
    res.json({ token, lineUserId, registered: !!member });
  } catch (err) {
    res.status(401).json({ error: 'LINE token verification failed' });
  }
});

module.exports = router;
