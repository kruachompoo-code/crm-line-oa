const { query, getClient } = require('../config/database');
const redis = require('../config/redis');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

const POINTS_PER_BAHT  = parseFloat(process.env.POINTS_PER_BAHT || '0.04');
const EXPIRE_MONTHS    = parseInt(process.env.POINTS_EXPIRE_MONTHS || '12');
const TIER_GOLD_MIN    = parseFloat(process.env.TIER_GOLD_MIN || '3000');
const TIER_PLAT_MIN    = parseFloat(process.env.TIER_PLATINUM_MIN || '10000');

// ─── Earn Points ─────────────────────────────────────────
async function earnPoints(memberId, amountBaht, type = 'earn_purchase', refId = null, branchId = null) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Determine multiplier by tier & day
    const memberRes = await client.query('SELECT * FROM members WHERE id=$1', [memberId]);
    const member = memberRes.rows[0];
    let multiplier = 1;
    if (member.tier === 'Gold' && new Date().getDay() === 3) multiplier = 2;     // Wednesday
    if (member.tier === 'Platinum') multiplier = 3;

    const earned = Math.floor(amountBaht * POINTS_PER_BAHT * 100 * multiplier);
    const expAt = new Date();
    expAt.setMonth(expAt.getMonth() + EXPIRE_MONTHS);

    const newBalance = member.points + earned;

    await client.query(
      `UPDATE members SET points=$1, updated_at=NOW() WHERE id=$2`,
      [newBalance, memberId]
    );

    await client.query(
      `INSERT INTO point_transactions
         (member_id,type,points,balance,amount_baht,description,ref_id,branch_id,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [memberId, type, earned, newBalance, amountBaht,
       `ซื้อสินค้า ฿${amountBaht} × ${multiplier} เท่า`, refId, branchId, expAt]
    );

    // Check tier upgrade
    const newSpendRes = await client.query('SELECT yearly_spend,tier FROM members WHERE id=$1', [memberId]);
    const { yearly_spend, tier } = newSpendRes.rows[0];
    const newTier = yearly_spend >= TIER_PLAT_MIN ? 'Platinum' : yearly_spend >= TIER_GOLD_MIN ? 'Gold' : 'Silver';

    let tierChanged = false;
    if (newTier !== tier) {
      await client.query('UPDATE members SET tier=$1 WHERE id=$2', [newTier, memberId]);
      await client.query(
        'INSERT INTO tier_history (member_id,from_tier,to_tier,reason) VALUES ($1,$2,$3,$4)',
        [memberId, tier, newTier, 'Auto-upgrade based on yearly spend']
      );
      tierChanged = true;
    }

    await client.query('COMMIT');
    logger.info('Points earned', { memberId, earned, multiplier, newBalance });
    return { earned, newBalance, tierChanged, newTier };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('earnPoints error', err);
    throw err;
  } finally {
    client.release();
  }
}

// ─── Issue Coupon ─────────────────────────────────────────
async function issueCoupon(memberId, couponData) {
  const code = 'C' + Date.now().toString(36).toUpperCase().slice(-6);
  const couponRes = await query(
    `INSERT INTO coupons (code,name,description,type,value,min_spend,valid_from,valid_until,campaign_id)
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8) RETURNING *`,
    [code, couponData.name, couponData.description || '',
     couponData.type || 'discount_baht', couponData.value,
     couponData.min_spend || 0,
     couponData.valid_until, couponData.campaign_id || null]
  );
  const coupon = couponRes.rows[0];

  await query(
    'INSERT INTO member_coupons (member_id,coupon_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [memberId, coupon.id]
  );

  return coupon;
}

// ─── Redeem Coupon ────────────────────────────────────────
async function redeemCoupon(memberId, couponCode) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT mc.*, c.* FROM member_coupons mc
       JOIN coupons c ON c.id=mc.coupon_id
       WHERE mc.member_id=$1 AND c.code=$2 AND mc.status='active'
         AND c.valid_until > NOW()`,
      [memberId, couponCode]
    );
    if (res.rows.length === 0) throw new Error('Coupon not found or expired');

    const coupon = res.rows[0];
    await client.query(
      `UPDATE member_coupons SET status='used', used_at=NOW() WHERE member_id=$1 AND coupon_id=$2`,
      [memberId, coupon.coupon_id]
    );
    await client.query(
      `UPDATE coupons SET total_redeemed=total_redeemed+1 WHERE id=$1`,
      [coupon.coupon_id]
    );
    await client.query('COMMIT');
    return coupon;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Get Member Coupons ────────────────────────────────────
