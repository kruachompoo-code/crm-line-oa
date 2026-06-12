const { query } = require('../config/database');
const redis = require('../config/redis');
const lineService = require('./lineService');
const loyaltyService = require('./loyaltyService');
const memberService = require('./memberService');
const logger = require('../config/logger');

const MAX_MSG_PER_WEEK = parseInt(process.env.MAX_MSG_PER_WEEK || '3');
const QUIET_START = parseInt(process.env.QUIET_HOURS_START || '22');
const QUIET_END   = parseInt(process.env.QUIET_HOURS_END || '8');

// ─── Frequency Cap Check ──────────────────────────────────
async function canSendMessage(memberId) {
  const now = new Date();
  const hour = now.getHours();

  // Quiet hours check (Thailand time)
  if (hour >= QUIET_START || hour < QUIET_END) return false;

  // Weekly limit check (DB)
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const dateStr = weekStart.toISOString().split('T')[0];

  const res = await query(
    `SELECT count FROM message_frequency WHERE member_id=$1 AND week_start=$2`,
    [memberId, dateStr]
  );
  const count = res.rows[0]?.count || 0;
  return count < MAX_MSG_PER_WEEK;
}

async function recordMessageSent(memberId) {
  const now = new Date();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const dateStr = weekStart.toISOString().split('T')[0];

  await query(
    `INSERT INTO message_frequency (member_id,week_start,count) VALUES ($1,$2,1)
     ON CONFLICT (member_id,week_start) DO UPDATE SET count=message_frequency.count+1`,
    [memberId, dateStr]
  );
}

// ─── Send to Segment ──────────────────────────────────────
async function sendToSegment(campaignId, segmentName, messages) {
  const members = await memberService.getSegment(segmentName);
  let sent = 0, skipped = 0;

  for (const member of members) {
    const ok = await canSendMessage(member.id);
    if (!ok) { skipped++; continue; }

    try {
      await lineService.pushMessage(member.line_user_id, messages);
      await recordMessageSent(member.id);
      await query(
        `INSERT INTO campaign_logs (campaign_id,member_id,status) VALUES ($1,$2,'sent')
         ON CONFLICT DO NOTHING`,
        [campaignId, member.id]
      );
      sent++;
    } catch (err) {
      logger.error('Campaign send error', { memberId: member.id, err: err.message });
      skipped++;
    }

    await sleep(50); // rate limit
  }

  await query(
    `UPDATE campaigns SET status='completed', sent_at=NOW(), total_sent=$1 WHERE id=$2`,
    [sent, campaignId]
  );

  logger.info('Campaign sent', { campaignId, sent, skipped });
  return { sent, skipped };
}

// ─── Birthday Campaign (runs daily) ──────────────────────
async function runBirthdayJob() {
  const members = await memberService.getMembersWithBirthdayIn(7);
  for (const member of members) {
    // Check if birthday coupon already issued this year
    const existing = await query(
      `SELECT id FROM member_coupons mc
       JOIN coupons c ON c.id=mc.coupon_id
       WHERE mc.member_id=$1 AND c.name LIKE '%วันเกิด%'
         AND EXTRACT(YEAR FROM mc.issued_at)=EXTRACT(YEAR FROM NOW())`,
      [member.id]
    );
    if (existing.rows.length > 0) continue;

    const coupon = await loyaltyService.issueBirthdayCoupon(member.id);
    await lineService.pushMessage(member.line_user_id,
      lineService.birthdayMsg(member, coupon.code, process.env.FRONTEND_URL)
    );
    logger.info('Birthday coupon sent', { memberId: member.id });
  }
}

// ─── Re-engagement Campaign (runs daily) ─────────────────
async function runReEngagementJob() {
  const days = parseInt(process.env.REENGAGEMENT_DAYS || '30');
  const members = await memberService.getMembersInactive(days);

  for (const member of members) {
    // Check if already sent re-engagement this month
    const key = `reeng:${member.id}:${new Date().getMonth()}`;
    const sent = await redis.get(key);
    if (sent) continue;

    const coupon = await loyaltyService.issueReEngagementCoupon(member.id);
    await lineService.pushMessage(member.line_user_id,
      lineService.reEngagementMsg(member, coupon.code)
    );
    await redis.setex(key, 3600 * 24 * 35, '1');
    await recordMessageSent(member.id);
    logger.info('Re-engagement sent', { memberId: member.id });
  }
}

// ─── Points Expiry Warning (runs daily) ──────────────────
async function runPointsExpiryJob() {
  const res = await query(
    `SELECT DISTINCT m.* FROM members m
     JOIN point_transactions pt ON pt.member_id=m.id
     WHERE pt.type LIKE 'earn%'
       AND pt.expires_at BETWEEN NOW() AND NOW()+INTERVAL '14 days'
       AND m.is_active=TRUE`,
    []
  );

  for (const member of res.rows) {
    const expiring = await loyaltyService.getExpiringPoints(member.id);
    if (expiring <= 0) continue;

    const key = `expiry_warn:${member.id}:${new Date().getMonth()}`;
    const warned = await redis.get(key);
    if (warned) continue;

    await lineService.pushMessage(member.line_user_id, {
      type: 'text',
      text: `⚠️ แจ้งเตือน: คุณมี ${expiring} แต้มที่กำลังจะหมดอายุใน 14 วัน!\n\nรีบแลกรางวัลก่อนนะครับ 🎁`
    });
    await redis.setex(key, 3600 * 24 * 40, '1');
  }
}

// ─── Tier Downgrade Warning (yearly) ─────────────────────
async function runTierReviewJob() {
  // Run on Jan 1 — check if yearly spend qualifies for current tier
  const res = await query(
    `SELECT * FROM members WHERE is_active=TRUE AND tier != 'Silver'`,
    []
  );

  for (const member of res.rows) {
    const newTier = member.yearly_spend >= 10000 ? 'Platinum'
                  : member.yearly_spend >= 3000  ? 'Gold' : 'Silver';

    if (newTier !== member.tier) {
      await query('UPDATE members SET tier=$1, yearly_spend=0 WHERE id=$2', [newTier, member.id]);
      await lineService.pushMessage(member.line_user_id, {
        type: 'text',
        text: `⭐ อัปเดตระดับสมาชิก: ระดับของคุณปีนี้คือ ${newTier}\n${newTier < member.tier ? 'ยังไงก็ยังรักคุณอยู่นะครับ 🙏 มาสะสมยอดเพิ่มในปีนี้เลย!' : '🎉 ยินดีด้วยครับ!'}`
      });
    } else {
      await query('UPDATE members SET yearly_spend=0 WHERE id=$2', [member.id]);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  canSendMessage, recordMessageSent, sendToSegment,
  runBirthdayJob, runReEngagementJob, runPointsExpiryJob, runTierReviewJob
};
