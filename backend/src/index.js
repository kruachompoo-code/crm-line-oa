require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const logger  = require('./config/logger');
const { startScheduler } = require('./jobs/scheduler');

const webhookRouter   = require('./routes/webhook');
const memberRouter    = require('./routes/member');
const bookingRouter   = require('./routes/booking');
const dashboardRouter = require('./routes/dashboard');
const authRouter      = require('./routes/auth');

const app = express();

// Security
app.use(helmet());
app.use(rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true }));

// Webhook must receive raw body for LINE signature verification
app.use('/webhook', express.raw({ type: '*/*' }), webhookRouter);

// JSON for all other routes
app.use(express.json());

app.use('/api/auth',      authRouter);
app.use('/api/members',   memberRouter);
app.use('/api/bookings',  bookingRouter);
app.use('/api/dashboard', dashboardRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { err: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  startScheduler();
});

module.exports = app;
