export function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }

  return digits;
}

export function phoneToJid(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? `${normalized}@s.whatsapp.net` : '';
}

export function jidToPhone(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}
