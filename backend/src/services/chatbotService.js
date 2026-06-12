const { query } = require('../config/database');
const redis = require('../config/redis');
const lineService = require('./lineService');
const memberService = require('./memberService');
const loyaltyService = require('./loyaltyService');
const bookingService = require('./bookingService');
const logger = require('../config/logger');

const LIFF = process.env.FRONTEND_URL || 'https://your-liff-domain.com';

// ─── Intent Detection ─────────────────────────────────────
function detectIntent(text) {
  const t = text.toLowerCase().trim();
  if (/แต้ม|point|คะแนน|สะสม/.test(t)) return 'check_points';
  if (/คูปอง|ส่วนลด|โปร/.test(t)) return 'check_coupons';
  if (/จอง|booking|โต๊ะ/.test(t)) return 'book_table';
  if (/เปิด|ปิด|เวลา|กี่โมง/.test(t)) return 'opening_hours';
  if (/เมนู|อาหาร|กิน|สั่ง/.test(t)) return 'menu';
  if (/สมัคร|สมาชิก|register/.test(t)) return 'register';
  if (/คน|staff|พนักงาน/.test(t)) return 'human_handoff';
  if (/ยกเลิก|cancel/.test(t)) return 'cancel';
  if (/ระดับ|tier|vip|silver|gold|platinum/.test(t)) return 'check_tier';
  if (/วันเกิด|birthday/.test(t)) return 'birthday';
  if (/ช่วยด้วย|help|ช่วย/.test(t)) return 'help';
  if (/ขอบคุณ|thanks|ขอบใจ/.test(t)) return 'thank_you';
  if (/ลบ|pdpa|ข้อมูล|privacy/.test(t)) return 'pdpa';
  if (/สั่ง|order|จัดส่ง/.test(t)) return 'order';
  return 'unknown';
}

// ─── Handle Postback ──────────────────────────────────────
async function handlePostback(event) {
  const { replyToken, source, postback } = event;
  const lineUserId = source.userId;
  const data = new URLSearchParams(postback.data);
  const action = data.get('action');

  const member = await memberService.getMemberByLineId(lineUserId);

  switch (action) {
    case 'check_points':
      return handleCheckPoints(replyToken, member);
    case 'my_coupons':
      return handleMyCoupons(replyToken, member, lineUserId);
    case 'book_table':
      return lineService.replyMessage(replyToken, {
        type: 'text', text: `📅 จองโต๊ะผ่านลิงก์นี้ได้เลยครับ\n${LIFF}/booking`
      });
    case 'cancel_booking': {
      const bookingId = data.get('id');
      await bookingService.cancelBooking(bookingId, lineUserId);
      return lineService.replyMessage(replyToken, lineService.textMsg('✅ ยกเลิกการจองเรียบร้อยแล้วครับ'));
    }
    case 'human_handoff':
      return handleHumanHandoff(replyToken, lineUserId);
    case 'bot_mode':
      await setSessionMode(lineUserId, 'bot');
      return lineService.replyMessage(replyToken, lineService.textMsg('🤖 กลับมาคุยกับบอทแล้วนะครับ พิมพ์ "help" เพื่อดูเมนูความช่วยเหลือ'));
    case 'help':
      return handleHelp(replyToken, member);
    default:
      return lineService.replyMessage(replyToken, lineService.textMsg('ขอโทษครับ ไม่เข้าใจคำสั่งนี้'));
  }
}

