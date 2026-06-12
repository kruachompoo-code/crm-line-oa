const { client } = require('../config/line');
const redis = require('../config/redis');
const logger = require('../config/logger');

// ─── Token Auto-rotation ──────────────────────────────────
async function getValidToken() {
  const cached = await redis.get('line:access_token');
  if (cached) return cached;

  // Refresh token if needed (stateless token, just return from env)
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  await redis.setex('line:access_token', 3600 * 24, token);
  return token;
}

// ─── Send Reply ───────────────────────────────────────────
async function replyMessage(replyToken, messages) {
  try {
    const msgs = Array.isArray(messages) ? messages : [messages];
    await client.replyMessage({ replyToken, messages: msgs });
  } catch (err) {
    logger.error('replyMessage error', { err: err.message });
  }
}

// ─── Send Push ────────────────────────────────────────────
async function pushMessage(lineUserId, messages) {
  try {
    const msgs = Array.isArray(messages) ? messages : [messages];
    await client.pushMessage({ to: lineUserId, messages: msgs });
  } catch (err) {
    logger.error('pushMessage error', { userId: lineUserId, err: err.message });
  }
}

// ─── Multicast (max 500 per call) ─────────────────────────
async function multicastMessage(userIds, messages) {
  const msgs = Array.isArray(messages) ? messages : [messages];
  const batchSize = 500;
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    try {
      await client.multicast({ to: batch, messages: msgs });
    } catch (err) {
      logger.error('multicast error', { batch: i, err: err.message });
    }
    await sleep(200);
  }
}

// ─── Broadcast ────────────────────────────────────────────
async function broadcastMessage(messages) {
  try {
    const msgs = Array.isArray(messages) ? messages : [messages];
    await client.broadcast({ messages: msgs });
  } catch (err) {
    logger.error('broadcastMessage error', { err: err.message });
  }
}

