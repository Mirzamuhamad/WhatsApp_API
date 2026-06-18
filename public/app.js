const state = {
  apiKey: localStorage.getItem('wa_api_key') || '',
  token: localStorage.getItem('wa_jwt') || '',
  sessions: [],
  contactPage: 1,
  contactPageSize: '10',
  messagePage: 1,
  messagePageSize: '10',
  pendingRequests: 0
};

const socket = io();
const toast = new bootstrap.Toast(document.getElementById('appToast'));

const el = {
  socketState: document.getElementById('socketState'),
  sessionRows: document.getElementById('sessionRows'),
  sessionOptions: document.getElementById('sessionOptions'),
  messageRows: document.getElementById('messageRows'),
  contactRows: document.getElementById('contactRows'),
  webhookList: document.getElementById('webhookList'),
  qrImage: document.getElementById('qrImage'),
  qrEmpty: document.getElementById('qrEmpty'),
  activeQrSession: document.getElementById('activeQrSession'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  globalLoader: document.getElementById('globalLoader'),
  apiDetailTitle: document.getElementById('apiDetailTitle'),
  apiDetailList: document.getElementById('apiDetailList'),
  contactPageSize: document.getElementById('contactPageSize'),
  contactPageInfo: document.getElementById('contactPageInfo'),
  contactPrevPage: document.getElementById('contactPrevPage'),
  contactNextPage: document.getElementById('contactNextPage'),
  messagePageSize: document.getElementById('messagePageSize'),
  messagePageInfo: document.getElementById('messagePageInfo'),
  messagePrevPage: document.getElementById('messagePrevPage'),
  messageNextPage: document.getElementById('messageNextPage'),
  editContactId: document.getElementById('editContactId'),
  editContactName: document.getElementById('editContactName'),
  editContactPhone: document.getElementById('editContactPhone'),
  sessionCount: document.getElementById('sessionCount'),
  connectedCount: document.getElementById('connectedCount'),
  contactCount: document.getElementById('contactCount'),
  messageCount: document.getElementById('messageCount'),
  dashboardHero: document.getElementById('dashboardHero'),
  confirmModal: document.getElementById('confirmModal'),
  confirmModalTitle: document.getElementById('confirmModalTitle'),
  confirmModalMessage: document.getElementById('confirmModalMessage'),
  confirmModalConfirm: document.getElementById('confirmModalConfirm')
};

el.apiKeyInput.value = state.apiKey;
el.contactPageSize.value = state.contactPageSize;
el.messagePageSize.value = state.messagePageSize;

const viewLinks = document.querySelectorAll('[data-view-target]');
const dashboardViews = document.querySelectorAll('[data-dashboard-view]');

function showDashboardView(viewId) {
  dashboardViews.forEach((view) => {
    view.hidden = view.id !== viewId;
    view.classList.toggle('active', view.id === viewId);
  });
  viewLinks.forEach((link) => {
    link.classList.toggle('active', link.dataset.viewTarget === viewId);
  });
  el.dashboardHero.hidden = viewId !== 'dashboardView';

  const nav = document.getElementById('mainNav');
  const navCollapse = bootstrap.Collapse.getInstance(nav);
  navCollapse?.hide();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

viewLinks.forEach((link) => {
  link.addEventListener('click', () => showDashboardView(link.dataset.viewTarget));
});

function notify(message) {
  document.getElementById('toastBody').textContent = message;
  toast.show();
}

function confirmAction({ title, message, confirmLabel = 'Clear', confirmClass = 'btn-danger' }) {
  return new Promise((resolve) => {
    const modal = bootstrap.Modal.getOrCreateInstance(el.confirmModal);
    const confirmButton = el.confirmModalConfirm;
    const baseClasses = 'btn';

    el.confirmModalTitle.textContent = title;
    el.confirmModalMessage.textContent = message;
    confirmButton.textContent = confirmLabel;
    confirmButton.className = `${baseClasses} ${confirmClass}`;

    const cleanup = (result) => {
      confirmButton.removeEventListener('click', onConfirm);
      el.confirmModal.removeEventListener('hidden.bs.modal', onCancel);
      resolve(result);
    };

    const onConfirm = () => {
      modal.hide();
      cleanup(true);
    };

    const onCancel = () => cleanup(false);

    confirmButton.addEventListener('click', onConfirm, { once: true });
    el.confirmModal.addEventListener('hidden.bs.modal', onCancel, { once: true });
    modal.show();
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setGlobalLoading(isLoading) {
  state.pendingRequests += isLoading ? 1 : -1;
  state.pendingRequests = Math.max(0, state.pendingRequests);
  el.globalLoader.classList.toggle('d-none', state.pendingRequests === 0);
}

function setButtonLoading(button, isLoading, label = 'Loading...') {
  if (!button) return;

  if (isLoading) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>${label}`;
    return;
  }

  button.disabled = false;
  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
}

async function withButtonLoading(button, label, task) {
  setButtonLoading(button, true, label);
  try {
    return await task();
  } finally {
    setButtonLoading(button, false);
  }
}

function setRowsLoading(tbody, colspan, label = 'Loading...') {
  if (!tbody.children.length) {
    tbody.innerHTML = `<tr class="loading-row"><td colspan="${colspan}">${label}</td></tr>`;
  }
}

function paginationQuery(page, pageSize) {
  const params = new URLSearchParams();
  params.set('page', page);
  params.set('limit', pageSize);
  return params.toString();
}

function totalPages(total, pageSize) {
  if (pageSize === 'all') return 1;
  return Math.max(1, Math.ceil(total / Number(pageSize)));
}

function updatePager(kind, total, count) {
  const pageKey = `${kind}Page`;
  const pageSizeKey = `${kind}PageSize`;
  const page = state[pageKey];
  const pageSize = state[pageSizeKey];
  const info = el[`${kind}PageInfo`];
  const prev = el[`${kind}PrevPage`];
  const next = el[`${kind}NextPage`];

  if (pageSize === 'all') {
    info.textContent = `All ${total}`;
    prev.disabled = true;
    next.disabled = true;
    return;
  }

  const size = Number(pageSize);
  const pages = totalPages(total, pageSize);
  const start = total > 0 ? (page - 1) * size + 1 : 0;
  const end = total > 0 ? Math.min(start + count - 1, total) : 0;
  info.textContent = `${start}-${end} of ${total} | Page ${page}/${pages}`;
  prev.disabled = page <= 1;
  next.disabled = page >= pages;
}

function renderSessionOptions() {
  el.sessionOptions.innerHTML = state.sessions
    .map((session) => {
      const phone = session.phone_number ? ` | ${session.phone_number}` : '';
      const label = `${session.session_name} | ${session.status}${phone}`;
      return `<option value="${escapeHtml(session.id)}" label="${escapeHtml(label)}"></option>`;
    })
    .join('');
}

function authHeaders() {
  if (state.token) {
    return { Authorization: `Bearer ${state.token}` };
  }
  if (state.apiKey) {
    return { 'X-API-KEY': state.apiKey };
  }
  return {};
}

async function api(path, options = {}) {
  setGlobalLoading(true);
  try {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...authHeaders(),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || response.statusText);
    }
    return data;
  } finally {
    setGlobalLoading(false);
  }
}

async function downloadFile(path, filename) {
  setGlobalLoading(true);
  try {
    const response = await fetch(path, {
      headers: authHeaders()
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || response.statusText);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } finally {
    setGlobalLoading(false);
  }
}

function fmtDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function statusBadge(status) {
  return `<span class="status-dot status-${status}"></span>${status || '-'}`;
}

function apiKeyForExample() {
  return state.apiKey || 'isi-api-key-anda';
}

function buildApiExamples(sessionId) {
  const baseUrl = window.location.origin;
  const encodedSession = encodeURIComponent(sessionId);
  const encodedKey = encodeURIComponent(apiKeyForExample());
  const phone = '628123456789';
  const headers = `-H "X-API-KEY: ${apiKeyForExample()}"`;

  return [
    {
      title: 'Cek Status Session',
      badge: 'GET',
      command: `curl "${baseUrl}/api/session/${encodedSession}/status" ${headers}`
    },
    {
      title: 'Ambil QR Code',
      badge: 'GET',
      command: `curl "${baseUrl}/api/session/${encodedSession}/qrcode" ${headers}`
    },
    {
      title: 'Reconnect Session',
      badge: 'POST',
      command: `curl -X POST "${baseUrl}/api/session/${encodedSession}/reconnect" ${headers}`
    },
    {
      title: 'Kirim Text',
      badge: 'POST',
      command: `curl -X POST "${baseUrl}/api/send-message" \\\n  -H "Content-Type: application/json" \\\n  ${headers} \\\n  -d "{\\"session\\":\\"${sessionId}\\",\\"phone\\":\\"${phone}\\",\\"message\\":\\"Halo dari ${sessionId}\\"}"`
    },
    {
      title: 'Kirim Text Lewat URL',
      badge: 'GET',
      command: `${baseUrl}/api/url/send-message?apikey=${encodedKey}&session=${encodedSession}&phone=${phone}&message=${encodeURIComponent(`Halo dari ${sessionId}`)}`
    },
    {
      title: 'Kirim Foto Lewat Upload',
      badge: 'POST',
      command: `curl -X POST "${baseUrl}/api/send-media" \\\n  ${headers} \\\n  -F "session=${sessionId}" \\\n  -F "phone=${phone}" \\\n  -F "type=image" \\\n  -F "caption=Foto produk" \\\n  -F "file=@C:/path/to/foto.jpg"`
    },
    {
      title: 'Kirim Foto Lewat URL',
      badge: 'GET',
      command: `${baseUrl}/api/url/send-media?apikey=${encodedKey}&session=${encodedSession}&phone=${phone}&type=image&url=${encodeURIComponent('https://domain.com/foto.jpg')}&caption=${encodeURIComponent('Foto produk')}`
    },
    {
      title: 'Kirim Video Lewat URL',
      badge: 'GET',
      command: `${baseUrl}/api/url/send-media?apikey=${encodedKey}&session=${encodedSession}&phone=${phone}&type=video&url=${encodeURIComponent('https://domain.com/video.mp4')}&caption=${encodeURIComponent('Video produk')}`
    },
    {
      title: 'Kirim Dokumen Lewat URL',
      badge: 'GET',
      command: `${baseUrl}/api/url/send-media?apikey=${encodedKey}&session=${encodedSession}&phone=${phone}&type=document&url=${encodeURIComponent('https://domain.com/invoice.pdf')}&filename=invoice.pdf&mimetype=${encodeURIComponent('application/pdf')}`
    },
    {
      title: 'Import Kontak Excel',
      badge: 'POST',
      command: `curl -X POST "${baseUrl}/api/contacts/import" \\\n  ${headers} \\\n  -F "file=@C:/path/to/kontak.xlsx"`
    },
    {
      title: 'Export Kontak Excel',
      badge: 'GET',
      command: `curl "${baseUrl}/api/contacts/export" ${headers} --output wa-contacts.xlsx`
    },
    {
      title: 'Broadcast ke Semua Kontak',
      badge: 'POST',
      command: `curl -X POST "${baseUrl}/api/broadcast" \\\n  -H "Content-Type: application/json" \\\n  ${headers} \\\n  -d "{\\"session\\":\\"${sessionId}\\",\\"message\\":\\"Halo {nama}, ini pesan dari ${sessionId}\\",\\"delayMs\\":1500}"`
    },
    {
      title: 'Logout Session',
      badge: 'POST',
      command: `curl -X POST "${baseUrl}/api/logout" \\\n  -H "Content-Type: application/json" \\\n  ${headers} \\\n  -d "{\\"session\\":\\"${sessionId}\\"}"`
    },
    {
      title: 'Hapus Session',
      badge: 'DELETE',
      command: `curl -X DELETE "${baseUrl}/api/session/${encodedSession}" ${headers}`
    }
  ];
}

function showApiDetail(sessionId) {
  const examples = buildApiExamples(sessionId);
  el.apiDetailTitle.textContent = `API Detail: ${sessionId}`;
  el.apiDetailList.innerHTML = examples
    .map(
      (item, index) => `
        <div class="api-item">
          <div class="api-item-header">
            <div>
              <span class="badge text-bg-secondary me-2">${escapeHtml(item.badge)}</span>
              <span class="fw-semibold">${escapeHtml(item.title)}</span>
            </div>
            <button class="btn btn-outline-success btn-sm" type="button" data-action="copy-api" data-index="${index}">Copy</button>
          </div>
          <pre class="api-command"><code>${escapeHtml(item.command)}</code></pre>
        </div>
      `
    )
    .join('');
  el.apiDetailList.dataset.session = sessionId;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('apiDetailModal')).show();
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

async function login(apiKey) {
  setGlobalLoading(true);
  const data = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey })
  })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || response.statusText);
      return body;
    })
    .finally(() => setGlobalLoading(false));

  state.apiKey = apiKey;
  state.token = data.token;
  localStorage.setItem('wa_api_key', apiKey);
  localStorage.setItem('wa_jwt', data.token);
}

async function loadSessions() {
  setRowsLoading(el.sessionRows, 5, 'Loading sessions...');
  const { data } = await api('/api/sessions');
  state.sessions = data;
  el.sessionCount.textContent = data.length;
  el.connectedCount.textContent = data.filter((session) => session.status === 'connected').length;
  renderSessionOptions();
  el.sessionRows.innerHTML = data
    .map(
      (session) => `
        <tr>
          <td>
            <div class="fw-semibold">${session.session_name}</div>
            <div class="text-muted small">${session.id}</div>
          </td>
          <td>${session.phone_number || '-'}</td>
          <td>${statusBadge(session.status)}</td>
          <td>${fmtDate(session.last_activity || session.updated_at)}</td>
          <td class="text-end">
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary" data-action="api" data-id="${session.id}">API</button>
              <button class="btn btn-outline-success" data-action="qr" data-id="${session.id}">QR</button>
              <button class="btn btn-outline-secondary" data-action="reconnect" data-id="${session.id}">Reconnect</button>
              <button class="btn btn-outline-warning" data-action="logout" data-id="${session.id}">Logout</button>
              <button class="btn btn-outline-danger" data-action="delete" data-id="${session.id}">Delete</button>
            </div>
          </td>
        </tr>
      `
    )
    .join('');
}

async function loadMessages() {
  setRowsLoading(el.messageRows, 7, 'Loading message log...');
  const { data, total, page, perPage } = await api(
    `/api/messages?${paginationQuery(state.messagePage, state.messagePageSize)}`
  );
  el.messageCount.textContent = total || 0;
  state.messagePage = Number(page) || state.messagePage;
  state.messagePageSize = String(perPage || state.messagePageSize);

  if (total > 0 && data.length === 0 && state.messagePage > 1) {
    state.messagePage = totalPages(total, state.messagePageSize);
    await loadMessages();
    return;
  }

  el.messageRows.innerHTML = data.length
    ? data
    .map(
      (message) => `
        <tr>
          <td>${fmtDate(message.created_at)}</td>
          <td>${message.session_name || message.session_id}</td>
          <td>${message.direction}</td>
          <td>${message.phone}</td>
          <td class="message-cell">${message.message || message.media_type || '-'}</td>
          <td>${message.status}</td>
          <td class="text-end">
            <button class="btn btn-outline-danger btn-sm" data-action="delete-message" data-id="${message.id}">Delete</button>
          </td>
        </tr>
      `
    )
      .join('')
    : `<tr class="loading-row"><td colspan="7">Belum ada message log. Total: ${total || 0}</td></tr>`;
  updatePager('message', total || 0, data.length);
}

async function loadWebhooks() {
  if (!el.webhookList.children.length) {
    el.webhookList.innerHTML = '<div class="list-group-item text-muted">Loading...</div>';
  }
  const { data } = await api('/api/webhooks');
  el.webhookList.innerHTML =
    data
      .map(
        (webhook) => `
          <div class="list-group-item d-flex justify-content-between align-items-center gap-2">
            <div>
              <div>${webhook.url}</div>
              <div class="text-muted small">${webhook.status}</div>
            </div>
            <button class="btn btn-outline-danger btn-sm" data-action="delete-webhook" data-id="${webhook.id}">Delete</button>
          </div>
        `
      )
      .join('') || '<div class="list-group-item text-muted">-</div>';
}

async function loadContacts() {
  setRowsLoading(el.contactRows, 4, 'Loading contacts...');
  const { data, total, page, perPage } = await api(
    `/api/contacts?${paginationQuery(state.contactPage, state.contactPageSize)}`
  );
  el.contactCount.textContent = total || 0;
  state.contactPage = Number(page) || state.contactPage;
  state.contactPageSize = String(perPage || state.contactPageSize);

  if (total > 0 && data.length === 0 && state.contactPage > 1) {
    state.contactPage = totalPages(total, state.contactPageSize);
    await loadContacts();
    return;
  }

  el.contactRows.innerHTML =
    data.length
      ? data
      .map(
        (contact) => `
          <tr>
            <td>${escapeHtml(contact.name)}</td>
            <td>${escapeHtml(contact.phone)}</td>
            <td>${fmtDate(contact.updated_at || contact.created_at)}</td>
            <td class="text-end">
              <div class="btn-group btn-group-sm">
                <button
                  class="btn btn-outline-secondary"
                  data-action="edit-contact"
                  data-id="${contact.id}"
                  data-name="${escapeHtml(contact.name)}"
                  data-phone="${escapeHtml(contact.phone)}"
                >Edit</button>
                <button class="btn btn-outline-danger" data-action="delete-contact" data-id="${contact.id}">Delete</button>
              </div>
            </td>
        </tr>
      `
      )
        .join('')
      : `<tr class="loading-row"><td colspan="4">Belum ada kontak. Total: ${total || 0}</td></tr>`;
  updatePager('contact', total || 0, data.length);
}

async function showQr(sessionId) {
  const data = await api(`/api/session/${sessionId}/qrcode`);
  el.activeQrSession.textContent = sessionId;
  if (data.qrcode) {
    el.qrImage.src = data.qrcode;
    el.qrImage.classList.remove('d-none');
    el.qrEmpty.classList.add('d-none');
  } else {
    el.qrImage.classList.add('d-none');
    el.qrEmpty.classList.remove('d-none');
    el.qrEmpty.textContent = data.status === 'connected' ? 'Connected' : 'Menunggu QR...';
  }
}

async function boot() {
  if (!state.apiKey && !state.token) {
    notify('Isi API key dari tombol Auth.');
    return;
  }
  await Promise.all([loadSessions(), loadMessages(), loadWebhooks(), loadContacts()]);
}

document.getElementById('authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  try {
    await withButtonLoading(submitButton, 'Saving...', async () => {
      await login(el.apiKeyInput.value.trim());
      bootstrap.Modal.getInstance(document.getElementById('authModal'))?.hide();
      notify('Auth tersimpan.');
      await boot();
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('createSessionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  const sessionName = document.getElementById('sessionName').value.trim();
  try {
    await withButtonLoading(submitButton, 'Creating...', async () => {
      const data = await api('/api/session', {
        method: 'POST',
        body: JSON.stringify({ session_name: sessionName })
      });
      document.getElementById('sessionName').value = '';
      notify(`Session dibuat: ${data.sessionId}`);
      await loadSessions();
      await showQr(data.sessionId);
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('sendMessageForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  try {
    await withButtonLoading(submitButton, 'Sending...', async () => {
      const data = await api('/api/send-message', {
        method: 'POST',
        body: JSON.stringify({
          session: document.getElementById('sendSession').value.trim(),
          phone: document.getElementById('sendPhone').value.trim(),
          message: document.getElementById('sendText').value
        })
      });
      notify(`Message sent: ${data.messageId || '-'}`);
      state.messagePage = 1;
      await loadMessages();
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('webhookForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  try {
    await withButtonLoading(submitButton, 'Adding...', async () => {
      await api('/api/webhooks', {
        method: 'POST',
        body: JSON.stringify({ url: document.getElementById('webhookUrl').value.trim() })
      });
      document.getElementById('webhookUrl').value = '';
      await loadWebhooks();
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('sessionRows').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === 'api') {
    showApiDetail(id);
    return;
  }
  try {
    await withButtonLoading(button, 'Wait...', async () => {
      if (action === 'qr') await showQr(id);
      if (action === 'reconnect') await api(`/api/session/${id}/reconnect`, { method: 'POST' });
      if (action === 'logout') await api('/api/logout', { method: 'POST', body: JSON.stringify({ session: id }) });
      if (action === 'delete') await api(`/api/session/${id}`, { method: 'DELETE' });
      await loadSessions();
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('apiDetailList').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="copy-api"]');
  if (!button) return;

  const sessionId = el.apiDetailList.dataset.session;
  const item = buildApiExamples(sessionId)[Number(button.dataset.index)];
  if (!item) return;

  try {
    await withButtonLoading(button, 'Copied', async () => {
      await copyText(item.command);
      notify('API berhasil disalin.');
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('webhookList').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="delete-webhook"]');
  if (!button) return;
  try {
    await withButtonLoading(button, 'Deleting...', async () => {
      await api(`/api/webhooks/${button.dataset.id}`, { method: 'DELETE' });
      await loadWebhooks();
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('manualContactForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  try {
    await withButtonLoading(submitButton, 'Adding...', async () => {
      const data = await api('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('manualContactName').value.trim(),
          phone: document.getElementById('manualContactPhone').value.trim()
        })
      });
      document.getElementById('manualContactName').value = '';
      document.getElementById('manualContactPhone').value = '';
      notify(`Kontak tersimpan: ${data.data.name}`);
      state.contactPage = 1;
      await loadContacts();
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('contactEditForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  try {
    await withButtonLoading(submitButton, 'Saving...', async () => {
      const data = await api(`/api/contacts/${el.editContactId.value}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: el.editContactName.value.trim(),
          phone: el.editContactPhone.value.trim()
        })
      });
      bootstrap.Modal.getInstance(document.getElementById('contactEditModal'))?.hide();
      notify(`Kontak diupdate: ${data.data.name}`);
      await loadContacts();
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('importContactsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  const file = document.getElementById('contactFile').files[0];
  if (!file) {
    notify('Pilih file Excel terlebih dahulu.');
    return;
  }

  try {
    await withButtonLoading(submitButton, 'Importing...', async () => {
      const formData = new FormData();
      formData.append('file', file);
      const data = await api('/api/contacts/import', {
        method: 'POST',
        body: formData
      });
      document.getElementById('contactFile').value = '';
      notify(`Import selesai: ${data.imported} kontak, skip ${data.skipped}.`);
      state.contactPage = 1;
      await loadContacts();
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('broadcastForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  try {
    await withButtonLoading(submitButton, 'Broadcasting...', async () => {
      const data = await api('/api/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          session: document.getElementById('broadcastSession').value.trim(),
          message: document.getElementById('broadcastMessage').value,
          delayMs: document.getElementById('broadcastDelay').value
        })
      });
      notify(`Broadcast selesai: ${data.sent} sukses, ${data.failed} gagal.`);
      state.messagePage = 1;
      await loadMessages();
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('contactRows').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'edit-contact') {
    el.editContactId.value = button.dataset.id;
    el.editContactName.value = button.dataset.name || '';
    el.editContactPhone.value = button.dataset.phone || '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('contactEditModal')).show();
    return;
  }

  if (button.dataset.action !== 'delete-contact') return;

  try {
    await withButtonLoading(button, 'Deleting...', async () => {
      const data = await api(`/api/contacts/${button.dataset.id}`, { method: 'DELETE' });
      notify(`Kontak terhapus: ${data.deleted}`);
      await loadContacts();
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('refreshSessions').addEventListener('click', (event) => {
  withButtonLoading(event.currentTarget, 'Loading...', loadSessions).catch((error) => notify(error.message));
});
document.getElementById('refreshMessages').addEventListener('click', (event) => {
  withButtonLoading(event.currentTarget, 'Loading...', loadMessages).catch((error) => notify(error.message));
});
document.getElementById('refreshContacts').addEventListener('click', (event) => {
  withButtonLoading(event.currentTarget, 'Loading...', loadContacts).catch((error) => notify(error.message));
});
el.messagePageSize.addEventListener('change', () => {
  state.messagePageSize = el.messagePageSize.value;
  state.messagePage = 1;
  loadMessages().catch((error) => notify(error.message));
});
el.messagePrevPage.addEventListener('click', () => {
  state.messagePage = Math.max(1, state.messagePage - 1);
  loadMessages().catch((error) => notify(error.message));
});
el.messageNextPage.addEventListener('click', () => {
  state.messagePage += 1;
  loadMessages().catch((error) => notify(error.message));
});
el.contactPageSize.addEventListener('change', () => {
  state.contactPageSize = el.contactPageSize.value;
  state.contactPage = 1;
  loadContacts().catch((error) => notify(error.message));
});
el.contactPrevPage.addEventListener('click', () => {
  state.contactPage = Math.max(1, state.contactPage - 1);
  loadContacts().catch((error) => notify(error.message));
});
el.contactNextPage.addEventListener('click', () => {
  state.contactPage += 1;
  loadContacts().catch((error) => notify(error.message));
});
document.getElementById('downloadContactTemplate').addEventListener('click', (event) => {
  withButtonLoading(event.currentTarget, 'Loading...', () =>
    downloadFile('/api/contacts/template', 'template-kontak-wa.xlsx')
  ).catch((error) => notify(error.message));
});
document.getElementById('exportContacts').addEventListener('click', (event) => {
  withButtonLoading(event.currentTarget, 'Loading...', () =>
    downloadFile('/api/contacts/export', 'wa-contacts.xlsx')
  ).catch((error) => notify(error.message));
});
document.getElementById('clearContacts').addEventListener('click', async () => {
  const confirmed = await confirmAction({
    title: 'Clear Contacts',
    message: 'Hapus semua kontak? Data kontak yang sudah dihapus tidak bisa dikembalikan dari dashboard.',
    confirmLabel: 'Clear Contacts'
  });
  if (!confirmed) return;
  const button = document.getElementById('clearContacts');
  try {
    await withButtonLoading(button, 'Clearing...', async () => {
      const data = await api('/api/contacts', { method: 'DELETE' });
      notify(`Kontak terhapus: ${data.deleted}`);
      state.contactPage = 1;
      await loadContacts();
    });
  } catch (error) {
    notify(error.message);
  }
});
document.getElementById('clearMessages').addEventListener('click', async () => {
  const confirmed = await confirmAction({
    title: 'Clear Message Log',
    message: 'Hapus semua message log? Riwayat log yang sudah dihapus tidak bisa dikembalikan dari dashboard.',
    confirmLabel: 'Clear Log'
  });
  if (!confirmed) return;
  const button = document.getElementById('clearMessages');
  try {
    await withButtonLoading(button, 'Clearing...', async () => {
      const data = await api('/api/messages', { method: 'DELETE' });
      notify(`Log terhapus: ${data.deleted}`);
      state.messagePage = 1;
      await loadMessages();
    });
  } catch (error) {
    notify(error.message);
  }
});

document.getElementById('messageRows').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="delete-message"]');
  if (!button) return;
  try {
    await withButtonLoading(button, 'Deleting...', async () => {
      const data = await api(`/api/messages/${button.dataset.id}`, { method: 'DELETE' });
      notify(`Log terhapus: ${data.deleted}`);
      await loadMessages();
    });
  } catch (error) {
    notify(error.message);
  }
});

socket.on('connect', () => {
  el.socketState.className = 'badge text-bg-success';
  el.socketState.textContent = 'online';
});

socket.on('disconnect', () => {
  el.socketState.className = 'badge text-bg-secondary';
  el.socketState.textContent = 'offline';
});

socket.on('qr', ({ session, qrcode }) => {
  if (el.activeQrSession.textContent === session) {
    el.qrImage.src = qrcode;
    el.qrImage.classList.remove('d-none');
    el.qrEmpty.classList.add('d-none');
  }
  loadSessions().catch(() => {});
});

socket.on('connected', ({ session }) => {
  if (el.activeQrSession.textContent === session) {
    el.qrImage.classList.add('d-none');
    el.qrEmpty.classList.remove('d-none');
    el.qrEmpty.textContent = 'Connected';
  }
  loadSessions().catch(() => {});
});

['disconnected', 'status_changed'].forEach((eventName) => {
  socket.on(eventName, () => loadSessions().catch(() => {}));
});

['message_received', 'message_sent'].forEach((eventName) => {
  socket.on(eventName, () => loadMessages().catch(() => {}));
});

boot().catch((error) => notify(error.message));
