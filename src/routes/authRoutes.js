import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { unauthorized } from '../utils/errors.js';

export function authRoutes() {
  const router = Router();

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const { apiKey } = req.body || {};
      if (!apiKey || !config.auth.apiKeys.includes(String(apiKey))) {
        throw unauthorized('Invalid API key');
      }

      const token = jwt.sign({ scope: 'api' }, config.auth.jwtSecret, {
        expiresIn: config.auth.jwtExpiresIn
      });

      res.json({ success: true, token, expiresIn: config.auth.jwtExpiresIn });
    })
  );

  return router;
}
