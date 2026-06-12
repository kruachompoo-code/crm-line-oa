/**
 * quotationService.js
 * Generates PDF quotation for group bookings
 * Uses PDFKit (added to package.json)
 */
const path = require('path');
const fs   = require('fs');
const { query } = require('../config/database');
const lineService = require('./lineService');
const logger = require('../config/logger');

const OUTPUT_DIR = process.env.QUOTATION_DIR || '/tmp/quotations';
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * Build HTML quotation (no extra deps — use HTML → return as string or save)
 * Render as HTML email + send LINE Flex
 */
async function generateQuotation(bookingId) {
  const booking = await getBookingDetails(bookingId);
  if (!booking) throw new Error('Booking not found');

  const html = buildQuotationHTML(booking);
  const filename = `quotation_${booking.quotation_number}.html`;
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, html, 'utf8');

  // Save reference to DB
  const publicUrl = `${process.env.APP_URL}/api/quotations/${booking.quotation_number}`;
  await query(
    `UPDATE bookings SET quotation_pdf_url=$1, quotation_sent_at=NOW() WHERE id=$2`,
    [publicUrl, bookingId]
  );

  return { html, filepath, filename, publicUrl, booking };
}

async function getBookingDetails(bookingId) {
  const res = await query(`
    SELECT b.*,
      COALESCE(b.contact_name,'—') as contact_name,
      COALESCE(b.contact_phone,'—') as contact_phone,
      COALESCE(b.contact_email,'—') as contact_email,
      COALESCE(b.company_name,'') as company_name,
      COALESCE(b.tax_id,'') as tax_id,
      gp.name as package_name, gp.price_per_head,
      br.name as branch_name
    FROM bookings b
    LEFT JOIN group_packages gp ON gp.id = b.package_id
    LEFT JOIN branches br ON br.id = b.branch_id
    WHERE b.id = $1`, [bookingId]
  );
  const booking = res.rows[0];
  if (!booking) return null;

  // Get pre-ordered items
  const itemsRes = await query(
    `SELECT po.*, mi.name as menu_name, mi.price as unit_price
     FROM pre_orders po
     LEFT JOIN menu_items mi ON mi.id = po.menu_item_id
     WHERE po.booking_id = $1`, [bookingId]
  );
  booking.items = itemsRes.rows;
  booking.quotation_number = `QT-${bookingId.toString().padStart(6,'0')}-${Date.now().toString().slice(-4)}`;

  // Compute totals
  const itemTotal = booking.items.reduce((s,i) => s + (i.unit_price || 0) * i.quantity, 0);
  const packageTotal = booking.party_size && booking.price_per_head
    ? booking.party_size * booking.price_per_head : 0;
  booking.subtotal = itemTotal || packageTotal;
  booking.vat = Math.round(booking.subtotal * 0.07);
  booking.grand_total = booking.subtotal + booking.vat;
  booking.deposit_50 = Math.ceil(booking.grand_total * 0.5);

  return booking;
}