async function getMemberCoupons(memberId, tag = null) {
  let sql = `SELECT mc.*, c.* FROM member_coupons mc
             JOIN coupons c ON c.id=mc.coupon_id
             WHERE mc.member_id=$1 AND mc.status='active' AND c.valid_until > NOW()`;
  if (tag === 'birthday') sql += ` AND c.campaign_id IN (SELECT id FROM campaigns WHERE type='birthday')`;
  sql += ' ORDER BY c.valid_until ASC LIMIT 10';
  const res = await query(sql, [memberId]);
  return res.rows;
}

// ─── Get Expiring Points ───────────────────────────────────
async function getExpiringPoints(memberId) {
  const res = await query(
    `SELECT COALESCE(SUM(points),0) as total FROM point_transactions
     WHERE member_id=$1 AND type LIKE 'earn%'
       AND expires_at BETWEEN NOW() AND NOW()+INTERVAL '30 days'`,
    [memberId]
  );
  return parseInt(res.rows[0].total);
}

// ─── Issue Welcome Coupon ─────────────────────────────────
async function issueWelcomeCoupon(memberId) {
  const until = new Date();
  until.setDate(until.getDate() + 30);
  return issueCoupon(memberId, {
    name: '🎉 ยินดีต้อนรับ — ส่วนลด 20 บาท',
    type: 'discount_baht',
    value: 20,
    min_spend: 100,
    valid_until: until
  });
}

// ─── Issue Birthday Coupon ────────────────────────────────
async function issueBirthdayCoupon(memberId) {
  const until = new Date();
  until.setDate(until.getDate() + 7);
  return issueCoupon(memberId, {
    name: '🎂 คูปองวันเกิดพิเศษ — ส่วนลด 50 บาท',
    type: 'discount_baht',
    value: 50,
    min_spend: 200,
    valid_until: until
  });
}

// ─── Issue Re-engagement Coupon ────────────────────────────
async function issueReEngagementCoupon(memberId) {
  const until = new Date();
  until.setHours(until.getHours() + 72);
  return issueCoupon(memberId, {
    name: '🔥 Flash Coupon — ส่วนลด 30 บาท',
    type: 'discount_baht',
    value: 30,
    min_spend: 150,
    valid_until: until
  });
}

// ─── Award Badge ──────────────────────────────────────────
async function checkAndAwardBadges(memberId) {
  const member = (await query('SELECT * FROM members WHERE id=$1', [memberId])).rows[0];
  if (!member) return [];

  const newBadges = [];
  const current = member.badges || [];

  const checks = [
    { id: 'first_visit',   cond: member.total_visits >= 1 },
    { id: 'streak_3',      cond: member.streak_count >= 3 },
    { id: 'streak_5',      cond: member.streak_count >= 5 },
    { id: 'streak_10',     cond: member.streak_count >= 10 },
    { id: 'big_spender',   cond: parseFloat(member.yearly_spend) >= 5000 },
  ];

  for (const c of checks) {
    if (c.cond && !current.includes(c.id)) {
      newBadges.push(c.id);
      // Award badge points
      const badge = (await query('SELECT * FROM badges WHERE id=$1', [c.id])).rows[0];
      if (badge?.points_reward) {
        await earnPoints(memberId, 0, 'earn_bonus', `badge:${c.id}`);
      }
    }
  }

  if (newBadges.length > 0) {
    await query(
      `UPDATE members SET badges=array_cat(badges,$1::text[]) WHERE id=$2`,
      [newBadges, memberId]
    );
  }
  return newBadges;
}

module.exports = {
  earnPoints, issueCoupon, redeemCoupon, getMemberCoupons, getExpiringPoints,
  issueWelcomeCoupon, issueBirthdayCoupon, issueReEngagementCoupon, checkAndAwardBadges
};
