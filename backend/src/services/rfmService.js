const { query } = require('../config/database');

async function getRFMReport(branchId = null) {
  const res = await query(
    `SELECT rfm_segment, COUNT(*) as count,
       AVG(monetary) as avg_spend, AVG(frequency) as avg_visits,
       AVG(recency_days) as avg_recency
     FROM member_rfm
     ${branchId ? 'WHERE id IN (SELECT id FROM members WHERE branch_id=$1)' : ''}
     GROUP BY rfm_segment`,
    branchId ? [branchId] : []
  );
  return res.rows;
}

async function getMemberRFM(memberId) {
  const res = await query(
    'SELECT * FROM member_rfm WHERE id=$1',
    [memberId]
  );
  return res.rows[0];
}

async function getChurnRisk() {
  const res = await query(
    `SELECT m.*, mr.recency_days, mr.rfm_segment
     FROM member_rfm mr JOIN members m ON m.id=mr.id
     WHERE mr.rfm_segment IN ('At-Risk','Lost')
     ORDER BY mr.recency_days DESC LIMIT 100`,
    []
  );
  return res.rows;
}

async function getDashboardStats(branchId = null) {
  const branchFilter = branchId ? 'AND branch_id=$1' : '';
  const params = branchId ? [branchId] : [];

  const [members, revenue, topTier, newThisWeek] = await Promise.all([
    query(`SELECT COUNT(*) FROM members WHERE is_active=TRUE ${branchFilter}`, params),
    query(`SELECT COALESCE(SUM(monetary),0) as total FROM member_rfm`, []),
    query(`SELECT tier, COUNT(*) FROM members WHERE is_active=TRUE GROUP BY tier`, []),
    query(`SELECT COUNT(*) FROM members WHERE registered_at > NOW()-INTERVAL '7 days'`, []),
  ]);

  return {
    total_members:  parseInt(members.rows[0].count),
    total_revenue:  parseFloat(revenue.rows[0].total),
    tier_breakdown: topTier.rows,
    new_this_week:  parseInt(newThisWeek.rows[0].count),
  };
}

module.exports = { getRFMReport, getMemberRFM, getChurnRisk, getDashboardStats };
