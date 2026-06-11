import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ quiet: true });

const rootDir = process.cwd();

function csv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function trustProxy(value, env) {
  if (value === undefined || value === '') {
    return env === 'production' ? 1 : false;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : value;
}

const appEnv = process.env.APP_ENV || process.env.NODE_ENV || 'local';

export const config = {
  app: {
    name: process.env.APP_NAME || 'WA Gateway Self Hosted',
    env: appEnv,
    port: int(process.env.APP_PORT, 3000),
    url: process.env.APP_URL || 'http://localhost:3000',
    trustProxy: trustProxy(process.env.APP_TRUST_PROXY, appEnv),
    rootDir
  },
  auth: {
    apiKeys: csv(process.env.API_KEYS || 'isi-api-key-anda'),
    jwtSecret: process.env.JWT_SECRET || 'isi-jwt-secret-anda',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
    ipWhitelist: csv(process.env.IP_WHITELIST),
    rateLimitWindowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMax: int(process.env.RATE_LIMIT_MAX, 120)
  },
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: int(process.env.MYSQL_PORT, 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'wa_gateway',
    waitForConnections: true,
    connectionLimit: int(process.env.MYSQL_CONNECTION_LIMIT, 20)
  },
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: int(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: int(process.env.REDIS_DB, 0)
  },
  storage: {
    baseDir: path.resolve(rootDir, process.env.STORAGE_DIR || 'storage'),
    authDir: path.resolve(rootDir, process.env.AUTH_DIR || 'storage/auth'),
    uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || 'storage/uploads'),
    maxUploadMb: int(process.env.MAX_UPLOAD_MB, 25)
  },
  webhook: {
    timeoutMs: int(process.env.WEBHOOK_TIMEOUT_MS, 10_000),
    inboundPublic: String(process.env.WEBHOOK_INBOUND_PUBLIC || 'false') === 'true'
  }
};
