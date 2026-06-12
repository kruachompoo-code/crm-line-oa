const axios = require('axios');
const redis = require('../config/redis');

const TOKEN_KEY = 'line:channel_token';
const EXPIRE_S  = 86400; // 24h

async function getChannelToken() {
  const cached = await redis.get(TOKEN_KEY);
  if (cached) return cached;

  // Stateless channel access token (v3)
  const res = await axios.post(
    'https://api.line.me/oauth2/v3/token',
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:      process.env.LINE_CHANNEL_ID,
      client_secret:  process.env.LINE_CHANNEL_SECRET,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const token = res.data.access_token;
  await redis.setex(TOKEN_KEY, EXPIRE_S, token);
  return token;
}

async function revokeToken(token) {
  await axios.post('https://api.line.me/oauth2/v3/revoke',
    new URLSearchParams({ client_id: process.env.LINE_CHANNEL_ID, client_secret: process.env.LINE_CHANNEL_SECRET, access_token: token }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  await redis.del(TOKEN_KEY);
}

module.exports = { getChannelToken, revokeToken };
