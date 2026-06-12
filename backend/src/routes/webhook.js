const express = require('express');
const { middleware, validateSignature } = require('@line/bot-sdk');
const chatbotService = require('../services/chatbotService');
const logger = require('../config/logger');

const router = express.Router();

const lineMiddleware = middleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET
});

router.post('/', lineMiddleware, async (req, res) => {
  res.status(200).json({ status: 'ok' });

  const events = req.body.events || [];
  for (const event of events) {
    try {
      if (event.type === 'follow')            await chatbotService.handleFollow(event);
      else if (event.type === 'message' && event.message.type === 'text')
                                              await chatbotService.handleTextMessage(event);
      else if (event.type === 'postback')     await chatbotService.handlePostback(event);
    } catch (err) {
      logger.error('Webhook event error', { type: event.type, err: err.message });
    }
  }
});

module.exports = router;