// ─── Handle Text Message ──────────────────────────────────
async function handleTextMessage(event) {
  const { replyToken, source, message } = event;
  const lineUserId = source.userId;
  const text = message.text;

  // Check if in human mode
  const sessionMode = await getSessionMode(lineUserId);
  if (sessionMode === 'human') {
    // Forward to staff dashboard (in real system)
    logger.info('Human handoff message', { userId: lineUserId, text });
    return; // Staff will reply manually
  }

  const member = await memberService.getMemberByLineId(lineUserId);
  if (!member) {
    return handleNewUser(replyToken, lineUserId);
  }

  const intent = detectIntent(text);
  logger.debug('Intent detected', { intent, text });

  switch (intent) {
    case 'check_points':   return handleCheckPoints(replyToken, member);
    case 'check_coupons':  return handleMyCoupons(replyToken, member, lineUserId);
    case 'book_table':     return lineService.replyMessage(replyToken, lineService.textMsg(`📅 จองโต๊ะ: ${LIFF}/booking`));
    case 'opening_hours':  return handleOpeningHours(replyToken);
    case 'menu':           return handleMenu(replyToken);
    case 'human_handoff':  return handleHumanHandoff(replyToken, lineUserId);
    case 'check_tier':     return handleTierInfo(replyToken, member);
    case 'birthday':       return handleBirthday(replyToken, member);
    case 'help':           return handleHelp(replyToken, member);
    case 'thank_you':      return lineService.replyMessage(replyToken, lineService.textMsg(`ด้วยความยินดีครับ ${member.name || ''} 😊`));
    case 'pdpa':           return lineService.replyMessage(replyToken, lineService.textMsg(`จัดการข้อมูลส่วนตัว: ${LIFF}/pdpa`));
    case 'order':          return lineService.replyMessage(replyToken, lineService.textMsg(`สั่งอาหาร: ${LIFF}/order`));
    case 'register':       return lineService.replyMessage(replyToken, lineService.textMsg(`คุณเป็นสมาชิกอยู่แล้วครับ! ดูโปรไฟล์: ${LIFF}/profile`));
    default:               return handleUnknown(replyToken, lineUserId);
  }
}

// ─── Handle Follow (Add Friend) ────────────────────────────
async function handleFollow(event) {
  const lineUserId = event.source.userId;
  const profile = await lineService.getUserProfile(lineUserId);
  const name = profile?.displayName || 'คุณ';

  logger.info('New follower', { userId: lineUserId, name });

  await lineService.replyMessage(event.replyToken, [
    lineService.welcomeOnboardingMsg(name, LIFF),
    {
      type: 'text',
      text: `ยินดีต้อนรับ ${name}! 🎉\n\nสมัครสมาชิกฟรีรับคูปอง 20 บาท ที่ลิงก์ด้านบนเลยนะครับ\n\nพิมพ์ "help" เพื่อดูสิ่งที่ทำได้บน LINE นี้`
    }
  ]);
}

// ─── Handlers ──────────────────────────────────────────────
async function handleNewUser(replyToken, lineUserId) {
  const profile = await lineService.getUserProfile(lineUserId);
  await lineService.replyMessage(replyToken, lineService.welcomeOnboardingMsg(profile?.displayName || 'คุณ', LIFF));
}

async function handleCheckPoints(replyToken, member) {
  if (!member) return lineService.replyMessage(replyToken, lineService.textMsg(`กรุณาสมัครสมาชิกก่อนครับ: ${LIFF}/register`));
  const expiring = await loyaltyService.getExpiringPoints(member.id);

  return lineService.replyMessage(replyToken, {
    type: 'flex', altText: `แต้มของคุณ: ${member.points} แต้ม`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: '⭐ แต้มสะสมของคุณ', weight: 'bold', size: 'lg' },
          { type: 'separator' },
          { type: 'box', layout: 'horizontal', margin: 'md', contents: [
            { type: 'text', text: 'แต้มคงเหลือ', size: 'sm', color: '#555', flex: 2 },
            { type: 'text', text: `${member.points} แต้ม`, size: 'lg', weight: 'bold', color: '#1F4E79', align: 'end', flex: 3 }
          ]},
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: 'ระดับสมาชิก', size: 'sm', color: '#555', flex: 2 },
            { type: 'text', text: `${member.tier} ⭐`, size: 'sm', weight: 'bold', align: 'end', flex: 3 }
          ]},
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: 'เข้าร้านทั้งหมด', size: 'sm', color: '#555', flex: 2 },
            { type: 'text', text: `${member.total_visits} ครั้ง`, size: 'sm', align: 'end', flex: 3 }
          ]},
          ...(expiring > 0 ? [{
            type: 'text', text: `⚠️ ${expiring} แต้มใกล้หมดอายุใน 30 วัน!`,
            size: 'xs', color: '#e74c3c', margin: 'md'
          }] : [])
        ]
      },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'sm',
        contents: [
          { type: 'button', style: 'primary', flex: 1, height: 'sm',
            action: { type: 'uri', label: '🎁 แลกของรางวัล', uri: `${LIFF}/profile` }},
          { type: 'button', style: 'secondary', flex: 1, height: 'sm',
            action: { type: 'postback', label: '📋 คูปองของฉัน', data: 'action=my_coupons' }}
        ]
      }
    }
  });
}

