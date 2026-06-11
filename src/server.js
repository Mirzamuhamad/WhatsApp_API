import express from 'express';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { config } from './config.js';
import { logger } from './logger.js';
import { initDatabase } from './services/database.js';
import { initRedis } from './services/redisClient.js';
import { WebhookService } from './services/webhookService.js';
import { WhatsappSessionManager } from './services/whatsappSessionManager.js';
import { ipWhitelist, requireAuth, requireUrlAuth } from './middleware/auth.js';
import { authRoutes } from './routes/authRoutes.js';
import { sessionRoutes } from './routes/sessionRoutes.js';
import { messageRoutes, urlMessageRoutes } from './routes/messageRoutes.js';
import { webhookRoutes } from './routes/webhookRoutes.js';
import { contactRoutes } from './routes/contactRoutes.js';

async function main() {
  await initDatabase();
  await initRedis();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' }
  });

  const apiLimiter = rateLimit({
    windowMs: config.auth.rateLimitWindowMs,
    limit: config.auth.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });

  app.set('trust proxy', config.app.trustProxy);
  app.use(cors());
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'", 'https://cdn.jsdelivr.net']
        }
      }
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(config.app.rootDir, 'public')));

  const webhookService = new WebhookService();
  const manager = new WhatsappSessionManager({ io, webhookService });

  app.get('/health', (_req, res) => {
    res.json({ success: true, service: config.app.name, status: 'ok' });
  });

  app.use('/api/auth', apiLimiter, authRoutes());
  app.use('/api/url', ipWhitelist, apiLimiter, requireUrlAuth, urlMessageRoutes(manager));
  app.use('/api', ipWhitelist, apiLimiter, requireAuth);
  app.use('/api', sessionRoutes(manager));
  app.use('/api', messageRoutes(manager));
  app.use('/api', contactRoutes(manager));
  app.use('/api', webhookRoutes(io));

  if (config.webhook.inboundPublic) {
    app.use('/webhook', webhookRoutes(io));
  } else {
    app.use('/webhook', ipWhitelist, apiLimiter, requireAuth, webhookRoutes(io));
  }

  io.on('connection', (socket) => {
    socket.emit('ready', { service: config.app.name });
  });

  app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
  });

  app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      logger.error({ error }, 'Unhandled request error');
    }
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Internal server error',
      details: error.details
    });
  });

  server.listen(config.app.port, async () => {
    logger.info({ url: `http://localhost:${config.app.port}` }, 'WA Gateway started');
    await manager.restoreSessions();
  });
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start WA Gateway');
  process.exit(1);
});
