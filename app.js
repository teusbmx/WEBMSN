// WEB MSN - Web Client (classic style + notifications + nudge)
// API do backend (Render em produção; local usa o mesmo origin)
(function () {
  const fromConfig = (typeof window !== 'undefined' && window.WEB_MSN_API)
    ? String(window.WEB_MSN_API).replace(/\/$/, '')
    : '';
  const host = (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
  // Produção (Netlify/Vercel): backend no Render
  window.__WEB_MSN_API__ = fromConfig || (isLocal ? window.location.origin : 'https://webmsn.onrender.com');
})();
const API = window.__WEB_MSN_API__;
window.API = API;
window.__WEB_MSN_API__ = API;


let token = localStorage.getItem('msn_token');
let user = JSON.parse(localStorage.getItem('msn_user') || 'null');
let socket = null;
let contacts = [];
let currentContact = null;
let currentConvId = null;
let messages = {};
let isRegister = false;
let typingTimeout = null;
let lastNudgeAt = 0;
const NUDGE_COOLDOWN_MS = 8000; // anti-spam CHAMAR ATENÇÃO
let soundEnabled = localStorage.getItem('msn_sound') !== '0';
let unreadByConv = JSON.parse(localStorage.getItem('msn_unread') || '{}');
let unreadByContact = JSON.parse(localStorage.getItem('msn_unread_contact') || '{}');

let deferredInstallPrompt = null;
let pushSubscribed = false;

let originalTitle = document.title;
let titleFlashInterval = null;
let audioCtx = null;


const $ = (id) => document.getElementById(id);

// Navegadores bloqueiam autoplay até interação do usuário
function unlockAudio() {
  try {
    [msnSound, nudgeSound].forEach((a) => {
      a.muted = true;
      a.play().then(() => {
        a.pause();
        a.currentTime = 0;
        a.muted = false;
      }).catch(() => {});
    });
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) {}
  document.removeEventListener('click', unlockAudio);
  document.removeEventListener('keydown', unlockAudio);
}
document.addEventListener('click', unlockAudio);
document.addEventListener('keydown', unlockAudio);


// ========== SOUNDS (uma reprodução por clique, sem loop) ==========
const msnSound = new Audio((window.WEB_MSN_SOUND_MSG || 'msn-message.mp3'));
msnSound.preload = 'auto';
msnSound.volume = 0.75;
msnSound.loop = false;

const nudgeSound = new Audio((window.WEB_MSN_SOUND_NUDGE || 'msn-nudge.mp3'));
nudgeSound.preload = 'auto';
nudgeSound.volume = 0.8;
nudgeSound.loop = false;

/** Toca um áudio uma única vez (para qualquer clique anterior e reinicia) */
function playOnce(audio) {
  if (!soundEnabled) return;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.loop = false;
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {}
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('msn_sound', soundEnabled ? '1' : '0');
  const btn = $('btn-sound');
  if (btn) {
    btn.textContent = soundEnabled ? '🔊' : '🔇';
    btn.title = soundEnabled ? 'Sons ligados' : 'Sons desligados';
  }
  showToast('Sons', soundEnabled ? 'Alertas sonoros ativados' : 'Alertas sonoros desativados');
}

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', vol = 0.15) {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (_) {}
}

function soundMessage() {
  playOnce(msnSound);
}

function soundNudge() {
  playOnce(nudgeSound);
}

function soundLogin() {
  playTone(523, 0.1, 'sine', 0.1);
  setTimeout(() => playTone(659, 0.12, 'sine', 0.1), 100);
  setTimeout(() => playTone(784, 0.18, 'sine', 0.12), 220);
}

