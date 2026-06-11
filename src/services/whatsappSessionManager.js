import fs from 'node:fs/promises';
import path from 'node:path';
import qrcode from 'qrcode';
import pino from 'pino';
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { cacheSessionStatus } from './redisClient.js';
import {
  createSessionRecord,
  deleteSessionRecord,
  findSession,
  insertMessage,
  listSessions,
  updateSessionStatus
} from './sessionRepository.js';
import { badRequest, notFound } from '../utils/errors.js';
import { jidToPhone, normalizePhone, phoneToJid } from '../utils/phone.js';
import { sessionIdFromName } from '../utils/slug.js';
import { resetAuthFolderIfCorrupt, useAtomicMultiFileAuthState } from './authState.js';

const reconnectDelayMs = 5000;

function extractMessageText(message) {
  const content = message?.message || {};
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  );
}

function extractMediaType(message) {
  const content = message?.message || {};
  if (content.imageMessage) return 'image';
  if (content.videoMessage) return 'video';
  if (content.audioMessage) return 'audio';
  if (content.documentMessage) return 'document';
  return null;
}

function statusFromCode(code) {
  if (code === DisconnectReason.loggedOut) {
    return 'disconnected';
  }
  return 'connecting';
}

function assertHttpUrl(value, field = 'url') {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Invalid protocol');
    }
    return parsed.toString();
  } catch (_error) {
    throw badRequest(`${field} must be a valid http or https URL`);
  }
}

export class WhatsappSessionManager {
  constructor({ io, webhookService }) {
    this.io = io;
    this.webhookService = webhookService;
    this.sessions = new Map();
  }

  async ensureStorage() {
    await fs.mkdir(config.storage.authDir, { recursive: true });
    await fs.mkdir(config.storage.uploadDir, { recursive: true });
  }

  async restoreSessions() {
    await this.ensureStorage();
    const rows = await listSessions();
    await Promise.allSettled(
      rows.map((session) => {
        if (session.status === 'disconnected') {
          return Promise.resolve();
        }
        return this.startSession(session.id, session.session_name);
      })
    );
  }

  async createSession(sessionName) {
    const cleanName = String(sessionName || '').trim();
    if (!cleanName) {
      throw badRequest('Session name is required');
    }

    const id = sessionIdFromName(cleanName);
    const existing = await findSession(id);
    if (existing) {
      throw badRequest('Session already exists');
    }

    const session = await createSessionRecord({
      id,
      sessionName: cleanName,
      status: 'connecting'
    });
    await this.startSession(session.id, session.session_name);
    return session;
  }

