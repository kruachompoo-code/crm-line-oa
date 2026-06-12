const Redis = require('ioredis');

const redis = new Redis({
  host:     process.env.REDIS_HOST || 'localhost',
  port:     process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

redis.on('error', (err) => console.error('Redis error:', err));
redis.on('connect', () => console.log('Redis connected'));

module.exports = redis;