// ========== NOTIFICAÇÕES ==========
function showToast(title, body, onClick) {
  const container = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div><div class="toast-body">${escapeHtml(body)}</div>`;
  el.onclick = () => {
    el.remove();
    if (onClick) onClick();
  };
  container.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function flashTitle(text) {
  stopFlashTitle();
  let show = true;
  titleFlashInterval = setInterval(() => {
    document.title = show ? text : originalTitle;
    show = !show;
  }, 800);
}

function stopFlashTitle() {
  if (titleFlashInterval) {
    clearInterval(titleFlashInterval);
    titleFlashInterval = null;
  }
  document.title = originalTitle;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) stopFlashTitle();
});

window.addEventListener('focus', stopFlashTitle);

// Desktop Notification API
async function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function desktopNotify(title, body) {
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification(title, { body, icon: undefined });
    } catch (_) {}
  }
}

// ========== INIT ==========
if (token && user) {
  showApp();
  connectSocket();
  loadContacts();
  requestNotifPermission();
} else {
  showLogin();
}

// ========== AUTH ==========
$('btn-toggle').onclick = () => {
  isRegister = !isRegister;
  $('register-fields').classList.toggle('hidden', !isRegister);
  $('btn-submit').textContent = isRegister ? 'Criar conta' : 'Entrar';
  $('btn-toggle').textContent = isRegister ? 'Já tem conta? Entrar' : 'Não tem conta? Criar agora';
  $('login-error').classList.add('hidden');
};

$('btn-submit').onclick = async () => {
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) return showError('Preencha e-mail e senha');

  $('btn-submit').disabled = true;
  $('btn-submit').classList.add('loading');
  try {
    let res;
    if (isRegister) {
      const name = $('reg-name').value.trim();
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
    window.token = token;
    window.user = user;
    localStorage.setItem('msn_token', token);
    localStorage.setItem('msn_user', JSON.stringify(user));

    const st = $('login-status').value;
    showApp();
    connectSocket();
    loadContacts();
    requestNotifPermission();
    soundLogin();

    // set initial status
    setTimeout(() => {
      if (socket) socket.emit('status:set', st);
      fetch(`${API}/api/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: st })
      }).then(() => setStatusUI(st));
    }, 400);
  } catch (e) {
    showError('Não foi possível conectar ao servidor');
  } finally {
    $('btn-submit').disabled = false;
    $('btn-submit').classList.remove('loading');
  }
};

$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-submit').click(); });

function showError(msg) {
  $('login-error').textContent = msg;
  $('login-error').classList.remove('hidden');
}
function showLogin() {
  $('login-screen').classList.remove('hidden');
  $('app-screen').classList.add('hidden');
}
function showApp() {
  $('login-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');
  updateMeUI();
  window.token = token;
  window.user = user;
  if (window.WebMsnPWA) WebMsnPWA.updateUnreadBadge();
  try {
    const params = new URLSearchParams(window.location.search);
    const chatId = params.get('chat');
    if (chatId) {
      setTimeout(() => {
        loadContacts().then(() => {
          window.contacts = contacts;
          const c = contacts.find((x) => x.id === chatId);
          if (c) openChat(c);
        });
      }, 400);
    }
  } catch (_) {}
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
  $('me-dot').className = 'status-dot ' + (status === 'invisible' ? 'offline' : status);
  user.status = status;
}

