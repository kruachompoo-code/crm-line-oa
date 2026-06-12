const QRCode = require('qrcode');
const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

async function generateUTMQR(data) {
  const { branchId, label, location, utmCampaign } = data;
  const id = uuidv4();
  const baseUrl = process.env.FRONTEND_URL;

  const params = new URLSearchParams({
    utm_source: 'qr',
    utm_medium: location || 'table',
    utm_campaign: utmCampaign || 'organic',
    ref: id.slice(0,8)
  });

  const url = `${baseUrl}/register?${params}`;

  await query(
    `INSERT INTO qr_codes (id,branch_id,label,location,utm_campaign,url)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, branchId, label, location, utmCampaign, url]
  );

  const qrDataURL = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'H',
    width: 300,
    margin: 2,
    color: { dark: '#1F4E79', light: '#FFFFFF' }
  });

  return { id, url, qrDataURL, label, location };
}

async function recordScan(qrId) {
  await query('UPDATE qr_codes SET scan_count=scan_count+1 WHERE id=$1', [qrId]);
}

async function getQRStats(branchId) {
  const res = await query(
    `SELECT * FROM qr_codes WHERE branch_id=$1 ORDER BY scan_count DESC`,
    [branchId]
  );
  return res.rows;
}

module.exports = { generateUTMQR, recordScan, getQRStats };
