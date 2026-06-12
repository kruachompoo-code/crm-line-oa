const { query } = require('../config/database');

async function getConsents(memberId) {
  const res = await query(
    `SELECT DISTINCT ON (type) type, consented, version, created_at
     FROM pdpa_consents WHERE member_id=$1 ORDER BY type, created_at DESC`,
    [memberId]
  );
  return res.rows;
}

async function updateConsent(memberId, type, consented, ip) {
  await query(
    `INSERT INTO pdpa_consents (member_id,type,consented,ip_address)
     VALUES ($1,$2,$3,$4)`,
    [memberId, type, consented, ip]
  );
}

async function deleteMemberData(memberId) {
  // Anonymize instead of hard delete (for legal requirements)
  await query(
    `UPDATE members SET
       phone = NULL, name = 'Anonymized', display_name = 'Anonymized',
       picture_url = NULL, birthday = NULL, is_active = FALSE
     WHERE id=$1`,
    [memberId]
  );
  await query('DELETE FROM pdpa_consents WHERE member_id=$1', [memberId]);
  await query('DELETE FROM notification_prefs WHERE member_id=$1', [memberId]);
}

async function exportMemberData(memberId) {
  const member   = (await query('SELECT * FROM members WHERE id=$1', [memberId])).rows[0];
  const points   = (await query('SELECT * FROM point_transactions WHERE member_id=$1', [memberId])).rows;
  const coupons  = (await query(`SELECT mc.*,c.name,c.code FROM member_coupons mc JOIN coupons c ON c.id=mc.coupon_id WHERE mc.member_id=$1`, [memberId])).rows;
  const bookings = (await query('SELECT * FROM bookings WHERE member_id=$1', [memberId])).rows;
  const consents = await getConsents(memberId);

  return { member, points, coupons, bookings, consents, exported_at: new Date() };
}

module.exports = { getConsents, updateConsent, deleteMemberData, exportMemberData };
