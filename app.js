// MSN Classic Messenger - Web Client
const API = window.location.origin; // same host as backend when served by Express

let token = localStorage.getItem('msn_token');
let user = JSON.parse(localStorage.getItem('msn_user') || 'null');
let socket = null;
let contacts = [];
let currentContact = null;
let currentConvId = null;
let messages = {};
let isRegister = false;
let typingTimeout = null;

// ========== DOM ==========
const $ = (id) => document.getElementById(id);

const loginScreen = $('login-screen');
const appScreen = $('app-screen');
const emailInput = $('email');
const passInput = $('password');
const regName = $('reg-name');
const regFields = $('register-fields');
const btnSubmit = $('btn-submit');
const btnToggle = $('btn-toggle');
const loginError = $('login-error');

// ========== INIT ==========
if (token && user) {
  showApp();
  connectSocket();
  loadContacts();
} else {
  showLogin();
}

// ========== AUTH ==========
btnToggle.onclick = () => {
  isRegister = !isRegister;
  regFields.classList.toggle('hidden', !isRegister);
  btnSubmit.textContent = isRegister ? 'Criar conta' : 'Entrar';
  btnToggle.textContent = isRegister ? 'Já tem conta? Entrar' : 'Não tem conta? Criar agora';
  loginError.classList.add('hidden');
};

btnSubmit.onclick = async () => {
  const email = emailInput.value.trim();
  const password = passInput.value;
  if (!email || !password) return showError('Preencha e-mail e senha');

  btnSubmit.disabled = true;
  try {
    let res;
    if (isRegister) {
      const name = regName.value.trim();
      if (!name) return showError('Informe o nome de exibição');
      res = await fetch(`${API}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, display_name: name })
      });
    } else {
      res = await fetch(`${API}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
    }

    const data = await res.json();
    if (!res.ok) return showError(data.error || 'Erro');

    token = data.token;
    user = data.user;
    localStorage.setItem('msn_token', token);
    localStorage.setItem('msn_user', JSON.stringify(user));
    showApp();
    connectSocket();
    loadContacts();
  } catch (e) {
    showError('Não foi possível conectar ao servidor');
  } finally {
    btnSubmit.disabled = false;
  }
};

passInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnSubmit.click();
});

function showError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');
}

function showApp() {
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  updateMeUI();
}

function updateMeUI() {
  $('me-name').textContent = user.display_name || 'Eu';
  $('me-avatar').textContent = (user.display_name || '?')[0].toUpperCase();
  setStatusUI(user.status || 'online');
  const psm = user.personal_message || '';
  $('me-psm').textContent = psm || 'Clique para mensagem pessoal';
  $('me-psm').style.fontStyle = psm ? 'normal' : 'italic';
}

function setStatusUI(status) {
  const labels = { online: 'Online', busy: 'Ocupado', away: 'Ausente', invisible: 'Invisível', offline: 'Offline' };
  $('me-status-label').textContent = labels[status] || status;
  const dot = $('me-dot');
  dot.className = 'status-dot ' + (status === 'invisible' ? 'offline' : status);
  user.status = status;
}

// ========== SOCKET ==========
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io(API, { auth: { token } });

  socket.on('connect', () => console.log('Socket connected'));
  socket.on('disconnect', () => console.log('Socket disconnected'));

  socket.on('message:new', (msg) => {
    if (!messages[msg.conversation_id]) messages[msg.conversation_id] = [];
    if (!messages[msg.conversation_id].find(m => m.id === msg.id)) {
      messages[msg.conversation_id].push(msg);
      if (currentConvId === msg.conversation_id) {
        appendMessage(msg);
        scrollMessages();
      }
    }
  });

  socket.on('user:status', ({ userId, status }) => {
    const c = contacts.find(x => x.id === userId);
    if (c) {
      c.status = status;
      renderContacts();
      if (currentContact && currentContact.id === userId) {
        $('chat-status').textContent = statusLabel(status);
      }
    }
  });

  socket.on('typing:update', ({ conversation_id, display_name, is_typing }) => {
    if (conversation_id === currentConvId) {
      const bar = $('typing-bar');
      if (is_typing) {
        bar.textContent = `${display_name} está digitando...`;
        bar.classList.remove('hidden');
      } else {
        bar.classList.add('hidden');
      }
    }
  });

  socket.on('contact:request', () => loadContacts());
}

