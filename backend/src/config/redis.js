const Redis = require('ioredis');

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
          retryStrategy: (times) => Math.min(times * 50, 2000),
  })
    : new Redis({
            host:     process.env.REDIS_HOST || 'localhost',
            port:     parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD || undefined,
            retryStrategy: (times) => Math.min(times * 50, 2000),
    });

redis.on('error', (err) => console.error('Redis error:', err));
redis.on('connect', () => console.log('Redis connected'));

module.exports = redis;
