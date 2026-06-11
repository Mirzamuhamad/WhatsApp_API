import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { listSessions } from '../services/sessionRepository.js';

export function sessionRoutes(manager) {
  const router = Router();

  router.get(
    '/sessions',
    asyncHandler(async (_req, res) => {
      res.json({ success: true, data: await listSessions() });
    })
  );

  router.post(
    '/session',
    asyncHandler(async (req, res) => {
      const session = await manager.createSession(req.body?.session_name || req.body?.name);
      res.status(201).json({
        success: true,
        sessionId: session.id,
        data: session
      });
    })
  );

  router.get(
    '/session/:id/qrcode',
    asyncHandler(async (req, res) => {
      const data = await manager.getQRCode(req.params.id);
      res.json({ success: true, ...data });
    })
  );

  router.get(
    '/session/:id/status',
    asyncHandler(async (req, res) => {
      const data = await manager.getStatus(req.params.id);
      res.json({ success: true, ...data });
    })
  );

  router.post(
    '/session/:id/reconnect',
    asyncHandler(async (req, res) => {
      const session = await manager.resolveSession(req.params.id);
      await manager.startSession(session.id, session.session_name);
      res.json({ success: true, session: session.id, status: 'connecting' });
    })
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const identifier = req.body?.session || req.body?.session_id || req.body?.id;
      const data = await manager.logout(identifier);
      res.json({ success: true, ...data });
    })
  );

  router.delete(
    '/session/:id',
    asyncHandler(async (req, res) => {
      const data = await manager.deleteSession(req.params.id);
      res.json({ success: true, ...data });
    })
  );

  return router;
}
