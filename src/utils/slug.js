import { v4 as uuidv4 } from 'uuid';

export function sessionIdFromName(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug || `session-${uuidv4().slice(0, 8)}`;
}
