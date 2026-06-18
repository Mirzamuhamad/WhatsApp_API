import { db } from './database.js';

function listOptions(options, fallbackLimit) {
  if (typeof options === 'number') {
    return { limit: options, offset: 0 };
  }

  return {
    limit: options?.limit ?? fallbackLimit,
    offset: options?.offset ?? 0
  };
}

function paginationClause(limit, offset) {
  const parsedLimit = Number.parseInt(limit, 10);
  const parsedOffset = Number.parseInt(offset, 10);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 1000;
  const safeOffset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;
  return ` LIMIT ${safeLimit} OFFSET ${safeOffset}`;
}

export async function listSessions() {
  const [rows] = await db().query(
    `SELECT id, session_name, phone_number, status, last_activity, created_at, updated_at
     FROM tbl_sessions
     ORDER BY created_at DESC`
  );
  return rows;
}

export async function findSession(identifier) {
  const [rows] = await db().execute(
    `SELECT id, session_name, phone_number, status, last_activity, created_at, updated_at
     FROM tbl_sessions
     WHERE id = ? OR session_name = ?
     LIMIT 1`,
    [identifier, identifier]
  );
  return rows[0] || null;
}

export async function createSessionRecord({ id, sessionName, status = 'connecting' }) {
  await db().execute(
    `INSERT INTO tbl_sessions (id, session_name, status, created_at, updated_at)
     VALUES (?, ?, ?, NOW(), NOW())`,
    [id, sessionName, status]
  );
  return findSession(id);
}

export async function updateSessionStatus(id, status, phoneNumber = null) {
  await db().execute(
    `UPDATE tbl_sessions
     SET status = ?, phone_number = COALESCE(?, phone_number), last_activity = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [status, phoneNumber, id]
  );
}

export async function deleteSessionRecord(id) {
  await db().execute('DELETE FROM tbl_sessions WHERE id = ?', [id]);
}

export async function insertMessage({
  messageId = null,
  sessionId,
  direction,
  phone,
  message = null,
  mediaPath = null,
  mediaType = null,
  status = 'received'
}) {
  const [result] = await db().execute(
    `INSERT INTO tbl_messages
      (message_id, session_id, direction, phone, message, media_path, media_type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [messageId, sessionId, direction, phone, message, mediaPath, mediaType, status]
  );

  return result.insertId;
}

export async function listMessages(options = 100) {
  const { limit, offset } = listOptions(options, 100);
  const query = `SELECT m.id, m.message_id, m.session_id, s.session_name, m.direction, m.phone, m.message,
                       m.media_path, m.media_type, m.status, m.created_at
                FROM tbl_messages m
                JOIN tbl_sessions s ON s.id = m.session_id
                ORDER BY m.created_at DESC`;

  const [rows] =
    limit === null
      ? await db().query(query)
      : await db().query(`${query}${paginationClause(limit, offset)}`);
  return rows;
}

export async function countMessages() {
  const [rows] = await db().query('SELECT COUNT(*) AS total FROM tbl_messages');
  return Number(rows[0]?.total || 0);
}

export async function deleteMessage(id) {
  const [result] = await db().execute('DELETE FROM tbl_messages WHERE id = ?', [id]);
  return result.affectedRows;
}

export async function clearMessages(sessionId = null) {
  if (sessionId) {
    const [result] = await db().execute('DELETE FROM tbl_messages WHERE session_id = ?', [sessionId]);
    return result.affectedRows;
  }

  const [result] = await db().query('DELETE FROM tbl_messages');
  return result.affectedRows;
}

export async function listContacts(options = 1000) {
  const { limit, offset } = listOptions(options, 1000);
  const query = `SELECT id, name, phone, created_at, updated_at
                 FROM tbl_contacts
                 ORDER BY name ASC, id ASC`;

  const [rows] =
    limit === null
      ? await db().query(query)
      : await db().query(`${query}${paginationClause(limit, offset)}`);
  return rows;
}

export async function countContacts() {
  const [rows] = await db().query('SELECT COUNT(*) AS total FROM tbl_contacts');
  return Number(rows[0]?.total || 0);
}

export async function upsertContacts(contacts) {
  if (!contacts.length) {
    return 0;
  }

  const values = contacts.map((contact) => [contact.name, contact.phone]);
  const placeholders = values.map(() => '(?, ?, NOW(), NOW())').join(', ');
  const params = values.flat();
  const [result] = await db().execute(
    `INSERT INTO tbl_contacts (name, phone, created_at, updated_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = NOW()`,
    params
  );
  return result.affectedRows;
}

export async function createContact({ name, phone }) {
  const [result] = await db().execute(
    `INSERT INTO tbl_contacts (name, phone, created_at, updated_at)
     VALUES (?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = NOW()`,
    [name, phone]
  );
  return result.affectedRows;
}

export async function updateContact(id, { name, phone }) {
  const [result] = await db().execute(
    `UPDATE tbl_contacts
     SET name = ?, phone = ?, updated_at = NOW()
     WHERE id = ?`,
    [name, phone, id]
  );
  return result.affectedRows;
}

export async function deleteContact(id) {
  const [result] = await db().execute('DELETE FROM tbl_contacts WHERE id = ?', [id]);
  return result.affectedRows;
}

export async function clearContacts() {
  const [result] = await db().query('DELETE FROM tbl_contacts');
  return result.affectedRows;
}

export async function listWebhooks() {
  const [rows] = await db().query(
    `SELECT id, url, status, events, created_at, updated_at
     FROM tbl_webhooks
     ORDER BY created_at DESC`
  );
  return rows.map((row) => ({
    ...row,
    events: typeof row.events === 'string' ? JSON.parse(row.events || '[]') : row.events
  }));
}

export async function createWebhook({ url, events = ['message_received'] }) {
  const [result] = await db().execute(
    `INSERT INTO tbl_webhooks (url, status, events, created_at, updated_at)
     VALUES (?, 'active', ?, NOW(), NOW())`,
    [url, JSON.stringify(events)]
  );
  return result.insertId;
}

export async function updateWebhook(id, { url, status, events }) {
  await db().execute(
    `UPDATE tbl_webhooks
     SET url = COALESCE(?, url),
         status = COALESCE(?, status),
         events = COALESCE(?, events),
         updated_at = NOW()
     WHERE id = ?`,
    [url || null, status || null, events ? JSON.stringify(events) : null, id]
  );
}

export async function deleteWebhook(id) {
  await db().execute('DELETE FROM tbl_webhooks WHERE id = ?', [id]);
}
