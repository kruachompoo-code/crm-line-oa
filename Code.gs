// ===========================================================
// ครัวชมพู่ อ่างศิลา \/– LINE OA CRM Backend
// Google Apps Script + Google Sheets
// ===========================================================

const SHEET = {
  MEMBERS:  'Members',
  BOOKINGS: 'Bookings',
  WALKINS:  'WalkIns',
  GROUPS:   'GroupBookings',
  MENU:     'Menu',
};

// ── Utilities ────────────────────────────────────────────────
function ss()   { return SpreadsheetApp.getActiveSpreadsheet(); }
function sh(n)  { return ss().getSheetByName(n) || ss().insertSheet(n); }
function prop(k){ return PropertiesService.getScriptProperties().getProperty(k); }
function genId(p){ return p + '_' + new Date().getTime(); }

// ── LINE API ─────────────────────────────────────────────────
function lineReply(replyToken, messages) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop('LINE_CHANNEL_ACCESS_TOKEN') },
    payload: JSON.stringify({ replyToken, messages }),
    muteHttpExceptions: true,
  });
}

function linePush(to, messages) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop('LINE_CHANNEL_ACCESS_TOKEN') },
    payload: JSON.stringify({ to, messages }),
    muteHttpExceptions: true,
  });
}

function getLineProfile(userId) {
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + userId, {
    headers: { Authorization: 'Bearer ' + prop('LINE_CHANNEL_ACCESS_TOKEN') },
    muteHttpExceptions: true,
  });
  return JSON.parse(res.getContentText());
}

// ── Members ──────────────────────────────────────────────────
function findMember(lineUserId) {
  const data = sh(SHEET.MEMBERS).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === lineUserId) return { row: i + 1, data: data[i] };
  }
  return null;
}

function upsertMember(lineUserId, displayName, phone) {
  let m = findMember(lineUserId);
  if (m) {
    if (phone) sh(SHEET.MEMBERS).getRange(m.row, 3).setValue(phone);
    return m;
  }
  sh(SHEET.MEMBERS).appendRow([lineUserId, displayName || '', phone || '', 0, 'bronze', new Date()]);
  return findMember(lineUserId);
}

function addPoints(lineUserId, pts) {
  const m = findMember(lineUserId);
  if (!m) return 0;
  const s = sh(SHEET.MEMBERS);
  const total = (m.data[3] || 0) + pts;
  s.getRange(m.row, 4).setValue(total);
  s.getRange(m.row, 5).setValue(total >= 1000 ? 'gold' : total >= 500 ? 'silver' : 'bronze');
  return total;
}

// ── Webhook (LINE events + LIFF form submissions) ─────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // LIFF form submissions
    if (body.type === 'walkin')       return handleWalkIn(body);
    if (body.type === 'reservation')  return handleReservation(body);
    if (body.type === 'groupbooking') return handleGroupBooking(body);
    if (body.type === 'callstaff')    return handleCallStaff(body);
    if (body.type === 'checkbill')    return handleCheckBill(body);
    if (body.type === 'register')     return handleRegister(body);

    // LINE webhook events
    (body.events || []).forEach(handleEvent);
  } catch (err) {
    Logger.log('doPost error: ' + err);
  }
  return json({ ok: true });
}