  async startSession(id, sessionName) {
    await this.ensureStorage();

    const current = this.sessions.get(id);
    if (current?.starting) {
      return current;
    }
    if (current?.sock?.ws?.readyState === 1) {
      return current;
    }

    const runtime = {
      id,
      sessionName,
      status: 'connecting',
      qr: null,
      sock: null,
      starting: true,
      reconnectTimer: null
    };
    this.sessions.set(id, runtime);
    await this.setStatus(id, 'connecting');

    const authPath = path.join(config.storage.authDir, id);
    await fs.mkdir(authPath, { recursive: true });
    const wasReset = await resetAuthFolderIfCorrupt(authPath, id);
    if (wasReset) {
      runtime.qr = null;
      await this.setStatus(id, 'connecting');
    }

    const { state, saveCreds } = await useAtomicMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      browser: ['WA Gateway', 'Chrome', '1.0.0']
    });

    runtime.sock = sock;
    runtime.starting = false;

    const persistCreds = async () => {
      try {
        await saveCreds();
      } catch (error) {
        logger.error({ session: id, error: error.message }, 'Failed to persist WhatsApp credentials');
      }
    };

    await persistCreds();
    sock.ev.on('creds.update', persistCreds);

    sock.ev.on('connection.update', async (update) => {
      try {
        await this.handleConnectionUpdate(id, sessionName, update);
      } catch (error) {
        logger.error({ session: id, error }, 'Connection update handler failed');
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') {
        return;
      }
      for (const message of messages) {
        await this.handleIncomingMessage(id, message);
      }
    });

    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        this.io.emit('status_changed', {
          session: id,
          messageId: update.key?.id,
          status: update.update?.status || update.update
        });
      }
    });

    return runtime;
  }

  async handleConnectionUpdate(id, sessionName, update) {
    const runtime = this.sessions.get(id);

    if (update.qr) {
      const qr = await qrcode.toDataURL(update.qr);
      if (runtime) {
        runtime.qr = qr;
      }
      await this.setStatus(id, 'qr_required');
      this.io.emit('qr', { session: id, qrcode: qr });
      return;
    }

    if (update.connection === 'open') {
      const phone = jidToPhone(runtime?.sock?.user?.id);
      if (runtime) {
        runtime.status = 'connected';
        runtime.qr = null;
      }
      await this.setStatus(id, 'connected', phone);
      this.io.emit('connected', { session: id, phone });
      return;
    }

    if (update.connection === 'close') {
      const statusCode = new Boom(update.lastDisconnect?.error)?.output?.statusCode;
      const status = statusFromCode(statusCode);
      if (runtime) {
        runtime.status = status;
        runtime.sock = null;
      }
      await this.setStatus(id, status);
      this.io.emit('disconnected', { session: id, reason: statusCode || null });

      if (statusCode !== DisconnectReason.loggedOut) {
        const timer = setTimeout(() => {
          this.startSession(id, sessionName).catch((error) => {
            logger.error({ session: id, error }, 'Auto reconnect failed');
          });
        }, reconnectDelayMs);
        if (runtime) {
          runtime.reconnectTimer = timer;
        }
      }
    }
  }

  async handleIncomingMessage(sessionId, message) {
    if (!message?.key?.remoteJid || message.key.fromMe) {
      return;
    }

    const phone = jidToPhone(message.key.remoteJid);
    const text = extractMessageText(message);
    const mediaType = extractMediaType(message);
    let mediaPath = null;

    if (mediaType) {
      try {
        const buffer = await downloadMediaMessage(
          message,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }) }
        );
        const extension = mediaType === 'image' ? 'jpg' : 'bin';
        const fileName = `${Date.now()}-${message.key.id}.${extension}`;
        mediaPath = path.join(config.storage.uploadDir, fileName);
        await fs.writeFile(mediaPath, buffer);
      } catch (error) {
        logger.warn({ session: sessionId, error: error.message }, 'Failed to save incoming media');
      }
    }

    await insertMessage({
      messageId: message.key.id,
      sessionId,
      direction: 'incoming',
      phone,
      message: text,
      mediaPath,
      mediaType,
      status: 'received'
    });

    const payload = {
      session: sessionId,
      from: phone,
      message: text,
      mediaType,
      mediaPath,
      messageId: message.key.id
    };

    this.io.emit('message_received', payload);
    this.webhookService.dispatch('message_received', payload).catch((error) => {
      logger.warn({ error: error.message }, 'Webhook dispatch error');
    });
  }

  async setStatus(id, status, phoneNumber = null) {
    const runtime = this.sessions.get(id);
    if (runtime) {
      runtime.status = status;
    }
    await updateSessionStatus(id, status, phoneNumber);
    await cacheSessionStatus(id, status);
    this.io.emit('status_changed', { session: id, status, phoneNumber });
  }

  async getStatus(identifier) {
    const session = await this.resolveSession(identifier);
    const runtime = this.sessions.get(session.id);
    return {
      session: session.id,
      sessionName: session.session_name,
      phoneNumber: session.phone_number,
      status: runtime?.status || session.status,
      lastActivity: session.last_activity
    };
  }

  async getQRCode(identifier) {
    const session = await this.resolveSession(identifier);
    let runtime = this.sessions.get(session.id);
    if (!runtime) {
      runtime = await this.startSession(session.id, session.session_name);
    }

    return {
      session: session.id,
      status: runtime.status || session.status,
      qrcode: runtime.qr
    };
  }

  async resolveSession(identifier) {
    const session = await findSession(identifier);
    if (!session) {
      throw notFound('Session not found');
    }
    return session;
  }

  async getConnectedSocket(identifier) {
    const session = await this.resolveSession(identifier);
    const runtime = this.sessions.get(session.id);
    if (!runtime?.sock || (runtime.status !== 'connected' && session.status !== 'connected')) {
      throw badRequest('Session is not connected');
    }
    return { session, sock: runtime.sock };
  }

  async sendText({ session: sessionIdentifier, phone, message }) {
    const normalizedPhone = normalizePhone(phone);
    if (!sessionIdentifier || !normalizedPhone || !message) {
      throw badRequest('session, phone, and message are required');
    }

    const { session, sock } = await this.getConnectedSocket(sessionIdentifier);
    const result = await sock.sendMessage(phoneToJid(normalizedPhone), { text: message });
    const messageId = result?.key?.id || null;

    await insertMessage({
      messageId,
      sessionId: session.id,
      direction: 'outgoing',
      phone: normalizedPhone,
      message,
      status: 'sent'
    });

    const payload = { session: session.id, phone: normalizedPhone, message, messageId };
    this.io.emit('message_sent', payload);
    return payload;
  }

  async sendMedia({ session: sessionIdentifier, phone, type, caption, file }) {
    const normalizedPhone = normalizePhone(phone);
    if (!sessionIdentifier || !normalizedPhone || !type || !file) {
      throw badRequest('session, phone, type, and file are required');
    }

    const allowed = ['image', 'document', 'audio', 'video'];
    if (!allowed.includes(type)) {
      throw badRequest(`Unsupported media type. Use one of: ${allowed.join(', ')}`);
    }

    const { session, sock } = await this.getConnectedSocket(sessionIdentifier);
    const content = this.buildMediaContent({ type, caption, file });
    const result = await sock.sendMessage(phoneToJid(normalizedPhone), content);
    const messageId = result?.key?.id || null;

    await insertMessage({
      messageId,
      sessionId: session.id,
      direction: 'outgoing',
      phone: normalizedPhone,
      message: caption || null,
      mediaPath: file.path,
      mediaType: type,
      status: 'sent'
    });

    const payload = {
      session: session.id,
      phone: normalizedPhone,
      mediaType: type,
      caption,
      messageId
    };
    this.io.emit('message_sent', payload);
    return payload;
  }

  async sendMediaFromUrl({
    session: sessionIdentifier,
    phone,
    type,
    url,
    caption,
    fileName,
    mimetype
  }) {
    const normalizedPhone = normalizePhone(phone);
    const mediaUrl = assertHttpUrl(url, 'url');
    if (!sessionIdentifier || !normalizedPhone || !type) {
      throw badRequest('session, phone, type, and url are required');
    }

    const allowed = ['image', 'document', 'audio', 'video'];
    if (!allowed.includes(type)) {
      throw badRequest(`Unsupported media type. Use one of: ${allowed.join(', ')}`);
    }

    const { session, sock } = await this.getConnectedSocket(sessionIdentifier);
    const content = this.buildMediaContentFromUrl({ type, url: mediaUrl, caption, fileName, mimetype });
    const result = await sock.sendMessage(phoneToJid(normalizedPhone), content);
    const messageId = result?.key?.id || null;

    await insertMessage({
      messageId,
      sessionId: session.id,
      direction: 'outgoing',
      phone: normalizedPhone,
      message: caption || null,
      mediaPath: mediaUrl,
      mediaType: type,
      status: 'sent'
    });

    const payload = {
      session: session.id,
      phone: normalizedPhone,
      mediaType: type,
      mediaUrl,
      caption,
      messageId
    };
    this.io.emit('message_sent', payload);
    return payload;
  }

  buildMediaContent({ type, caption, file }) {
    const source = { url: file.path };
    if (type === 'image') {
      return { image: source, caption };
    }
    if (type === 'video') {
      return { video: source, caption };
    }
    if (type === 'audio') {
      return { audio: source, mimetype: file.mimetype, ptt: false };
    }
    return {
      document: source,
      mimetype: file.mimetype,
      fileName: file.originalname,
      caption
    };
  }

  buildMediaContentFromUrl({ type, url, caption, fileName, mimetype }) {
    const source = { url };
    if (type === 'image') {
      return { image: source, caption };
    }
    if (type === 'video') {
      return { video: source, caption };
    }
    if (type === 'audio') {
      return { audio: source, mimetype: mimetype || 'audio/mpeg', ptt: false };
    }
    return {
      document: source,
      mimetype: mimetype || 'application/octet-stream',
      fileName: fileName || path.basename(new URL(url).pathname) || 'document',
      caption
    };
  }

  async logout(identifier) {
    const session = await this.resolveSession(identifier);
    const runtime = this.sessions.get(session.id);
    if (runtime?.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
    }
    if (runtime?.sock) {
      await runtime.sock.logout().catch(() => {});
      runtime.sock.end?.();
    }
    this.sessions.delete(session.id);
    await this.setStatus(session.id, 'disconnected');
    await fs.rm(path.join(config.storage.authDir, session.id), { recursive: true, force: true });
    return { session: session.id, status: 'disconnected' };
  }

  async deleteSession(identifier) {
    const session = await this.resolveSession(identifier);
    await this.logout(session.id).catch(() => {});
    await deleteSessionRecord(session.id);
    await fs.rm(path.join(config.storage.authDir, session.id), { recursive: true, force: true });
    return { session: session.id, deleted: true };
  }
}