// ========== SOCKET ==========
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io(API, { auth: { token } });

  socket.on('connect', () => {
    console.log('Socket connected');
    const bar = $('conn-bar');
    if (bar) bar.classList.add('hidden');
    window.token = token;
    window.contacts = contacts;
    window.openChat = openChat;
    window.loadContacts = loadContacts;
    window.showToast = showToast;
    if (window.WebMsnPWA) WebMsnPWA.ensurePushSubscription(false);
  });
  socket.on('disconnect', () => {
    console.log('Socket disconnected');
    const bar = $('conn-bar');
    if (bar) {
      bar.textContent = 'Reconectando ao servidor…';
      bar.classList.remove('hidden');
      bar.classList.remove('offline');
    }
  });
  socket.on('connect_error', () => {
    const bar = $('conn-bar');
    if (bar) {
      bar.textContent = 'Sem conexão com o servidor';
      bar.classList.remove('hidden');
      bar.classList.add('offline');
    }
  });

  socket.on('message:new', (msg) => {
    if (!messages[msg.conversation_id]) messages[msg.conversation_id] = [];
    if (messages[msg.conversation_id].find(m => m.id === msg.id)) return;
    messages[msg.conversation_id].push(msg);

    const isMe = msg.sender_id === user.id;
    const isCurrent = currentConvId === msg.conversation_id;

    if (isCurrent) {
      appendMessage(msg);
      scrollMessages();
    }

    if (!isMe) {
      bumpUnreadForMessage(msg);
      soundMessage();
      const name = msg.sender_name || 'Alguém';
      showToast(name, msg.type === 'nudge' ? '⚡ chamou sua atenção!' : msg.content, () => {
        const c = contacts.find(x => x.id === msg.sender_id);
        if (c) openChat(c);
      });
      if (document.hidden || !isCurrent) {
        flashTitle(`${name} disse...`);
        desktopNotify(name, msg.type === 'nudge' ? 'chamou sua atenção!' : msg.content);
      }
      if (msg.type === 'nudge') {
        soundNudge();
        document.body.classList.remove('shake');
        void document.body.offsetWidth;
        document.body.classList.add('shake');
        setTimeout(() => document.body.classList.remove('shake'), 600);
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

  socket.on('contact:request', (data) => {
    soundMessage();
    const name = (data && data.display_name) || 'Alguém';
    const fromId = data && data.from;
    // Mostra na lista imediatamente (não depende só do GET)
    if (fromId) {
      const already = contacts.find(
        c => c.id === fromId && (c.relation_status === 'incoming' || c.status === 'incoming')
      );
      if (!already) {
        contacts.unshift({
          id: fromId,
          display_name: name,
          email: data.email || '',
          relation_status: 'incoming',
          contact_relation_id: data.relation_id || ('temp-' + fromId),
          status: 'offline',
          personal_message: 'Quer ser seu contato'
        });
        window.contacts = contacts;
        renderContacts();
      }
    }
    showToast('Solicitação de amizade', name + ' quer adicionar você', () => {
      // Foca a lista / scroll para solicitações
      const list = $('contact-list');
      if (list) list.scrollTop = 0;
    });
    // Confirma com o servidor
    loadContacts();
  });
  socket.on('contact:updated', () => {
    loadContacts();
  });
}

// Atualiza lista periodicamente (convites offline / multi-aba)
setInterval(() => {
  if (token && !$('app-screen').classList.contains('hidden')) {
    loadContacts();
  }
}, 15000);


// ========== CONTACTS ==========
async function loadContacts() {
  try {
    if (!token) return;
    const res = await fetch(`${API}/api/contacts`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) return logout();
    const data = await res.json();
    contacts = Array.isArray(data) ? data : [];
    window.contacts = contacts;
    renderContacts();
  } catch (e) { console.error(e); }
}

function statusLabel(s) {
  return { online: 'Online', busy: 'Ocupado', away: 'Ausente', invisible: 'Offline', offline: 'Offline' }[s] || s;
}

// Ícone bonequinho clássico do MSN/WLM (SVG inline)
function buddyIcon(status) {
  const colors = {
    online: '#3D9B3D',
    busy: '#C0392B',
    away: '#E67E22',
    offline: '#9E9E9E',
    invisible: '#9E9E9E'
  };
  const c = colors[status] || colors.offline;
  // Silhueta de pessoa estilo MSN (cabeça + corpo)
  return `<svg class="buddy-svg" viewBox="0 0 16 16" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="4.2" r="3.1" fill="${c}"/>
    <path d="M2.2 14.5c0-3.4 2.6-5.5 5.8-5.5s5.8 2.1 5.8 5.5" fill="${c}"/>
  </svg>`;
}

function formatPsm(text, isPending, status) {
  if (isPending) return 'Aguardando aceitação';
  if (!text) return statusLabel(status);
  // Detecta menção a música e adiciona nota
  const musicHint = /♪|♫|music|ouindo|listening|tocando|spotify|youtube/i.test(text);
  const note = musicHint || text.includes(' - ') ? ' <span class="music-note">♪</span> ' : '';
  return note + escapeHtml(text);
}


function saveUnreadAll() {
  try {
    localStorage.setItem('msn_unread', JSON.stringify(unreadByConv));
    localStorage.setItem('msn_unread_contact', JSON.stringify(unreadByContact));
  } catch (_) {}
  updateTotalUnreadBadge();
  if (window.WebMsnPWA && WebMsnPWA.updateUnreadBadge) WebMsnPWA.updateUnreadBadge();
}

function updateTotalUnreadBadge() {
  const el = $('unread-total');
  const n = Object.values(unreadByContact).reduce((a, b) => a + (Number(b) || 0), 0);
  if (el) {
    if (n > 0) {
      el.textContent = n > 99 ? '99+' : String(n);
      el.classList.remove('hidden');
    } else el.classList.add('hidden');
  }
  try {
    document.title = n > 0 ? '(' + n + ') WEB MSN' : 'WEB MSN';
  } catch (_) {}
}

function bumpUnreadForMessage(msg) {
  if (!msg || msg.sender_id === (user && user.id)) return;
  // Se a conversa está aberta e visível, não conta
  if (currentConvId === msg.conversation_id && !document.hidden) return;
  const convId = msg.conversation_id;
  const contactId = msg.sender_id;
  if (convId) unreadByConv[convId] = (unreadByConv[convId] || 0) + 1;
  if (contactId) unreadByContact[contactId] = (unreadByContact[contactId] || 0) + 1;
  saveUnreadAll();
  renderContacts(); // badge ao lado do nome
}

function clearUnreadForContact(contactId, conversationId) {
  if (contactId && unreadByContact[contactId]) {
    delete unreadByContact[contactId];
  }
  if (conversationId && unreadByConv[conversationId]) {
    delete unreadByConv[conversationId];
  }
  saveUnreadAll();
  if (window.WebMsnPWA) {
    try { WebMsnPWA.clearUnread(conversationId); } catch (_) {}
  }
}

function unreadCountForContact(contactId) {
  return Number(unreadByContact[contactId] || 0);
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

  const rel = (c) => (c.relation_status || c.status || '').toLowerCase();
  const groups = {
    incoming: list.filter(c => rel(c) === 'incoming'),
    pending: list.filter(c => rel(c) === 'pending'),
    online: list.filter(c => c.status === 'online' && rel(c) !== 'pending' && rel(c) !== 'incoming'),
    busy: list.filter(c => c.status === 'busy' && rel(c) !== 'pending' && rel(c) !== 'incoming'),
    away: list.filter(c => c.status === 'away' && rel(c) !== 'pending' && rel(c) !== 'incoming'),
    offline: list.filter(c => (c.status === 'offline' || c.status === 'invisible') && rel(c) !== 'pending' && rel(c) !== 'incoming')
  };

  const container = $('contact-list');
  container.innerHTML = '';

  const addSection = (title, items, isIncoming = false, isOutgoing = false) => {
    if (!items.length) return;
    const h = document.createElement('div');
    h.className = 'section-title';
    h.innerHTML = `<span class="section-arrow">▼</span> ${title} <span class="section-count">(${items.length})</span>`;
    container.appendChild(h);

    items.forEach(c => {
      const el = document.createElement('div');
      el.className = 'contact-item'
        + (currentContact && currentContact.id === c.id ? ' active' : '')
        + ((!isIncoming && !isOutgoing && unreadCountForContact(c.id) > 0) ? ' has-unread' : '');
      const st = c.status === 'invisible' ? 'offline' : (c.status || 'offline');
      let actions = '';
      if (isIncoming) {
        actions = `<div class="req-actions">
          <button class="btn-accept" data-id="${c.contact_relation_id}">Aceitar</button>
          <button class="btn-reject" data-id="${c.contact_relation_id}">Recusar</button>
        </div>`;
      } else if (isOutgoing) {
        actions = `<span class="pending-badge">Pendente</span>`;
      }
      const psmText = isIncoming
        ? 'Quer ser seu contato'
        : (isOutgoing ? 'Aguardando aceitação' : formatPsm(c.personal_message, false, c.status));
      el.innerHTML = `
        <div class="contact-icon ${st}">${buddyIcon(st)}</div>
        <div class="contact-text">
          <div class="contact-name">${escapeHtml(c.display_name)}${(!isIncoming && !isOutgoing && unreadCountForContact(c.id) > 0) ? `<span class="unread-pill" title="Mensagens não lidas">${unreadCountForContact(c.id) > 99 ? '99+' : unreadCountForContact(c.id)}</span>` : ''}</div>
          <div class="contact-psm">${psmText}</div>
        </div>
        ${actions}
      `;
      if (!isIncoming && !isOutgoing) el.onclick = () => openChat(c);
      const acceptBtn = el.querySelector('.btn-accept');
      if (acceptBtn) {
        acceptBtn.onclick = (e) => {
          e.stopPropagation();
          respondContact(c.contact_relation_id, 'accepted');
        };
      }
      const rejectBtn = el.querySelector('.btn-reject');
      if (rejectBtn) {
        rejectBtn.onclick = (e) => {
          e.stopPropagation();
          respondContact(c.contact_relation_id, 'rejected');
        };
      }
      container.appendChild(el);
    });
  };

  addSection('Solicitações', groups.incoming, true);
  addSection('Aguardando', groups.pending, false, true);
  addSection('Online', groups.online);
  addSection('Ocupado', groups.busy);
  addSection('Ausente', groups.away);
  addSection('Offline', groups.offline);

  if (!list.length) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:#8BB8D9;font-size:12px;">Nenhum contato ainda.<br>Clique em ➕ para adicionar.</div>';
  }
}

$('search').oninput = () => renderContacts();

async function respondContact(relationId, status) {
  try {
    if (String(relationId).startsWith('temp-')) {
      showToast('Aguarde', 'Sincronizando convite…');
      await loadContacts();
      const fromId = String(relationId).replace(/^temp-/, '');
      const real = contacts.find(c => c.id === fromId && (c.relation_status === 'incoming' || c.status === 'incoming'));
      if (!real || !real.contact_relation_id) {
        showToast('Erro', 'Convite não encontrado no servidor. Peça para reenviar.');
        return;
      }
      relationId = real.contact_relation_id;
    }
    const res = await fetch(`${API}/api/contacts/${relationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast('Erro', data.error || 'Não foi possível responder ao convite');
      return;
    }
    if (status === 'accepted') showToast('Contato', 'Solicitação aceita');
    if (status === 'rejected') showToast('Contato', 'Solicitação recusada');
    loadContacts();
  } catch (e) {
    showToast('Erro', 'Falha de conexão');
  }
}

// ========== CHAT ==========

function closeChat() {
  currentContact = null;
  currentConvId = null;
  $('active-chat').classList.add('hidden');
  $('empty-chat').classList.remove('hidden');
  $('app-layout').classList.remove('chat-open');
  renderContacts();
  stopFlashTitle();
}

async function openChat(contact) {
  currentContact = contact;
  if (contact && contact.id) {
    clearUnreadForContact(contact.id, null);
  }
  renderContacts();
  stopFlashTitle();

  $('empty-chat').classList.add('hidden');
  $('active-chat').classList.remove('hidden');
  $('app-layout').classList.add('chat-open');
  try {
    if (window.matchMedia('(max-width: 768px)').matches) {
      history.pushState({ chat: true }, '');
    }
  } catch (_) {}

  $('chat-name').textContent = contact.display_name;
  $('chat-titlebar').textContent = contact.display_name;
  $('chat-avatar').textContent = (contact.display_name || '?')[0].toUpperCase();
  $('chat-status').textContent = statusLabel(contact.status);

  const res = await fetch(`${API}/api/conversations/with/${contact.id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  currentConvId = data.conversation_id;

  const msgRes = await fetch(`${API}/api/conversations/${currentConvId}/messages?limit=50`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  messages[currentConvId] = await msgRes.json();
  renderMessages();
  $('msg-input').focus();
  clearUnreadForContact(contact.id, currentConvId);
  renderContacts();
}

function renderMessages() {
  const box = $('messages');
  box.innerHTML = '';
  (messages[currentConvId] || []).forEach(m => appendMessage(m));
  scrollMessages();
}

function appendMessage(msg) {
  const box = $('messages');
  const isMe = msg.sender_id === user.id;
  const el = document.createElement('div');

  if (msg.type === 'nudge') {
    el.className = 'msg nudge';
    el.textContent = isMe
      ? '⚡ Você chamou a atenção!'
      : `⚡ ${msg.sender_name || 'Alguém'} chamou sua atenção!`;
  } else {
    el.className = 'msg ' + (isMe ? 'me' : 'other');
    const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `
      ${!isMe ? `<div class="msg-sender">${escapeHtml(msg.sender_name || '')}</div>` : ''}
      <div>${escapeHtml(msg.content)}</div>
      <div class="msg-time">${time}</div>
    `;
  }
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
  socket.emit('message:send', { conversation_id: currentConvId, content: text, type: 'text' });
  input.value = '';
  stopTyping();
}

$('btn-send').onclick = sendMessage;
$('msg-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
$('msg-input').addEventListener('input', () => {
  if (!currentConvId || !socket) return;
  socket.emit('typing:start', { conversation_id: currentConvId });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 2000);
});
function stopTyping() {
  if (currentConvId && socket) socket.emit('typing:stop', { conversation_id: currentConvId });
}

// ========== NUDGE ==========
$('btn-nudge').onclick = () => {
  if (!currentConvId || !socket) return;
  const now = Date.now();
  if (now - lastNudgeAt < NUDGE_COOLDOWN_MS) {
    const wait = Math.ceil((NUDGE_COOLDOWN_MS - (now - lastNudgeAt)) / 1000);
    showToast('Aguarde', `Espere ${wait}s para chamar atenção de novo`);
    return;
  }
  lastNudgeAt = now;
  const btn = $('btn-nudge');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('cooldown');
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('cooldown');
    }, NUDGE_COOLDOWN_MS);
  }
  socket.emit('message:send', {
    conversation_id: currentConvId,
    content: 'CHAMAR ATENÇÃO!',
    type: 'nudge'
  });
  soundNudge();
  const area = document.querySelector('.app-layout') || document.body;
  area.classList.remove('shake');
  void area.offsetWidth;
  area.classList.add('shake');
  setTimeout(() => area.classList.remove('shake'), 600);
};

// ========== STATUS / PSM / ADD ==========
$('me-status-line').onclick = () => openModal('modal-status');
document.querySelectorAll('#modal-status button[data-status]').forEach(btn => {
  btn.onclick = () => {
    const status = btn.dataset.status;
    if (socket) socket.emit('status:set', status);
    fetch(`${API}/api/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status })
    }).then(() => { setStatusUI(status); closeModals(); });
  };
});
$('btn-cancel-status').onclick = closeModals;

$('me-psm').onclick = () => {
  $('psm-input').value = user.personal_message || '';
  openModal('modal-psm');
};
$('btn-save-psm').onclick = async () => {
  const psm = $('psm-input').value.trim();
  await fetch(`${API}/api/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ personal_message: psm })
  });
  user.personal_message = psm;
  localStorage.setItem('msn_user', JSON.stringify(user));
  updateMeUI();
  closeModals();
};
$('btn-cancel-psm').onclick = closeModals;

$('btn-add-contact').onclick = () => openModal('modal-add');
$('btn-confirm-add').onclick = async () => {
  const email = $('add-email').value.trim();
  if (!email) {
    showToast('Contato', 'Digite o email da pessoa');
    return;
  }
  try {
    const res = await fetch(`${API}/api/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast('Convite', data.error || 'Não foi possível enviar');
      return;
    }
    closeModals();
    $('add-email').value = '';
    showToast('Convite enviado', data.message || 'A pessoa verá em Solicitações');
    loadContacts();
  } catch (e) {
    showToast('Erro', 'Falha de conexão ao enviar convite');
  }
};
$('btn-cancel-add').onclick = closeModals;

const emoticons = [
  // Clássicos MSN / texto
  ':)', ':-)', ';)', ';-)', ':D', ':-D', ':P', ':-P', ':(', ':-(',
  ':O', ':-O', ':|', ':-|', ':/', ':-/', ':S', ':-S',
  ":'(", ":'-(", ':$', ':-$', ':@', ':-@', '(H)', '(h)',
  // MSN shortcuts clássicos
  '(A)', '(L)', '(U)', '(K)', '(F)', '(W)', '(P)', '(B)',
  '(D)', '(X)', '(Z)', '(E)', '(N)', '(Y)', '(N)', '(I)',
  '(G)', '(%)', '(T)', '(@)', '(&)', '(sn)', '(mm)',
  // Emojis modernos equivalentes
  '😀', '😁', '😂', '🤣', '😊', '😍', '🤩', '😎',
  '😢', '😭', '😡', '🤬', '😱', '😴', '🤔', '🙄',
  '👍', '👎', '👏', '🙏', '❤️', '💔', '🔥', '⭐',
  '🎵', '🎮', '☕', '🍕', '✨', '💯', '🎉', '👋'
];

// Converte atalhos clássicos do MSN para emoji ao enviar (opcional visual)
const msnMap = {
  ':)': '😊', ':-)': '😊', ';)': '😉', ';-)': '😉',
  ':D': '😃', ':-D': '😃', ':P': '😛', ':-P': '😛',
  ':(': '🙁', ':-(': '🙁', ':O': '😮', ':-O': '😮',
  ":'(": '😢', '(L)': '❤️', '(K)': '💋', '(H)': '😎',
  '(Y)': '👍', '(N)': '👎', '(F)': '🌹', '(A)': '😇'
};
$('btn-emoji').onclick = () => {
  const grid = $('emoji-grid');
  grid.innerHTML = '';
  emoticons.forEach(e => {
    const b = document.createElement('button');
    b.textContent = e;
    b.onclick = () => { $('msg-input').value += e; closeModals(); $('msg-input').focus(); };
    grid.appendChild(b);
  });
  openModal('modal-emoji');
};
$('btn-close-emoji').onclick = closeModals;

function openModal(id) {
  $('modal-overlay').classList.remove('hidden');
  ['modal-add', 'modal-status', 'modal-psm', 'modal-emoji'].forEach(m => {
    $(m).classList.toggle('hidden', m !== id);
  });
}
function closeModals() { $('modal-overlay').classList.add('hidden'); }
$('modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('modal-overlay')) closeModals();
});

$('btn-logout').onclick = logout;
if ($('btn-back')) $('btn-back').onclick = closeChat;
// Botão voltar do celular
window.addEventListener('popstate', () => {
  if ($('app-layout') && $('app-layout').classList.contains('chat-open')) {
    closeChat();
  }
});

(function initSoundBtn() {
  const btn = $('btn-sound');
  if (!btn) return;
  btn.textContent = soundEnabled ? '🔊' : '🔇';
  btn.title = soundEnabled ? 'Sons ligados' : 'Sons desligados';
  btn.onclick = toggleSound;
})();

function logout() {
  if (socket) socket.disconnect();
  token = null; user = null;
  localStorage.removeItem('msn_token');
  localStorage.removeItem('msn_user');
  showLogin();
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
