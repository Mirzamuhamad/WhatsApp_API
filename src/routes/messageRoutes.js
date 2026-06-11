import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { clearMessages, countMessages, deleteMessage, listMessages } from '../services/sessionRepository.js';

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.storage.uploadDir),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname || '');
      callback(null, `${Date.now()}-${uuidv4()}${extension}`);
    }
  }),
  limits: {
    fileSize: config.storage.maxUploadMb * 1024 * 1024
  }
});

function parsePagination(query, defaultLimit = 100) {
  const limitValue = query.limit ?? query.perPage ?? defaultLimit;
  const all = String(limitValue).toLowerCase() === 'all';
  const page = Math.max(Number.parseInt(query.page || '1', 10) || 1, 1);

  if (all) {
    return { all: true, limit: null, offset: 0, page: 1, perPage: 'all' };
  }

  const limit = Math.min(Math.max(Number.parseInt(limitValue, 10) || defaultLimit, 1), 100000);
  return {
    all: false,
    limit,
    offset: (page - 1) * limit,
    page,
    perPage: limit
  };
}

export function messageRoutes(manager) {
  const router = Router();

  router.get(
    '/messages',
    asyncHandler(async (req, res) => {
      const paging = parsePagination(req.query);
      const [total, data] = await Promise.all([countMessages(), listMessages(paging)]);
      res.json({ success: true, total, page: paging.page, perPage: paging.perPage, data });
    })
  );

  router.delete(
    '/messages',
    asyncHandler(async (req, res) => {
      const deleted = await clearMessages(req.query.session || req.body?.session || null);
      res.json({ success: true, deleted });
    })
  );

  router.delete(
    '/messages/:id',
    asyncHandler(async (req, res) => {
      const deleted = await deleteMessage(req.params.id);
      res.json({ success: true, deleted });
    })
  );

  router.post(
    '/send-message',
    asyncHandler(async (req, res) => {
      const data = await manager.sendText(req.body || {});
      res.json({ success: true, messageId: data.messageId, data });
    })
  );

  router.post(
    '/send-media',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      const data = await manager.sendMedia({
        session: req.body?.session,
        phone: req.body?.phone,
        type: req.body?.type,
        caption: req.body?.caption,
        file: req.file
      });
      res.json({ success: true, messageId: data.messageId, data });
    })
  );

  router.post(
    '/send-media-url',
    asyncHandler(async (req, res) => {
      const data = await manager.sendMediaFromUrl(req.body || {});
      res.json({ success: true, messageId: data.messageId, data });
    })
  );

  router.post('/send-button', (_req, res) => {
    res.status(501).json({
      success: false,
      message:
        'Button messages are not enabled because current WhatsApp Web/Baileys support is inconsistent. Use text/media or implement an interactive message adapter after validating device support.'
    });
  });

  router.post('/send-template', (_req, res) => {
    res.status(501).json({
      success: false,
      message:
        'Template messages are only officially supported through Meta WhatsApp Business APIs, not this Baileys-based gateway.'
    });
  });

  return router;
}

export function urlMessageRoutes(manager) {
  const router = Router();

  router.get(
    '/send-message',
    asyncHandler(async (req, res) => {
      const data = await manager.sendText({
        session: req.query.session,
        phone: req.query.phone,
        message: req.query.message || req.query.text
      });
      res.json({ success: true, messageId: data.messageId, data });
    })
  );

  router.get(
    '/send-media',
    asyncHandler(async (req, res) => {
      const data = await manager.sendMediaFromUrl({
        session: req.query.session,
        phone: req.query.phone,
        type: req.query.type,
        url: req.query.url,
        caption: req.query.caption,
        fileName: req.query.filename || req.query.fileName,
        mimetype: req.query.mimetype
      });
      res.json({ success: true, messageId: data.messageId, data });
    })
  );

  return router;
}