// ─── Get User Profile ─────────────────────────────────────
async function getUserProfile(lineUserId) {
  try {
    const cacheKey = `line:profile:${lineUserId}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const profile = await client.getProfile(lineUserId);
    await redis.setex(cacheKey, 3600, JSON.stringify(profile));
    return profile;
  } catch (err) {
    logger.error('getUserProfile error', { userId: lineUserId, err: err.message });
    return null;
  }
}

// ─── Set Rich Menu ────────────────────────────────────────
async function setUserRichMenu(lineUserId, richMenuId) {
  try {
    await client.linkRichMenuIdToUser(lineUserId, richMenuId);
  } catch (err) {
    logger.error('setUserRichMenu error', err.message);
  }
}

// ─── Message Templates ───────────────────────────────────

function textMsg(text) {
  return { type: 'text', text };
}

function welcomeOnboardingMsg(name, liffBaseUrl) {
  return {
    type: 'flex',
    altText: `ยินดีต้อนรับ ${name}! 🎉`,
    contents: {
      type: 'bubble',
      size: 'mega',
      hero: {
        type: 'image',
        url: `${liffBaseUrl}/images/welcome-banner.jpg`,
        size: 'full',
        aspectRatio: '20:9',
        aspectMode: 'cover'
      },
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#1F4E79',
        contents: [{
          type: 'text', text: `🎉 ยินดีต้อนรับ ${name}!`,
          color: '#ffffff', size: 'xl', weight: 'bold'
        }]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: 'เป็นสมาชิกฟรี รับสิทธิ์ทันที!', size: 'md', wrap: true },
          {
            type: 'box', layout: 'vertical', spacing: 'sm',
            contents: [
              { type: 'text', text: '⭐ สะสมแต้มทุกการทาน', size: 'sm' },
              { type: 'text', text: '🎁 คูปองต้อนรับ 20 บาท', size: 'sm' },
              { type: 'text', text: '📅 จองโต๊ะผ่าน LINE ได้เลย', size: 'sm' },
              { type: 'text', text: '🎂 รับของขวัญวันเกิด', size: 'sm' },
            ]
          }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary',
          color: '#1F4E79',
          action: {
            type: 'uri', label: 'สมัครสมาชิกฟรี รับคูปอง 20 บาท',
            uri: `${liffBaseUrl}/register`
          }
        }]
      }
    }
  };
}

function pointsNotifyMsg(member, earned, newBalance) {
  return {
    type: 'flex',
    altText: `ได้รับ ${earned} แต้ม! 🌟`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: '🌟 ได้รับแต้มสะสม!', weight: 'bold', size: 'lg' },
          { type: 'separator' },
          {
            type: 'box', layout: 'horizontal', margin: 'md',
            contents: [
              { type: 'text', text: 'แต้มที่ได้รับ', size: 'sm', color: '#555' },
              { type: 'text', text: `+${earned} แต้ม`, size: 'sm', weight: 'bold', color: '#06C755', align: 'end' }
            ]
          },
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: 'แต้มรวม', size: 'sm', color: '#555' },
              { type: 'text', text: `${newBalance} แต้ม`, size: 'sm', weight: 'bold', align: 'end' }
            ]
          },
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ระดับสมาชิก', size: 'sm', color: '#555' },
              { type: 'text', text: member.tier, size: 'sm', weight: 'bold', color: '#1F4E79', align: 'end' }
            ]
          }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'secondary', height: 'sm',
          action: { type: 'postback', label: '📊 ดูแต้มทั้งหมด', data: 'action=check_points' }
        }]
      }
    }
  };
}

function birthdayMsg(member, couponCode, liffBaseUrl) {
  return {
    type: 'flex',
    altText: `🎂 สุขสันต์วันเกิด ${member.name}!`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#7030A0',
        contents: [
          { type: 'text', text: '🎂', size: '5xl', align: 'center' },
          { type: 'text', text: `สุขสันต์วันเกิด`, color: '#fff', size: 'xl', weight: 'bold', align: 'center' },
          { type: 'text', text: member.name || '', color: '#ffe082', size: 'lg', align: 'center' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: 'ของขวัญพิเศษจากเรา 🎁', weight: 'bold', size: 'md' },
          {
            type: 'box', layout: 'vertical', backgroundColor: '#F3EEF8',
            cornerRadius: '8px', padding: '12px',
            contents: [
              { type: 'text', text: 'คูปองส่วนลด 50 บาท', weight: 'bold', size: 'lg', align: 'center' },
              { type: 'text', text: couponCode, size: 'xl', weight: 'bold', color: '#7030A0', align: 'center' },
              { type: 'text', text: 'ใช้ได้ภายใน 7 วัน', size: 'xs', color: '#888', align: 'center' }
            ]
          }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#7030A0',
          action: { type: 'postback', label: '🎂 ดูคูปองวันเกิด', data: 'action=my_coupons' }
        }]
      }
    }
  };
}

function reEngagementMsg(member, couponCode) {
  return {
    type: 'flex',
    altText: `${member.name} เราคิดถึงคุณ 💭`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '💭 เราคิดถึงคุณ!', weight: 'bold', size: 'xl' },
          { type: 'text', text: `สวัสดี ${member.name || 'คุณ'} ไม่ได้เจอกันนาน มีโปรพิเศษมาฝาก`, wrap: true, size: 'sm', color: '#555' },
          {
            type: 'box', layout: 'vertical', backgroundColor: '#FEF6EE',
            cornerRadius: '8px', padding: '12px',
            contents: [
              { type: 'text', text: '🔥 Flash Coupon เฉพาะคุณ', weight: 'bold', align: 'center' },
              { type: 'text', text: 'ส่วนลด 30 บาท', size: 'lg', weight: 'bold', color: '#C55A11', align: 'center' },
              { type: 'text', text: couponCode, color: '#C55A11', align: 'center' },
              { type: 'text', text: 'ใช้ได้ 72 ชั่วโมงเท่านั้น!', size: 'xs', color: '#888', align: 'center' }
            ]
          }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#C55A11',
          action: { type: 'postback', label: '🍽️ จองโต๊ะเลย', data: 'action=book_table' }
        }]
      }
    }
  };
}

function tierUpgradeMsg(member, newTier) {
  const colors = { Gold: '#F4B942', Platinum: '#7030A0' };
  const color = colors[newTier] || '#1F4E79';
  return {
    type: 'flex',
    altText: `🎊 ยินดีด้วย! อัปเกรดเป็น ${newTier}!`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: color,
        contents: [
          { type: 'text', text: '🎊', size: '5xl', align: 'center' },
          { type: 'text', text: 'ยินดีด้วย!', color: '#fff', weight: 'bold', size: 'xl', align: 'center' },
          { type: 'text', text: `คุณได้อัปเกรดเป็น ${newTier}!`, color: '#fff', size: 'md', align: 'center' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: 'สิทธิพิเศษใหม่ของคุณ:', weight: 'bold' },
          { type: 'text', text: newTier === 'Gold' ? '• ส่วนลด 5% ทุกการทาน\n• คะแนนสะสม 2 เท่าทุกวันพุธ\n• จองโต๊ะ Priority' : '• ส่วนลด 10% ทุกการทาน\n• คะแนนสะสม 3 เท่า\n• เข้าถึง Exclusive Menu\n• VIP Event Invite', wrap: true, size: 'sm' }
        ]
      }
    }
  };
}

function bookingConfirmMsg(booking) {
  return {
    type: 'flex',
    altText: `✅ ยืนยันการจองโต๊ะ ${booking.booking_date}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1F4E79',
        contents: [{ type: 'text', text: '✅ ยืนยันการจองโต๊ะ', color: '#fff', weight: 'bold', size: 'lg' }]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: '📅 วันที่', size: 'sm', color: '#555', flex: 2 },
            { type: 'text', text: booking.booking_date, size: 'sm', flex: 3 }
          ]},
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: '🕐 เวลา', size: 'sm', color: '#555', flex: 2 },
            { type: 'text', text: booking.booking_time, size: 'sm', flex: 3 }
          ]},
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: '👥 จำนวน', size: 'sm', color: '#555', flex: 2 },
            { type: 'text', text: `${booking.party_size} คน`, size: 'sm', flex: 3 }
          ]},
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: '📍 สาขา', size: 'sm', color: '#555', flex: 2 },
            { type: 'text', text: booking.branch_name || 'สาขาหลัก', size: 'sm', flex: 3 }
          ]},
          { type: 'separator' },
          { type: 'text', text: `รหัสจอง: ${booking.id.slice(0,8).toUpperCase()}`, size: 'xs', color: '#888', align: 'center' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'secondary', height: 'sm',
          action: { type: 'postback', label: '❌ ยกเลิกการจอง', data: `action=cancel_booking&id=${booking.id}` }
        }]
      }
    }
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  getValidToken, replyMessage, pushMessage, multicastMessage, broadcastMessage,
  getUserProfile, setUserRichMenu,
  textMsg, welcomeOnboardingMsg, pointsNotifyMsg, birthdayMsg,
  reEngagementMsg, tierUpgradeMsg, bookingConfirmMsg
};
