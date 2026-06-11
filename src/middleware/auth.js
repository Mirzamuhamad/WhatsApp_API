import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../utils/errors.js';

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.ip || '')
    .split(',')[0]
    .trim()
    .replace('::ffff:', '');
}

export function ipWhitelist(req, _res, next) {
  if (config.auth.ipWhitelist.length === 0) {
    return next();
  }

  const ip = requestIp(req);
  if (config.auth.ipWhitelist.includes(ip)) {
    return next();
  }

  return next(forbidden('IP address is not allowed'));
}

export function requireAuth(req, _res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && config.auth.apiKeys.includes(String(apiKey))) {
    req.auth = { type: 'api_key' };
    return next();
  }

  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (token) {
    try {
      req.auth = {
        type: 'jwt',
        payload: jwt.verify(token, config.auth.jwtSecret)
      };
      return next();
    } catch (_error) {
      return next(unauthorized('Invalid JWT token'));
    }
  }

  return next(unauthorized('Missing API authentication'));
}

export function requireUrlAuth(req, _res, next) {
  const apiKey = req.query.apikey || req.query.api_key || req.query.key || req.headers['x-api-key'];
  if (apiKey && config.auth.apiKeys.includes(String(apiKey))) {
    req.auth = { type: 'url_api_key' };
    return next();
  }

  return next(unauthorized('Missing or invalid apikey query parameter'));
}