async function handleMyCoupons(replyToken, member, lineUserId) {
  if (!member) return lineService.replyMessage(replyToken, lineService.textMsg(`กรุณาสมัครสมาชิก: ${LIFF}/register`));
  const coupons = await loyaltyService.getMemberCoupons(member.id);
  if (coupons.length === 0) {
    return lineService.replyMessage(replyToken, lineService.textMsg('ยังไม่มีคูปองที่ใช้งานได้ครับ 🎫\nสะสมแต้มเพื่อแลกคูปองได้เลย!'));
  }
  const bubbles = coupons.slice(0,10).map(c => ({
    type: 'bubble', size: 'micro',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#1F4E79',
      contents: [{ type: 'text', text: c.name, color: '#fff', size: 'sm', weight: 'bold', wrap: true }]},
    body: { type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: `ส่วนลด ${c.type === 'discount_baht' ? `฿${c.value}` : `${c.value}%`}`, size: 'lg', weight: 'bold', color: '#1F4E79' },
        { type: 'text', text: `รหัส: ${c.code}`, size: 'sm', color: '#555' },
        { type: 'text', text: `ถึง: ${new Date(c.valid_until).toLocaleDateString('th-TH')}`, size: 'xs', color: '#888' }
      ]}
  }));
  return lineService.replyMessage(replyToken, {
    type: 'flex', altText: `คูปองของคุณ ${coupons.length} ใบ`,
    contents: { type: 'carousel', contents: bubbles }
  });
}

async function handleOpeningHours(replyToken) {
  return lineService.replyMessage(replyToken, {
    type: 'flex', altText: 'เวลาเปิด-ปิดร้าน',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: '🕐 เวลาเปิด-ปิดร้าน', weight: 'bold', size: 'lg' },
          { type: 'separator' },
          { type: 'box', layout: 'horizontal', margin: 'md', contents: [
            { type: 'text', text: 'จันทร์ - ศุกร์', flex: 2, size: 'sm' },
            { type: 'text', text: '10:30 - 21:30', flex: 2, size: 'sm', align: 'end' }
          ]},
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: 'เสาร์ - อาทิตย์', flex: 2, size: 'sm' },
            { type: 'text', text: '10:00 - 22:00', flex: 2, size: 'sm', align: 'end' }
          ]},
          { type: 'text', text: 'Last order 30 นาทีก่อนปิด', size: 'xs', color: '#888', margin: 'md' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', height: 'sm', color: '#1F4E79',
          action: { type: 'postback', label: '📅 จองโต๊ะ', data: 'action=book_table' }
        }]
      }
    }
  });
}

async function handleMenu(replyToken) {
  return lineService.replyMessage(replyToken, {
    type: 'text',
    text: `🍽️ ดูเมนูทั้งหมดได้ที่:\n${LIFF}/order\n\nมีเมนูใหม่และ Allergen Info ครบถ้วนนะครับ 🌱`
  });
}

async function handleHumanHandoff(replyToken, lineUserId) {
  await setSessionMode(lineUserId, 'human');
  // Create chat session record
  await query(
    `INSERT INTO chat_sessions (line_user_id, mode) VALUES ($1,'human')
     ON CONFLICT DO NOTHING`,
    [lineUserId]
  );
  return lineService.replyMessage(replyToken, {
    type: 'flex', altText: 'กำลังเชื่อมต่อพนักงาน...',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: '👨‍💼 กำลังเชื่อมต่อพนักงาน...', weight: 'bold', size: 'lg' },
          { type: 'text', text: 'รอสักครู่นะครับ พนักงานจะตอบกลับเร็วๆ นี้\n\nเวลาทำการ: 10:00-21:30', wrap: true, size: 'sm', color: '#555' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'secondary', height: 'sm',
          action: { type: 'postback', label: '🤖 กลับไปคุยกับบอท', data: 'action=bot_mode' }
        }]
      }
    }
  });
}