function doGet(e) {
  return json({ status: 'ครัวชมพู่ อ่างศิลา CRM — OK', ts: new Date().toISOString() });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── LINE Event Handlers ───────────────────────────────────────
function handleEvent(event) {
  const userId = event.source && event.source.userId;
  if (!userId) return;
  if (event.type === 'follow')   return onFollow(event, userId);
  if (event.type === 'message')  return onMessage(event, userId);
  if (event.type === 'postback') return onPostback(event, userId);
}

function onFollow(event, userId) {
  const profile = getLineProfile(userId);
  upsertMember(userId, profile.displayName || 'ลูกค้า', '');
  const liffBase = prop('LIFF_BASE_URL') || 'https://kruachompoo-code.github.io/crm-line-oa/liff';
  lineReply(event.replyToken, [
    {
      type: 'text',
      text: '🦀 ยินดีต้อนรับสู่ ครัวชมพู่ อ่างศิลา!\n\nสวัสดีคุณ ' + (profile.displayName || 'ลูกค้า') + ' 😊\n\nกดเมนูด้านล่างเพื่อ:\n🍽 Walk-in / สั่งอาหาร\n📅 จองโต๊ะล่วงหน้า\n👥 จองหมู่คณะ',
    }
  ]);
}

function onMessage(event, userId) {
  const text = ((event.message || {}).text || '').trim();
  const m = findMember(userId);
  const name   = m ? m.data[1] : 'ลูกค้า';
  const points = m ? (m.data[3] || 0) : 0;
  const tier   = m ? (m.data[4] || 'bronze') : 'bronze';

  if (/แต้ม|point|คะแนน/i.test(text)) {
    lineReply(event.replyToken, [{
      type: 'text',
      text: '🏆 คุณ' + name + '\nแต้มสะสม: ' + points + ' คะแนน\nระดับ: ' + tier.toUpperCase() + '\n\n🥉 Bronze: 0–499\n🥈 Silver: 500–999\n🥇 Gold: 1,000+',
    }]);
    return;
  }

  lineReply(event.replyToken, [{
    type: 'text',
    text: 'สวัสดีคุณ' + name + ' 🦀\nกดเมนูด้านล่างเพื่อใช้งานได้เลยครับ',
  }]);
}

function onPostback(event, userId) {
  // reserved for future postback actions
}

// ── LIFF Form Handlers ────────────────────────────────────────
function handleWalkIn(body) {
  const id = genId('WI');
  sh(SHEET.WALKINS).appendRow([id, body.lineUserId, body.tableNo, body.guests || 1, 'seated', new Date()]);
  upsertMember(body.lineUserId, body.displayName, '');
  const pts = addPoints(body.lineUserId, 10);
  if (body.lineUserId) {
    linePush(body.lineUserId, [{
      type: 'text',
      text: '✅ เช็คอินสำเร็จ!\nโต๊ะ: ' + body.tableNo + '\nจำนวน: ' + (body.guests || 1) + ' ท่าน\n+10 แต้ม 🎉 (รวม ' + pts + ' แต้ม)',
    }]);
  }
  return json({ ok: true, id });
}

function handleReservation(body) {
  const id = genId('BK');
  sh(SHEET.BOOKINGS).appendRow([
    id, body.lineUserId, body.name, body.phone,
    body.date, body.time, body.guests, body.tableType || 'ทั่วไป',
    body.notes || '', 'confirmed', new Date(),
  ]);
  upsertMember(body.lineUserId, body.displayName, body.phone);
  if (body.lineUserId) {
    linePush(body.lineUserId, [{
      type: 'text',
      text: '✅ จองโต๊ะสำเร็จ!\n📅 ' + body.date + ' เวลา ' + body.time + '\n👥 ' + body.guests + ' ท่าน\n📞 ' + body.phone + '\n\nรหัสการจอง: ' + id,
    }]);
  }
  return json({ ok: true, id });
}

function handleGroupBooking(body) {
  const id = genId('GR');
  sh(SHEET.GROUPS).appendRow([
    id, body.lineUserId, body.company, body.contactName,
    body.phone, body.eventDate, body.guests, body.menuType,
    body.budget || '', 'pending', new Date(),
  ]);
  upsertMember(body.lineUserId, body.displayName, body.phone);
  if (body.lineUserId) {
    linePush(body.lineUserId, [{
      type: 'text',
      text: '✅ ส่งคำขอจองหมู่คณะแล้ว!\nบริษัท/กลุ่ม: ' + body.company + '\n📅 ' + body.eventDate + '\n👥 ' + body.guests + ' ท่าน\n\nรหัส: ' + id + '\nทีมงานจะติดต่อกลับภายใน 24 ชม.',
    }]);
  }
  return json({ ok: true, id });
}

function handleCallStaff(body) {
  const gid = prop('STAFF_LINE_GROUP_ID');
  if (gid) {
    linePush(gid, [{
      type: 'text',
      text: '🔔 เรียกพนักงาน!\nโต๊ะ: ' + body.tableNo + '\nเวลา: ' + new Date().toLocaleTimeString('th-TH'),
    }]);
  }
  return json({ ok: true });
}

function handleCheckBill(body) {
  const gid = prop('STAFF_LINE_GROUP_ID');
  if (gid) {
    linePush(gid, [{
      type: 'text',
      text: '🧾 ขอเช็คบิล!\nโต๊ะ: ' + body.tableNo + '\nเวลา: ' + new Date().toLocaleTimeString('th-TH'),
    }]);
  }
  return json({ ok: true });
}

function handleRegister(body) {
  upsertMember(body.lineUserId, body.displayName, body.phone);
  if (body.lineUserId) {
    linePush(body.lineUserId, [{
      type: 'text',
      text: '🎉 ลงทะเบียนสำเร็จ!\nยินดีต้อนรับคุณ ' + body.displayName + '\n📞 ' + body.phone + '\n\nเริ่มสะสมแต้มได้เลย 🦀',
    }]);
  }
  return json({ ok: true });
}

// ── Setup (run once from Apps Script editor) ──────────────────
function setupSheets() {
  const configs = [
    { name: SHEET.MEMBERS,  headers: ['line_user_id','display_name','phone','points','tier','created_at'] },
    { name: SHEET.BOOKINGS, headers: ['id','line_user_id','name','phone','date','time','guests','table_type','notes','status','created_at'] },
    { name: SHEET.WALKINS,  headers: ['id','line_user_id','table_no','guests','status','created_at'] },
    { name: SHEET.GROUPS,   headers: ['id','line_user_id','company','contact_name','phone','event_date','guests','menu_type','budget','status','created_at'] },
    { name: SHEET.MENU,     headers: ['id','category','name','description','price','emoji','available'] },
  ];
  configs.forEach(({ name, headers }) => {
    const s = sh(name);
    if (s.getLastRow() === 0) {
      s.appendRow(headers);
      s.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#4dc8f4')
        .setFontColor('#ffffff');
    }
  });

  // Seed default menu
  const menu = sh(SHEET.MENU);
  if (menu.getLastRow() <= 1) {
    const items = [
      ['M001','ปู','ปูม้านึ่ง','ปูม้าสดๆ จากอ่างศิลา',320,'🦀',true],
      ['M002','ปู','ปูผัดผงกะหรี่','ปูม้าผัดผงกะหรี่หอมอร่อย',280,'🦀',true],
      ['M003','กุ้ง','กุ้งแม่น้ำเผา','กุ้งแม่น้ำตัวใหญ่ เผาสดๆ',380,'🍤',true],
      ['M004','กุ้ง','กุ้งอบวุ้นเส้น','กุ้งอบกับวุ้นเส้นหอมซอสพิเศษ',250,'🍤',true],
      ['M005','ปลา','ปลากะพงทอดน้ำปลา','ปลากะพงสดทอดกรอบ',320,'🐟',true],
      ['M006','ปลา','ปลาเก๋านึ่งซีอิ๊ว','เนื้อปลาเก๋านุ่มหวาน',380,'🐟',true],
      ['M007','หอย','หอยแมลงภู่ผัดฉ่า','หอยแมลงภู่สดผัดฉ่าเผ็ดร้อน',180,'🦪',true],
      ['M008','อื่นๆ','ข้าวสวย','ข้าวสวยหอมมะลิ',20,'🍚',true],
      ['M009','อื่นๆ','น้ำจิ้มซีฟู้ด','น้ำจิ้มสูตรพิเศษ',30,'🌶',true],
    ];
    items.forEach(row => menu.appendRow(row));
  }

  Logger.log('✅ Setup complete!');
}
