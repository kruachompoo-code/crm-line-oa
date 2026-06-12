const { query, pool } = require('../config/database');
const lineService = require('./lineService');
const logger = require('../config/logger');
const dayjs = require('dayjs');

// ─── WALK-IN ORDER (Type 1a: สแกน QR ที่ร้าน) ─────────────────────────────

async function createWalkinOrder({ memberId, branchId, tableNumber, items }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const total = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

    const res = await client.query(
      `INSERT INTO walkin_orders (member_id, branch_id, table_number, total_amount)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [memberId || null, branchId, tableNumber, total]
    );
    const order = res.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO walkin_order_items (walkin_order_id, menu_item_id, item_name, unit_price, quantity, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, item.menuItemId, item.name, item.unitPrice, item.quantity, item.notes || null]
      );
    }

    await client.query('COMMIT');

    // Notify kitchen (send LINE to staff) - fire and forget
    logger.info('Walk-in order created', { orderId: order.id, table: tableNumber, total });

    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getWalkinOrder(orderId) {
  const [order, items] = await Promise.all([
    query('SELECT * FROM walkin_orders WHERE id=$1', [orderId]),
    query('SELECT * FROM walkin_order_items WHERE walkin_order_id=$1', [orderId])
  ]);
  return { ...order.rows[0], items: items.rows };
}

async function addWalkinItems(orderId, items) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let addedTotal = 0;
    for (const item of items) {
      await client.query(
        `INSERT INTO walkin_order_items (walkin_order_id, menu_item_id, item_name, unit_price, quantity, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [orderId, item.menuItemId, item.name, item.unitPrice, item.quantity, item.notes || null]
      );
      addedTotal += item.unitPrice * item.quantity;
    }
    await client.query(
      'UPDATE walkin_orders SET total_amount = total_amount + $1 WHERE id=$2',
      [addedTotal, orderId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── RESERVATION (Type 1b: จองล่วงหน้า + pre-order + 50% deposit) ──────────

async function createReservation({
  memberId, branchId, partySize,
  bookingDate, bookingTime, notes,
  preOrderItems = []   // [{ menuItemId, name, unitPrice, quantity, notes }]
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Calculate totals
    const preOrderTotal = preOrderItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const depositAmount = Math.ceil(preOrderTotal * 0.5);   // 50% rounded up
    const remaining     = preOrderTotal - depositAmount;

    const res = await client.query(
      `INSERT INTO bookings
         (member_id, branch_id, party_size, booking_date, booking_time,
          notes, booking_type, deposit_amount, remaining_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,'reservation',$7,$8,'pending')
       RETURNING *`,
      [memberId, branchId, partySize, bookingDate, bookingTime,
       notes || null, depositAmount, remaining]
    );
    const booking = res.rows[0];

    // Insert pre-ordered items
    for (const item of preOrderItems) {
      await client.query(
        `INSERT INTO pre_orders (booking_id, menu_item_id, item_name, unit_price, quantity, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [booking.id, item.menuItemId, item.name, item.unitPrice, item.quantity, item.notes || null]
      );
    }

    await client.query('COMMIT');
    logger.info('Reservation created', { bookingId: booking.id, deposit: depositAmount });
    return { booking, preOrderTotal, depositAmount, remaining };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function confirmDeposit(bookingId, txRef) {
  const res = await query(
    `UPDATE bookings SET
       deposit_status='paid', deposit_paid_at=NOW(), deposit_tx_ref=$2, status='confirmed'
     WHERE id=$1 RETURNING *`,
    [bookingId, txRef]
  );
  const booking = res.rows[0];
  if (!booking) throw new Error('Booking not found');

  // Get member LINE ID and send confirmation
  const memberRes = await query(
    'SELECT line_user_id, name FROM members WHERE id=$1', [booking.member_id]
  );
  const member = memberRes.rows[0];
  if (member?.line_user_id) {
    await lineService.pushMessage(member.line_user_id, [
      reservationConfirmMsg(booking, member.name)
    ]);
  }

  return booking;
}

// ─── GROUP BOOKING (Type 2: หมู่คณะ) ────────────────────────────────────────

async function createGroupBooking({
  memberId, branchId, partySize,
  bookingDate, bookingTime,
  packageId, contactName, contactPhone, occasion,
  preOrderItems = []
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let packageInfo = null;
    let preOrderTotal = preOrderItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

    if (packageId) {
      const pkgRes = await client.query(
        'SELECT * FROM group_packages WHERE id=$1 AND is_active=TRUE', [packageId]
      );
      packageInfo = pkgRes.rows[0];
      if (packageInfo) {
        // Package price overrides individual items
        preOrderTotal = packageInfo.price_per_head * partySize;
      }
    }

    const depositAmount = Math.ceil(preOrderTotal * 0.5);
    const remaining     = preOrderTotal - depositAmount;
    const groupNotes = `${occasion ? '['+occasion+'] ' : ''}ติดต่อ: ${contactName} ${contactPhone}`;

    const res = await client.query(
      `INSERT INTO bookings
         (member_id, branch_id, party_size, booking_date, booking_time,
          notes, booking_type, deposit_amount, remaining_amount, status,
          contact_name, contact_phone, group_occasion)
       VALUES ($1,$2,$3,$4,$5,$6,'group',$7,$8,'pending',$9,$10,$11)
       RETURNING *`,
      [memberId, branchId, partySize, bookingDate, bookingTime,
       groupNotes, depositAmount, remaining,
       contactName, contactPhone, occasion || null]
    );
    const booking = res.rows[0];

    // If not using package, save individual pre-orders
    if (!packageId) {
      for (const item of preOrderItems) {
        await client.query(
          `INSERT INTO pre_orders (booking_id, menu_item_id, item_name, unit_price, quantity, notes)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [booking.id, item.menuItemId, item.name, item.unitPrice, item.quantity, item.notes || null]
        );
      }
    }

    await client.query('COMMIT');
    logger.info('Group booking created', { bookingId: booking.id, partySize, deposit: depositAmount });
    return { booking, packageInfo, preOrderTotal, depositAmount, remaining };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── SHARED ──────────────────────────────────────────────────────────────────

async function cancelBooking(bookingId, memberId) {
  const res = await query(
    `UPDATE bookings SET status='cancelled'
     WHERE id=$1 AND member_id=$2 AND status NOT IN ('completed','cancelled')
     RETURNING *`,
    [bookingId, memberId]
  );
  if (!res.rows.length) throw new Error('Booking not found or cannot be cancelled');

  const booking = res.rows[0];
  // Deposit refund logic: full refund if >24h before booking
  const hoursUntil = dayjs(booking.booking_date+'T'+booking.booking_time).diff(dayjs(), 'hour');
  const refundable = hoursUntil >= 24 && booking.deposit_status === 'paid';

  return { booking, refundable, hoursUntil };
}

async function getBookingWithPreOrders(bookingId) {
  const [booking, preOrders] = await Promise.all([
    query('SELECT * FROM booking_summary WHERE id=$1', [bookingId]),
    query('SELECT * FROM pre_orders WHERE booking_id=$1', [bookingId])
  ]);
  return { ...booking.rows[0], preOrders: preOrders.rows };
}

async function getBookingsByDate(branchId, date) {
  const res = await query(
    `SELECT bs.*, COUNT(po.id) as item_count
     FROM booking_summary bs
     LEFT JOIN pre_orders po ON po.booking_id = bs.id
     WHERE bs.branch_id=$1 AND bs.booking_date=$2
       AND bs.status NOT IN ('cancelled')
     GROUP BY bs.id, bs.member_name, bs.member_phone, bs.member_tier, bs.branch_name, bs.pre_order_total, bs.pre_order_items
     ORDER BY bs.booking_time`,
    [branchId, date]
  );
  return res.rows;
}

async function sendReminders() {
  const twoHoursLater = dayjs().add(2, 'hour').format('HH:mm');
  const today = dayjs().format('YYYY-MM-DD');

  const res = await query(
    `SELECT b.*, m.line_user_id, m.name as member_name
     FROM bookings b JOIN members m ON m.id=b.member_id
     WHERE b.booking_date=$1 AND b.booking_time BETWEEN $2 AND $3
       AND b.status='confirmed' AND b.reminder_sent IS DISTINCT FROM TRUE`,
    [today, twoHoursLater, dayjs(twoHoursLater,'HH:mm').add(5,'minute').format('HH:mm')]
  );

  for (const b of res.rows) {
    if (!b.line_user_id) continue;
    await lineService.pushMessage(b.line_user_id, [reminderMsg(b)]);
    await query('UPDATE bookings SET reminder_sent=TRUE WHERE id=$1', [b.id]);
  }
}

// ─── MESSAGE TEMPLATES ────────────────────────────────────────────────────────

function reservationConfirmMsg(booking, memberName) {
  const typeLabel = booking.booking_type === 'group' ? '🎉 จองหมู่คณะ' : '📅 จองโต๊ะ';
  return {
    type: 'flex',
    altText: `✅ ยืนยันการจอง ${booking.booking_date} ${booking.booking_time}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#1F4E79', paddingAll: '16px',
        contents: [
          { type:'text', text:'✅ ยืนยันการจองแล้ว', color:'#ffffff', size:'lg', weight:'bold' },
          { type:'text', text:typeLabel, color:'#90CAF9', size:'sm', margin:'sm' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type:'text', text:`สวัสดี คุณ${memberName}`, size:'md', weight:'bold' },
          { type:'separator', margin:'md' },
          infoRow('📅 วันที่', booking.booking_date),
          infoRow('⏰ เวลา', booking.booking_time),
          infoRow('👥 จำนวน', booking.party_size+' ท่าน'),
          { type:'separator', margin:'md' },
          infoRow('💰 มัดจำที่ชำระ', '฿'+parseFloat(booking.deposit_amount).toLocaleString()),
          infoRow('💳 ค้างชำระที่ร้าน', '฿'+parseFloat(booking.remaining_amount).toLocaleString()),
          { type:'separator', margin:'md' },
          { type:'text', text:'⚠️ กรุณามาตรงเวลา หากมาช้ากว่า 15 นาทีจะถือว่าสละสิทธิ์', size:'xs', color:'#999', wrap:true }
        ]
      },
      footer: {
        type:'box', layout:'vertical', paddingAll:'12px',
        contents:[{
          type:'button', style:'primary', color:'#1F4E79',
          action:{ type:'uri', label:'ดูรายละเอียดการจอง', uri:`${process.env.FRONTEND_URL}/liff/reservation.html?id=${booking.id}` }
        }]
      }
    }
  };
}

function reminderMsg(booking) {
  return {
    type: 'flex', altText: `⏰ เตือนการจอง ${booking.booking_time}`,
    contents: {
      type: 'bubble',
      body: {
        type:'box', layout:'vertical', spacing:'md',
        contents: [
          { type:'text', text:'⏰ เตือนการจอง', weight:'bold', size:'lg', color:'#1F4E79' },
          { type:'text', text:`การจองของคุณเวลา ${booking.booking_time} ใกล้ถึงแล้ว!`, wrap:true },
          infoRow('📅 วันที่', booking.booking_date),
          infoRow('👥 จำนวน', booking.party_size+' ท่าน'),
          { type:'text', text:'กรุณามาก่อนเวลา 10 นาที', size:'sm', color:'#999' }
        ]
      }
    }
  };
}

function infoRow(label, value) {
  return {
    type:'box', layout:'horizontal', margin:'sm',
    contents:[
      { type:'text', text:label, size:'sm', color:'#888', flex:2 },
      { type:'text', text:String(value), size:'sm', color:'#333', flex:3, weight:'bold' }
    ]
  };
}

module.exports = {
  createWalkinOrder, getWalkinOrder, addWalkinItems,
  createReservation, confirmDeposit,
  createGroupBooking,
  cancelBooking, getBookingWithPreOrders, getBookingsByDate, sendReminders
};

// ─── Walk-in helpers ───────────────────────────────────
async function getWalkinOrder(orderId) {
  const res = await query(
    `SELECT wo.*, b.table_number, b.branch_id, b.member_id
     FROM walkin_orders wo
     JOIN bookings b ON b.id = wo.booking_id
     WHERE wo.id = $1`, [orderId]
  );
  return res.rows[0] || null;
}

async function markBillVerified(orderId, staffId) {
  await query(
    `UPDATE walkin_orders SET status='paid', verified_by=$2, verified_at=NOW()
     WHERE id=$1`, [orderId, staffId]
  );
  await query(
    `UPDATE bookings SET status='completed'
     WHERE id=(SELECT booking_id FROM walkin_orders WHERE id=$1)`, [orderId]
  );
}

module.exports = {
  ...module.exports,
  getWalkinOrder,
  markBillVerified
};