async function handleTierInfo(replyToken, member) {
  if (!member) return;
  const tierBenefits = {
    Silver: '• สะสมแต้ม 4 แต้ม/100 บาท\n• แลกคูปองได้ทุกรายการ',
    Gold:   '• สะสมแต้ม 2 เท่าทุกวันพุธ\n• ส่วนลด 5% ทุกบิล\n• จองโต๊ะ Priority',
    Platinum:'• สะสมแต้ม 3 เท่า\n• ส่วนลด 10% ทุกบิล\n• เข้าถึง Exclusive Menu\n• VIP Event'
  };
  const nextTier = { Silver: 'Gold', Gold: 'Platinum', Platinum: null };
  const nextSpend = { Silver: 3000, Gold: 10000 };

  return lineService.replyMessage(replyToken, {
    type: 'flex', altText: `ระดับ ${member.tier}`,
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#1F4E79',
        contents: [{ type: 'text', text: `⭐ ระดับ ${member.tier}`, color: '#fff', weight: 'bold', size: 'xl' }]},
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: 'สิทธิพิเศษของคุณ:', weight: 'bold' },
          { type: 'text', text: tierBenefits[member.tier], wrap: true, size: 'sm' },
          { type: 'separator', margin: 'md' },
          { type: 'box', layout: 'horizontal', margin: 'md', contents: [
            { type: 'text', text: 'ยอดซื้อปีนี้', size: 'sm', color: '#555', flex: 2 },
            { type: 'text', text: `฿${Number(member.yearly_spend||0).toLocaleString()}`, size: 'sm', weight: 'bold', align: 'end', flex: 3 }
          ]},
          ...(nextTier[member.tier] ? [{
            type: 'text',
            text: `อีก ฿${(nextSpend[member.tier] - Number(member.yearly_spend||0)).toLocaleString()} ถึง ${nextTier[member.tier]}!`,
            size: 'xs', color: '#06C755', margin: 'sm'
          }] : [{ type: 'text', text: '🎉 คุณอยู่ในระดับสูงสุดแล้ว!', size: 'sm', color: '#7030A0' }])
        ]
      }
    }
  });
}

async function handleBirthday(replyToken, member) {
  if (!member?.birthday) {
    return lineService.replyMessage(replyToken, lineService.textMsg(`ยังไม่ได้กรอกวันเกิดครับ อัปเดตได้ที่: ${LIFF}/profile`));
  }
  const coupons = await loyaltyService.getMemberCoupons(member.id, 'birthday');
  return lineService.replyMessage(replyToken, lineService.textMsg(
    coupons.length > 0
      ? `🎂 คูปองวันเกิดของคุณ: ${coupons[0].code}\nใช้ได้ถึง ${new Date(coupons[0].valid_until).toLocaleDateString('th-TH')}`
      : `คูปองวันเกิดจะถูกส่งให้ 7 วันก่อนวันเกิดครับ 🎂`
  ));
}

async function handleHelp(replyToken, member) {
  return lineService.replyMessage(replyToken, {
    type: 'flex', altText: 'วิธีใช้งาน LINE นี้',
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#1F4E79',
        contents: [{ type: 'text', text: '📖 วิธีใช้งาน', color: '#fff', weight: 'bold', size: 'lg' }]},
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: 'พิมพ์คำเหล่านี้ได้เลย:', weight: 'bold', margin: 'none' },
          ...[
            ['⭐ "แต้ม"', 'ดูคะแนนสะสม'],
            ['🎫 "คูปอง"', 'ดูคูปองของคุณ'],
            ['📅 "จอง"', 'จองโต๊ะ'],
            ['🕐 "เปิดกี่โมง"', 'เวลาเปิด-ปิด'],
            ['🍽️ "เมนู"', 'ดูเมนูอาหาร'],
            ['⭐ "ระดับ"', 'ดูระดับสมาชิก'],
            ['🔒 "ข้อมูล"', 'จัดการ PDPA'],
            ['👨‍💼 "คน"', 'คุยกับพนักงาน'],
          ].map(([cmd, desc]) => ({
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              { type: 'text', text: cmd, size: 'sm', flex: 3 },
              { type: 'text', text: desc, size: 'sm', color: '#555', flex: 4 }
            ]
          }))
        ]
      }
    }
  });
}

async function handleUnknown(replyToken, lineUserId) {
  return lineService.replyMessage(replyToken, {
    type: 'flex', altText: 'ไม่เข้าใจครับ ลองอีกครั้ง',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: '🤔 ไม่เข้าใจครับ', weight: 'bold' },
          { type: 'text', text: 'ลองพิมพ์ "help" เพื่อดูคำสั่งที่ใช้ได้\nหรือกดปุ่มเมนูด้านล่างครับ', wrap: true, size: 'sm', color: '#555' }
        ]
      },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'sm',
        contents: [
          { type: 'button', style: 'primary', flex: 1, height: 'sm',
            action: { type: 'postback', label: '📖 Help', data: 'action=help' }},
          { type: 'button', style: 'secondary', flex: 1, height: 'sm',
            action: { type: 'postback', label: '👨‍💼 คุยกับคน', data: 'action=human_handoff' }}
        ]
      }
    }
  });
}

