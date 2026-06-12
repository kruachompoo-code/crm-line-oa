const campaignService = require('../services/campaignService');

// Middleware for push-notification APIs: check frequency cap before sending
async function frequencyCapCheck(req, res, next) {
  const { lineUserId } = req.body;
  if (!lineUserId) return next(); // bulk sends handled inside campaignService

  const allowed = await campaignService.canSendMessage(lineUserId);
  if (!allowed) {
    return res.status(429).json({ error: 'Frequency cap reached for this user' });
  }
  next();
}

module.exports = { frequencyCapCheck };