function buildQuotationHTML(b) {
  const today = new Date().toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'});
  const bookDate = b.booking_date
    ? new Date(b.booking_date).toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'})
    : '—';

  const itemRows = b.items.length
    ? b.items.map((i,n) => `
      <tr>
        <td>${n+1}</td>
        <td>${i.menu_name || i.special_requests || '—'}</td>
        <td style="text-align:center">${i.quantity}</td>
        <td style="text-align:right">฿${(i.unit_price||0).toLocaleString('th-TH')}</td>
        <td style="text-align:right">฿${((i.unit_price||0)*i.quantity).toLocaleString('th-TH')}</td>
      </tr>`).join('')
    : b.package_name
      ? `<tr><td>1</td><td>${b.package_name} (${b.party_size} คน × ฿${(b.price_per_head||0).toLocaleString('th-TH')})</td><td style="text-align:center">${b.party_size}</td><td style="text-align:right">฿${(b.price_per_head||0).toLocaleString('th-TH')}</td><td style="text-align:right">฿${(b.subtotal||0).toLocaleString('th-TH')}</td></tr>`
      : '<tr><td colspan="5" style="text-align:center;color:#888">ไม่มีรายการ</td></tr>';

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ใบเสนอราคา ${b.quotation_number}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;600;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans Thai',sans-serif;background:#f5f5f5;color:#1a1a2e;padding:20px}
  .page{background:#fff;max-width:800px;margin:0 auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}
  .header{background:linear-gradient(135deg,#4dc8f4,#e6538d);padding:32px 40px;color:#fff;display:flex;justify-content:space-between;align-items:center}
  .brand h1{font-size:22px;font-weight:800;margin-bottom:4px}
  .brand p{font-size:13px;opacity:.85}
  .doc-info{text-align:right}
  .doc-title{font-size:18px;font-weight:800;background:rgba(255,255,255,.2);padding:8px 16px;border-radius:10px;margin-bottom:6px}
  .doc-num{font-size:13px;opacity:.85}
  .body{padding:32px 40px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
  .info-block h3{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:8px;font-weight:700}
  .info-block p{font-size:14px;color:#1a1a2e;line-height:1.7}
  .info-block .bold{font-weight:700;font-size:15px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  thead tr{background:linear-gradient(135deg,#4dc8f4,#e6538d);color:#fff}
  thead th{padding:10px 12px;text-align:left;font-size:13px;font-weight:700}
  tbody tr:nth-child(even){background:#f8f9fa}
  tbody td{padding:10px 12px;font-size:14px;border-bottom:1px solid #eee}
  .totals{margin-left:auto;width:280px}
  .tot-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #eee;font-size:14px}
  .tot-row.grand{font-size:17px;font-weight:800;color:#e6538d;border-top:2px solid #e6538d;border-bottom:none;margin-top:4px;padding-top:10px}
  .deposit-box{background:linear-gradient(135deg,#fff0f6,#e8f7ff);border:2px solid #e6538d;border-radius:12px;padding:18px;margin-top:24px}
  .deposit-box h3{color:#e6538d;font-size:16px;font-weight:800;margin-bottom:8px}
  .deposit-box p{font-size:14px;color:#444;line-height:1.7}
  .deposit-amount{font-size:26px;font-weight:800;color:#e6538d;margin:8px 0}
  .conditions{margin-top:24px;background:#f8f9fa;border-radius:10px;padding:18px}
  .conditions h3{font-size:13px;font-weight:700;color:#555;margin-bottom:10px}
  .conditions ul{padding-left:18px}
  .conditions li{font-size:13px;color:#666;line-height:1.8}
  .footer{background:#1a1a2e;padding:20px 40px;color:#fff;text-align:center;margin-top:0}
  .footer p{font-size:12px;opacity:.7;line-height:1.8}
  @media print{body{background:#fff;padding:0}.page{box-shadow:none;border-radius:0}}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="brand">
      <h1>🦀 ครัวชมพู่ อ่างศิลา</h1>
      <p>ร้านอาหารทะเลสดอ่างศิลา ชลบุรี</p>
      <p style="margin-top:4px;font-size:12px">${b.branch_name||'สาขาหลัก'}</p>
    </div>
    <div class="doc-info">
      <div class="doc-title">ใบเสนอราคา</div>
      <div class="doc-num">เลขที่ ${b.quotation_number}</div>
      <div class="doc-num" style="margin-top:4px">วันที่ ${today}</div>
    </div>
  </div>

  <div class="body">
    <div class="info-grid">
      <div class="info-block">
        <h3>เสนอราคาให้แก่</h3>
        <p class="bold">${b.contact_name}</p>
        ${b.company_name?`<p>${b.company_name}</p>`:''}
        ${b.tax_id?`<p>เลขภาษี: ${b.tax_id}</p>`:''}
        <p>📞 ${b.contact_phone}</p>
        ${b.contact_email&&b.contact_email!=='—'?`<p>✉️ ${b.contact_email}</p>`:''}
      </div>
      <div class="info-block">
        <h3>รายละเอียดงาน</h3>
        <p>📅 วันที่จัด: <strong>${bookDate}</strong></p>
        <p>⏰ เวลา: <strong>${b.booking_time||'—'}</strong></p>
        <p>👥 จำนวน: <strong>${b.party_size||'—'} คน</strong></p>
        ${b.group_occasion?`<p>🎉 โอกาส: <strong>${b.group_occasion}</strong></p>`:''}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th>รายการ</th>
          <th style="width:70px;text-align:center">จำนวน</th>
          <th style="width:100px;text-align:right">ราคาต่อหน่วย</th>
          <th style="width:110px;text-align:right">รวม</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div class="totals">
      <div class="tot-row"><span>ยอดก่อนภาษี</span><span>฿${(b.subtotal||0).toLocaleString('th-TH')}</span></div>
      <div class="tot-row"><span>VAT 7%</span><span>฿${(b.vat||0).toLocaleString('th-TH')}</span></div>
      <div class="tot-row grand"><span>รวมทั้งสิ้น</span><span>฿${(b.grand_total||0).toLocaleString('th-TH')}</span></div>
    </div>

    <div class="deposit-box">
      <h3>💰 มัดจำ 50% (ชำระเพื่อยืนยันการจอง)</h3>
      <div class="deposit-amount">฿${(b.deposit_50||0).toLocaleString('th-TH')}</div>
      <p>ชำระมัดจำภายใน <strong>3 วัน</strong> หลังได้รับใบเสนอราคา</p>
      <p style="margin-top:6px">PromptPay / LINE Pay / โอนธนาคาร</p>
    </div>

    <div class="conditions">
      <h3>เงื่อนไขการจอง</h3>
      <ul>
        <li>ยกเลิกก่อน 24 ชั่วโมง: คืนเงินมัดจำเต็มจำนวน</li>
        <li>ยกเลิกน้อยกว่า 24 ชั่วโมง: ไม่คืนเงินมัดจำ</li>
        <li>ราคานี้ถูกต้องภายใน 7 วันนับจากวันที่ออกใบเสนอราคา</li>
        <li>รายการอาหารอาจเปลี่ยนแปลงตามความพร้อมของวัตถุดิบ</li>
      </ul>
    </div>
  </div>

  <div class="footer">
    <p>ครัวชมพู่ อ่างศิลา | อ่างศิลา ชลบุรี</p>
    <p>LINE OA: @krauchompu | ใบเสนอราคาฉบับนี้ออกด้วยระบบ CRM อัตโนมัติ</p>
  </div>
</div>
</body>
</html>`;
}

/**
 * Send quotation via LINE Flex Message + Email
 */
async function sendQuotation(bookingId, { lineUserId, email } = {}) {
  const { html, publicUrl, booking, filename } = await generateQuotation(bookingId);

  // LINE Flex Message
  const flexMsg = {
    type: 'flex',
    altText: `📄 ใบเสนอราคา ${booking.quotation_number} — ครัวชมพู่ อ่างศิลา`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        background: { type: 'linearGradient', angle: '135deg', startColor: '#4dc8f4', endColor: '#e6538d' },
        paddingAll: '20px',
        contents: [
          { type: 'text', text: '📄 ใบเสนอราคา', color: '#ffffff', weight: 'bold', size: 'xl' },
          { type: 'text', text: booking.quotation_number, color: '#ffffff', size: 'sm', opacity: 0.85 }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: [
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: 'จำนวนคน', size: 'sm', color: '#888888', flex: 1 },
            { type: 'text', text: `${booking.party_size} คน`, size: 'sm', weight: 'bold', color: '#1a1a2e', align: 'end' }
          ]},
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: 'วันที่จัด', size: 'sm', color: '#888888', flex: 1 },
            { type: 'text', text: booking.booking_date ? new Date(booking.booking_date).toLocaleDateString('th-TH') : '—', size: 'sm', weight: 'bold', color: '#1a1a2e', align: 'end' }
          ]},
          { type: 'separator', margin: 'sm' },
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: 'ยอดรวม', size: 'md', weight: 'bold', flex: 1 },
            { type: 'text', text: `฿${(booking.grand_total||0).toLocaleString('th-TH')}`, size: 'lg', weight: 'bold', color: '#e6538d', align: 'end' }
          ]},
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: 'มัดจำ 50%', size: 'sm', color: '#888888', flex: 1 },
            { type: 'text', text: `฿${(booking.deposit_50||0).toLocaleString('th-TH')}`, size: 'sm', weight: 'bold', color: '#4dc8f4', align: 'end' }
          ]}
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        contents: [
          { type: 'button', action: { type: 'uri', label: '📄 ดูใบเสนอราคา', uri: publicUrl }, style: 'primary', color: '#e6538d' },
          { type: 'button', action: { type: 'uri', label: '✅ ยืนยันการจอง', uri: `${process.env.APP_URL}/liff/group-booking.html?bookingId=${bookingId}&confirm=1` }, style: 'secondary' }
        ]
      }
    }
  };

  if (lineUserId) {
    await lineService.pushMessage(lineUserId, flexMsg);
    logger.info('Quotation sent via LINE', { bookingId, lineUserId });
  }

  // Email (basic, via smtp if configured)
  if (email && process.env.SMTP_HOST) {
    try {
      await sendEmail(email, booking.quotation_number, html);
    } catch (e) {
      logger.warn('Email send failed', { email, err: e.message });
    }
  }

  return { success: true, quotationNumber: booking.quotation_number, publicUrl };
}

async function sendEmail(to, quotationNumber, html) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: `ครัวชมพู่ อ่างศิลา <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to,
    subject: `ใบเสนอราคา ${quotationNumber} — ครัวชมพู่ อ่างศิลา`,
    html
  });
}

module.exports = { generateQuotation, sendQuotation };
