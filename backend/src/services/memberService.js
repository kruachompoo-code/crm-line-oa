const { query } = require('../config/database');
const redis = require('../config/redis');
const logger = require('../config/logger');

const CACHE_TTL = 300; // 5 min

async function getMemberByLineId(lineUserId) {
  const key = `member:line:${lineUserId}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const res = await query('SELECT * FROM members WHERE line_user_id=$1 AND is_active=TRUE', [lineUserId]);
  const member = res.rows[0] || null;
  if (member) await redis.setex(key, CACHE_TTL, JSON.stringify(member));
  return member;
}

async function getMemberById(id) {
  const key = `member:id:${id}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const res = await query('SELECT * FROM members WHERE id=$1', [id]);
  const member = res.rows[0] || null;
  if (member) await redis.setex(key, CACHE_TTL, JSON.stringify(member));
  return member;
}

async function createMember(data) {
  const { lineUserId, phone, name, displayName, pictureUrl, birthday, gender, branchId, referralCode } = data;
  const res = await query(
    `INSERT INTO members (line_user_id,phone,name,display_name,picture_url,birthday,gender,branch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [lineUserId, phone, name, displayName, pictureUrl, birthday||null, gender||null, branchId||null]
  );
  const member = res.rows[0];

  // Create default notification prefs
  await query('INSERT INTO notification_prefs (member_id) VALUES ($1) ON CONFLICT DO NOTHING', [member.id]);

  // Handle referral
  if (referralCode) {
    const referrer = await query('SELECT id FROM members WHERE id=$1', [referralCode]);
    if (referrer.rows[0]) {
      await query(
        'INSERT INTO referrals (referrer_id,referred_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [referralCode, member.id]
      );
    }
  }

  await invalidateCache(lineUserId, member.id);
  logger.info('Member created', { memberId: member.id, lineUserId });
  return member;
}

async function updateMember(id, data) {
  const fields = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(data)) {
    fields.push(`${k}=$${i++}`);
    values.push(v);
  }
  fields.push(`updated_at=NOW()`);
  values.push(id);
  const res = await query(
    `UPDATE members SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
    values
  );
  const member = res.rows[0];
  if (member) await invalidateCache(member.line_user_id, id);
  return member;
}

async function recordVisit(memberId, branchId, amountBaht) {
  const res = await query(
    `UPDATE members SET
       total_visits = total_visits + 1,
       last_visit_at = NOW(),
       yearly_spend = yearly_spend + $1,
       streak_count = CASE
         WHEN last_streak_at = CURRENT_DATE - INTERVAL '1 day' THEN streak_count + 1
         WHEN last_streak_at = CURRENT_DATE THEN streak_count
         ELSE 1
       END,
       last_streak_at = CURRENT_DATE
     WHERE id=$2 RETURNING *`,
    [amountBaht, memberId]
  );
  const member = res.rows[0];
  if (member) await invalidateCache(member.line_user_id, memberId);
  return member;
}

async function getSegment(segment, limit = 1000) {
  const queries = {
    all:       `SELECT * FROM members WHERE is_active=TRUE AND is_blocked=FALSE LIMIT $1`,
    new:       `SELECT * FROM members WHERE is_active=TRUE AND total_visits<=2 LIMIT $1`,
    loyal:     `SELECT * FROM members WHERE is_active=TRUE AND total_visits>=4 AND last_visit_at > NOW()-INTERVAL '14 days' LIMIT $1`,
    at_risk:   `SELECT * FROM members WHERE is_active=TRUE AND last_visit_at BETWEEN NOW()-INTERVAL '90 days' AND NOW()-INTERVAL '30 days' LIMIT $1`,
    vip:       `SELECT * FROM members WHERE is_active=TRUE AND tier='Platinum' LIMIT $1`,
    gold:      `SELECT * FROM members WHERE is_active=TRUE AND tier='Gold' LIMIT $1`,
    family:    `SELECT * FROM members WHERE is_active=TRUE AND family_id IS NOT NULL LIMIT $1`,
    corporate: `SELECT * FROM members WHERE is_active=TRUE AND is_corporate=TRUE LIMIT $1`,
  };
  const sql = queries[segment] || queries.all;
  const res = await query(sql, [limit]);
  return res.rows;
}

async function getMembersWithBirthdayIn(days) {
  const res = await query(
    `SELECT * FROM members
     WHERE is_active=TRUE
       AND birthday IS NOT NULL
       AND TO_CHAR(birthday,'MMDD') = TO_CHAR(NOW() + INTERVAL '${days} days','MMDD')`,
    []
  );
  return res.rows;
}

async function getMembersInactive(days) {
  const res = await query(
    `SELECT m.* FROM members m
     LEFT JOIN notification_prefs np ON np.member_id=m.id
     WHERE m.is_active=TRUE
       AND m.last_visit_at < NOW()-INTERVAL '${days} days'
       AND (np.allow_promotion IS NULL OR np.allow_promotion=TRUE)`,
    []
  );
  return res.rows;
}

async function invalidateCache(lineUserId, memberId) {
  if (lineUserId) await redis.del(`member:line:${lineUserId}`);
  if (memberId)   await redis.del(`member:id:${memberId}`);
}

module.exports = {
  getMemberByLineId, getMemberById, createMember, updateMember,
  recordVisit, getSegment, getMembersWithBirthdayIn, getMembersInactive, invalidateCache
};