// ─── Session Mode (Bot/Human) ────────────────────────────
async function getSessionMode(lineUserId) {
  const mode = await redis.get(`session:mode:${lineUserId}`);
  return mode || 'bot';
}

async function setSessionMode(lineUserId, mode) {
  await redis.setex(`session:mode:${lineUserId}`, 3600 * 8, mode);
}

module.exports = { handleFollow, handleTextMessage, handlePostback, getSessionMode, setSessionMode };

// ─── New customer type handlers ────────────────────────────────────────────

async function handleBookReservation(event) {
  const { replyToken } = event;
  const msg = {
    type: 'flex',
    altText: '📅 จองโต๊ะล่วงหน้า',
    contents: {
      type: 'bubble',
      header: {
        type:'box', layout:'vertical', backgroundColor:'#1F4E79', paddingAll:'16px',
        contents:[{ type:'text', text:'📅 จองโต๊ะล่วงหน้า', color:'#fff', size:'lg', weight:'bold' }]
      },
      body: {
        type:'box', layout:'vertical', spacing:'md', paddingAll:'16px',
        contents:[
          { type:'text', text:'เลือกเมนูและชำระมัดจำ 50%', size:'sm', color:'#666', wrap:true },
          { type:'text', text:'ส่วนที่เหลือชำระที่ร้านในวันจริง', size:'sm', color:'#888', wrap:true },
          { type:'separator', margin:'md' },
          { type:'text', text:'✅ รับ 1–5 ท่าน', size:'sm', color:'#27AE60' },
          { type:'text', text:'✅ จองล่วงหน้าได้ถึง 30 วัน', size:'sm', color:'#27AE60', margin:'sm' },
          { type:'text', text:'⚠️ ยกเลิกฟรีก่อน 24 ชั่วโมง', size:'sm', color:'#E67E22', margin:'sm' },
        ]
      },
      footer: {
        type:'box', layout:'vertical', paddingAll:'12px', spacing:'sm',
        contents:[{
          type:'button', style:'primary', color:'#1F4E79',
          action:{ type:'uri', label:'📅 จองโต๊ะเลย', uri: process.env.LIFF_URL_RESERVATION || 'https://liff.line.me/@@RESERVATION@@' }
        }]
      }
    }
  };
  await lineService.replyMessage(replyToken, [msg]);
}

async function handleBookGroup(event) {
  const { replyToken } = event;
  const msg = {
    type: 'flex',
    altText: '🎉 จองหมู่คณะ',
    contents: {
      type: 'bubble',
      header: {
        type:'box', layout:'vertical', backgroundColor:'#6B2FAB', paddingAll:'16px',
        contents:[{ type:'text', text:'🎉 จองหมู่คณะ', color:'#fff', size:'lg', weight:'bold' }]
      },
      body: {
        type:'box', layout:'vertical', spacing:'md', paddingAll:'16px',
        contents:[
          { type:'text', text:'สำหรับ 6 ท่านขึ้นไป', size:'sm', color:'#666' },
          { type:'separator', margin:'md' },
          { type:'text', text:'📦 แพ็กเกจ A: ฿299/ท่าน (6+)', size:'sm', color:'#333', margin:'sm' },
          { type:'text', text:'📦 แพ็กเกจ B: ฿399/ท่าน (8+)', size:'sm', color:'#333', margin:'sm' },
          { type:'text', text:'📦 แพ็กเกจ C: ฿599/ท่าน (12+)', size:'sm', color:'#333', margin:'sm' },
          { type:'separator', margin:'md' },
          { type:'text', text:'มัดจำ 50% • ทีมงานโทรยืนยัน 1 วัน', size:'xs', color:'#aaa', wrap:true },
        ]
      },
      footer: {
        type:'box', layout:'vertical', paddingAll:'12px',
        contents:[{
          type:'button', style:'primary', color:'#6B2FAB',
          action:{ type:'uri', label:'🎉 จองหมู่คณะเลย', uri: process.env.LIFF_URL_GROUP || 'https://liff.line.me/@@GROUP@@' }
        }]
      }
    }
  };
  await lineService.replyMessage(replyToken, [msg]);
}