// ========== CONTACTS ==========
async function loadContacts() {
  try {
    const res = await fetch(`${API}/api/contacts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) return logout();
    contacts = await res.json();
    renderContacts();
  } catch (e) {
    console.error(e);
  }
}

function statusLabel(s) {
  return { online: 'Online', busy: 'Ocupado', away: 'Ausente', invisible: 'Offline', offline: 'Offline' }[s] || s;
}

function renderContacts() {
  const q = $('search').value.trim().toLowerCase();
  let list = contacts;
  if (q) {
    list = contacts.filter(c =>
      c.display_name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.personal_message || '').toLowerCase().includes(q)
    );
  }

  const groups = {
    pending: list.filter(c => c.relation_status === 'pending'),
    online: list.filter(c => c.status === 'online' && c.relation_status !== 'pending'),
    busy: list.filter(c => c.status === 'busy' && c.relation_status !== 'pending'),
    away: list.filter(c => c.status === 'away' && c.relation_status !== 'pending'),
    offline: list.filter(c => (c.status === 'offline' || c.status === 'invisible') && c.relation_status !== 'pending')
  };

  const container = $('contact-list');
  container.innerHTML = '';

  const addSection = (title, items, isPending = false) => {
    if (!items.length) return;
    const h = document.createElement('div');
    h.className = 'section-title';
    h.textContent = `${title} (${items.length})`;
    container.appendChild(h);

    items.forEach(c => {
      const el = document.createElement('div');
      el.className = 'contact-item' + (currentContact && currentContact.id === c.id ? ' active' : '');
      el.innerHTML = `
        <div class="avatar">
          ${(c.display_name || '?')[0].toUpperCase()}
          <span class="status-dot ${c.status === 'invisible' ? 'offline' : c.status}"></span>
        </div>
        <div class="contact-info">
          <div class="contact-name">${escapeHtml(c.display_name)}</div>
          <div class="contact-psm">${escapeHtml(c.personal_message || (isPending ? 'Aguardando aceitação' : statusLabel(c.status)))}</div>
        </div>
        ${isPending ? `<button class="btn-accept" data-id="${c.contact_relation_id}">Aceitar</button>` : ''}
      `;
      if (!isPending) {
        el.onclick = () => openChat(c);
      }
      const acceptBtn = el.querySelector('.btn-accept');
      if (acceptBtn) {
        acceptBtn.onclick = (e) => {
          e.stopPropagation();
          acceptContact(c.contact_relation_id);
        };
      }
      container.appendChild(el);
    });
  };

  addSection('Pendentes', groups.pending, true);
  addSection('Online', groups.online);
  addSection('Ocupado', groups.busy);
  addSection('Ausente', groups.away);
  addSection('Offline', groups.offline);

  if (!list.length) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:#81c784;font-size:13px;">Nenhum contato ainda.<br>Clique em ＋ para adicionar.</div>';
  }
}

$('search').oninput = () => renderContacts();

async function acceptContact(relationId) {
  await fetch(`${API}/api/contacts/${relationId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ status: 'accepted' })
  });
  loadContacts();
}

