import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import readXlsxFile from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';
import { config } from '../config.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest } from '../utils/errors.js';
import { normalizePhone } from '../utils/phone.js';
import {
  clearContacts,
  countContacts,
  createContact,
  deleteContact,
  listContacts,
  updateContact,
  upsertContacts
} from '../services/sessionRepository.js';

const upload = multer({
  dest: config.storage.uploadDir,
  limits: {
    fileSize: config.storage.maxUploadMb * 1024 * 1024
  }
});

const headerAliases = {
  name: ['nama', 'name', 'customer', 'pelanggan'],
  phone: ['no telp', 'no_telp', 'notelp', 'nomor', 'nomor hp', 'no hp', 'phone', 'telp', 'telephone']
};

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function findHeaderIndex(headers, aliases) {
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
}

function parseContacts(rows) {
  if (rows[0]?.data) {
    rows = rows[0].data;
  }

  if (!rows.length) {
    return { contacts: [], skipped: 0 };
  }

  const headers = rows[0].map(normalizeHeader);
  const nameIndex = findHeaderIndex(headers, headerAliases.name);
  const phoneIndex = findHeaderIndex(headers, headerAliases.phone);

  if (nameIndex === -1 || phoneIndex === -1) {
    throw badRequest('Excel harus memiliki kolom Nama dan No telp');
  }

  const unique = new Map();
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const name = String(row[nameIndex] || '').trim();
    const phone = normalizePhone(row[phoneIndex]);
    if (!name || !phone) {
      skipped += 1;
      continue;
    }
    unique.set(phone, { name, phone });
  }

  return { contacts: [...unique.values()], skipped };
}

async function workbookBuffer(rows) {
  const sheetData = [
    [
      { value: 'Nama', fontWeight: 'bold' },
      { value: 'No telp', fontWeight: 'bold' }
    ],
    ...rows.map((row) => [{ value: row[0] }, { value: row[1] }])
  ];

  return writeXlsxFile(sheetData, {
    columns: [{ width: 30 }, { width: 22 }]
  }).toBuffer();
}

function renderMessage(template, contact) {
  return String(template || '')
    .replaceAll('{nama}', contact.name)
    .replaceAll('{name}', contact.name)
    .replaceAll('{phone}', contact.phone)
    .replaceAll('{no_telp}', contact.phone);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePagination(query, defaultLimit = 1000) {
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

export function contactRoutes(manager) {
  const router = Router();

  router.get(
    '/contacts',
    asyncHandler(async (req, res) => {
      const paging = parsePagination(req.query);
      const [total, contacts] = await Promise.all([countContacts(), listContacts(paging)]);
      res.json({ success: true, total, page: paging.page, perPage: paging.perPage, data: contacts });
    })
  );

  router.post(
    '/contacts',
    asyncHandler(async (req, res) => {
      const name = String(req.body?.name || req.body?.nama || '').trim();
      const phone = normalizePhone(req.body?.phone || req.body?.no_telp || req.body?.noTelp);
      if (!name || !phone) {
        throw badRequest('Nama dan No telp wajib diisi');
      }

      const affectedRows = await createContact({ name, phone });
      const total = await countContacts();
      res.status(201).json({ success: true, affectedRows, total, data: { name, phone } });
    })
  );

  router.post(
    '/contacts/import',
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw badRequest('File Excel wajib diupload dengan field file');
      }

      let rows;
      try {
        rows = await readXlsxFile(req.file.path);
      } finally {
        await fs.rm(req.file.path, { force: true }).catch(() => {});
      }

      const { contacts, skipped } = parseContacts(rows);
      const affectedRows = await upsertContacts(contacts);
      const total = await countContacts();

      res.json({
        success: true,
        imported: contacts.length,
        skipped,
        affectedRows,
        total
      });
    })
  );

  router.get(
    '/contacts/export',
    asyncHandler(async (_req, res) => {
      const contacts = await listContacts(100000);
      const buffer = await workbookBuffer(contacts.map((contact) => [contact.name, contact.phone]));
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="wa-contacts.xlsx"');
      res.send(Buffer.from(buffer));
    })
  );

  router.get(
    '/contacts/template',
    asyncHandler(async (_req, res) => {
      const buffer = await workbookBuffer([
        ['Budi Santoso', '628123456789'],
        ['Siti Aminah', '628987654321']
      ]);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="template-kontak-wa.xlsx"');
      res.send(Buffer.from(buffer));
    })
  );

  router.delete(
    '/contacts',
    asyncHandler(async (_req, res) => {
      const deleted = await clearContacts();
      res.json({ success: true, deleted });
    })
  );

  router.delete(
    '/contacts/:id',
    asyncHandler(async (req, res) => {
      const deleted = await deleteContact(req.params.id);
      res.json({ success: true, deleted });
    })
  );

  router.patch(
    '/contacts/:id',
    asyncHandler(async (req, res) => {
      const name = String(req.body?.name || req.body?.nama || '').trim();
      const phone = normalizePhone(req.body?.phone || req.body?.no_telp || req.body?.noTelp);
      if (!name || !phone) {
        throw badRequest('Nama dan No telp wajib diisi');
      }

      const updated = await updateContact(req.params.id, { name, phone });
      res.json({ success: true, updated, data: { id: req.params.id, name, phone } });
    })
  );

  router.post(
    '/broadcast',
    asyncHandler(async (req, res) => {
      const { session, message, delayMs = 1500 } = req.body || {};
      const delay = Math.min(Math.max(Number(delayMs) || 1500, 500), 10000);
      if (!session || !message) {
        throw badRequest('session dan message wajib diisi');
      }

      const contacts = await listContacts(100000);
      if (!contacts.length) {
        throw badRequest('Belum ada kontak yang diimport');
      }

      const results = [];
      for (const [index, contact] of contacts.entries()) {
        try {
          const rendered = renderMessage(message, contact);
          const sent = await manager.sendText({
            session,
            phone: contact.phone,
            message: rendered
          });
          results.push({
            contactId: contact.id,
            name: contact.name,
            phone: contact.phone,
            success: true,
            messageId: sent.messageId
          });
        } catch (error) {
          results.push({
            contactId: contact.id,
            name: contact.name,
            phone: contact.phone,
            success: false,
            error: error.message
          });
        }

        if (index < contacts.length - 1) {
          await wait(delay);
        }
      }

      res.json({
        success: true,
        total: contacts.length,
        sent: results.filter((item) => item.success).length,
        failed: results.filter((item) => !item.success).length,
        results
      });
    })
  );

  return router;
}
