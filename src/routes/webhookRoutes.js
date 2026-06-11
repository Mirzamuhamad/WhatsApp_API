import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  createWebhook,
  deleteWebhook,
  insertMessage,
  listWebhooks,
  updateWebhook
} from '../services/sessionRepository.js';
import { badRequest } from '../utils/errors.js';

export function webhookRoutes(io) {
  const router = Router();

  router.get(
    '/webhooks',
    asyncHandler(async (_req, res) => {
      res.json({ success: true, data: await listWebhooks() });
    })
  );

  router.post(
    '/webhooks',
    asyncHandler(async (req, res) => {
      const { url, events } = req.body || {};
      if (!url) {
        throw badRequest('Webhook URL is required');
      }
      const id = await createWebhook({ url, events });
      res.status(201).json({ success: true, id });
    })
  );

  router.patch(
    '/webhooks/:id',
    asyncHandler(async (req, res) => {
      await updateWebhook(req.params.id, req.body || {});
      res.json({ success: true });
    })
  );

  router.delete(
    '/webhooks/:id',
    asyncHandler(async (req, res) => {
      await deleteWebhook(req.params.id);
      res.json({ success: true });
    })
  );

  router.post(
    '/message',
    asyncHandler(async (req, res) => {
      const { session, from, phone, message, status = 'received' } = req.body || {};
      const sender = from || phone;
      if (!session || !sender) {
        throw badRequest('session and from/phone are required');
      }

      await insertMessage({
        sessionId: session,
        direction: 'incoming',
        phone: sender,
        message: message || null,
        status
      });

      const payload = { session, from: sender, message: message || '', status };
      io.emit('message_received', payload);
      res.json({ success: true, payload });
    })
  );

  return router;
}
