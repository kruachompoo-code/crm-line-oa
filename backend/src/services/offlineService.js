const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

// Issue an offline ticket when internet is down (printed by POS)
async function issueOfflineTicket(branchId, memberId, amount) {
  const id = uuidv4();
  const code = Math.random().toString(36).slice(2,8).toUpperCase();

  await query(
    `INSERT INTO offline_tickets (id, branch_id, member_id, amount, code, expires_at)
     VALUES ($1,$2,$3,$4,$5, NOW()+INTERVAL '72 hours')`,
    [id, branchId, memberId || null, amount, code]
  );

  const qrDataURL = await QRCode.toDataURL(
    JSON.stringify({ ticket: id, code, amount }),
    { width: 200, errorCorrectionLevel: 'M' }
  );

  return { id, code, qrDataURL, expires_in: '72 hours' };
}

// Redeem offline ticket when internet is restored
async function redeemOfflineTicket(code, lineUserId) {
  const res = await query(
    `SELECT * FROM offline_tickets WHERE code=$1 AND redeemed=FALSE AND expires_at > NOW()`,
    [code]
  );
  if (!res.rows.length) throw new Error('Ticket not found or expired');

  const ticket = res.rows[0];
  await query('UPDATE offline_tickets SET redeemed=TRUE, redeemed_at=NOW() WHERE id=$1', [ticket.id]);

  return ticket;
}

module.exports = { issueOfflineTicket, redeemOfflineTicket };