// ========== CHAT ==========
async function openChat(contact) {
  currentContact = contact;
  renderContacts();

  $('empty-chat').classList.add('hidden');
  $('active-chat').classList.remove('hidden');
  document.querySelector('.app-layout')?.classList.add('chat-open');

  $('chat-name').textContent = contact.display_name;
  $('chat-avatar').textContent = (contact.display_name || '?')[0].toUpperCase();
  $('chat-status').textContent = statusLabel(contact.status);

  // get/create conversation
  const res = await fetch(`${API}/api/conversations/with/${contact.id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  currentConvId = data.conversation_id;

  // load messages
  const msgRes = await fetch(`${API}/api/conversations/${currentConvId}/messages?limit=50`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  messages[currentConvId] = await msgRes.json();
  renderMessages();
  $('msg-input').focus();
}

function renderMessages() {
  const box = $('messages');
  box.innerHTML = '';
  const list = messages[currentConvId] || [];
  list.forEach(m => appendMessage(m));
  scrollMessages();
}

function appendMessage(msg) {
  const box = $('messages');
  const isMe = msg.sender_id === user.id;
  const el = document.createElement('div');
  el.className = 'msg ' + (isMe ? 'me' : 'other');
  const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `
    ${!isMe ? `<div class="msg-sender">${escapeHtml(msg.sender_name || '')}</div>` : ''}
    <div>${escapeHtml(msg.content)}</div>
    <div class="msg-time">${time}</div>
  `;
  box.appendChild(el);
}

function scrollMessages() {
  const box = $('messages');
  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const input = $('msg-input');
  const text = input.value.trim();
  if (!text || !currentConvId || !socket) return;

  socket.emit('message:send', {
    conversation_id: currentConvId,
    content: text,
    type: 'text'
  });
  input.value = '';
  stopTyping();
}

$('btn-send').onclick = sendMessage;
$('msg-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

$('msg-input').addEventListener('input', () => {
  if (!currentConvId || !socket) return;
  socket.emit('typing:start', { conversation_id: currentConvId });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 2000);
});

function stopTyping() {
  if (currentConvId && socket) {
    socket.emit('typing:stop', { conversation_id: currentConvId });
  }
}

// ========== STATUS / PSM / ADD ==========
$('me-status-line').onclick = () => {
  $('modal-overlay').classList.remove('hidden');
  $('modal-status').classList.remove('hidden');
  $('modal-add').classList.add('hidden');
  $('modal-psm').classList.add('hidden');
  $('modal-emoji').classList.add('hidden');
};

document.querySelectorAll('#modal-status button[data-status]').forEach(btn => {
  btn.onclick = () => {
    const status = btn.dataset.status;
    if (socket) socket.emit('status:set', status);
    // also update via API
    fetch(`${API}/api/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ status })
    }).then(() => {
      setStatusUI(status);
      closeModals();
    });
  };
});

$('btn-cancel-status').onclick = closeModals;

$('me-psm').onclick = () => {
  $('psm-input').value = user.personal_message || '';
  $('modal-overlay').classList.remove('hidden');
  $('modal-psm').classList.remove('hidden');
  $('modal-add').classList.add('hidden');
  $('modal-status').classList.add('hidden');
  $('modal-emoji').classList.add('hidden');
};

$('btn-save-psm').onclick = async () => {
  const psm = $('psm-input').value.trim();
  await fetch(`${API}/api/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ personal_message: psm })
  });
  user.personal_message = psm;
  localStorage.setItem('msn_user', JSON.stringify(user));
  updateMeUI();
  closeModals();
};

$('btn-cancel-psm').onclick = closeModals;

$('btn-add-contact').onclick = () => {
  $('add-email').value = '';
  $('modal-overlay').classList.remove('hidden');
  $('modal-add').classList.remove('hidden');
  $('modal-status').classList.add('hidden');
  $('modal-psm').classList.add('hidden');
  $('modal-emoji').classList.add('hidden');
};

$('btn-confirm-add').onclick = async () => {
  const email = $('add-email').value.trim();
  if (!email) return;
  const res = await fetch(`${API}/api/contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ email })
  });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'Erro');
  else {
    closeModals();
    loadContacts();
  }
};

$('btn-cancel-add').onclick = closeModals;

// Emoji
const emoticons = [':)', ';)', ':D', ':P', ':(', ':O', ':-)', ';-)', '♥', '★', '😂', '😍', '😎', '😢', '😡', '👍', '❤️', '🔥'];
$('btn-emoji').onclick = () => {
  const grid = $('emoji-grid');
  grid.innerHTML = '';
  emoticons.forEach(e => {
    const b = document.createElement('button');
    b.textContent = e;
    b.onclick = () => {
      $('msg-input').value += e;
      closeModals();
      $('msg-input').focus();
    };
    grid.appendChild(b);
  });
  $('modal-overlay').classList.remove('hidden');
  $('modal-emoji').classList.remove('hidden');
  $('modal-add').classList.add('hidden');
  $('modal-status').classList.add('hidden');
  $('modal-psm').classList.add('hidden');
};
$('btn-close-emoji').onclick = closeModals;

function closeModals() {
  $('modal-overlay').classList.add('hidden');
}

$('modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('modal-overlay')) closeModals();
});

// Logout
$('btn-logout').onclick = logout;

function logout() {
  if (socket) socket.disconnect();
  token = null;
  user = null;
  localStorage.removeItem('msn_token');
  localStorage.removeItem('msn_user');
  showLogin();
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
