import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

let redis = null;
let enabled = false;

export async function initRedis() {
  redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db,
    lazyConnect: true,
    connectTimeout: 1000,
    retryStrategy: null,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  });

  redis.on('error', (error) => {
    enabled = false;
    logger.warn({ error: error.message }, 'Redis unavailable; continuing without cache');
  });

  try {
    await redis.connect();
    enabled = true;
    logger.info('Redis connected');
  } catch (error) {
    enabled = false;
    logger.warn({ error: error.message }, 'Redis connection failed; cache disabled');
  }

  return redis;
}

export function redisClient() {
  return enabled ? redis : null;
}

export async function cacheSessionStatus(sessionId, status) {
  const client = redisClient();
  if (!client) {
    return;
  }
  await client.set(`session:${sessionId}:status`, status, 'EX', 300);
}
