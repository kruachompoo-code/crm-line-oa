const cron = require('node-cron');
const campaignService = require('../services/campaignService');
const bookingService  = require('../services/bookingService');
const logger = require('../config/logger');

function wrap(name, fn) {
  return async () => {
    logger.info(`[JOB] Starting: ${name}`);
    try {
      await fn();
      logger.info(`[JOB] Done: ${name}`);
    } catch (err) {
      logger.error(`[JOB] Failed: ${name}`, { err: err.message });
    }
  };
}

function startScheduler() {
  // Birthday coupons — daily at 09:00
  cron.schedule('0 9 * * *', wrap('BirthdayJob', () => campaignService.runBirthdayJob()));

  // Re-engagement — daily at 10:00
  cron.schedule('0 10 * * *', wrap('ReEngagementJob', () => campaignService.runReEngagementJob()));

  // Points expiry warnings — daily at 11:00
  cron.schedule('0 11 * * *', wrap('PointsExpiryJob', () => campaignService.runPointsExpiryJob()));

  // Tier review — 1st Jan at 00:05
  cron.schedule('5 0 1 1 *', wrap('TierReviewJob', () => campaignService.runTierReviewJob()));

  // Booking reminders — every hour
  cron.schedule('0 * * * *', wrap('BookingReminders', () => bookingService.sendReminders()));

  logger.info('[Scheduler] All jobs registered');
}

module.exports = { startScheduler };
