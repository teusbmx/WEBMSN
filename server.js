/**
 * WEB MSN Backend
 * Real-time messaging inspired by MSN Messenger 2005/2006
 * Pure JavaScript storage (no native modules) - works on Windows without Visual Studio
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'msn-classic-secret-change-me-in-production-2026';
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

// ============== SIMPLE JSON DATABASE ==============
let db = {
  users: [],
  contacts: [],
  conversations: [],
  participants: [],
  messages: [],
  push_subscriptions: [] // multi-device: several per user_id
};

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.users = db.users || [];
      db.contacts = db.contacts || [];
      db.conversations = db.conversations || [];
      db.participants = db.participants || [];
      db.messages = db.messages || [];
      db.push_subscriptions = db.push_subscriptions || [];
      try { repairFriendRequests(); } catch (e) { console.warn(e); }
      console.log(`[DB] Loaded ${db.users.length} users, ${db.messages.length} messages, ${db.push_subscriptions.length} push subs`);
    }
  } catch (e) {
    console.error('[DB] Error loading, starting fresh:', e.message);
  }
}

function persist() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('[DB] Error saving:', e.message);
  }
}


loadDb();

// ============== WEB PUSH (VAPID) ==============
let webpush = null;
let VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
let VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@webmsn.app';
const VAPID_FILE = path.join(__dirname, 'vapid.json');

try {
  webpush = require('web-push');
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    if (fs.existsSync(VAPID_FILE)) {
      const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
      VAPID_PUBLIC = saved.publicKey;
      VAPID_PRIVATE = saved.privateKey;
    } else {
      const keys = webpush.generateVAPIDKeys();
      VAPID_PUBLIC = keys.publicKey;
      VAPID_PRIVATE = keys.privateKey;
      try {
        fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
        console.log('[Push] VAPID keys geradas e salvas em vapid.json');
      } catch (e) {
        console.warn('[Push] Não foi possível salvar vapid.json:', e.message);
      }
    }
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  console.log('[Push] Web Push ativo');
} catch (e) {
  console.warn('[Push] web-push não instalado. Rode: npm install web-push');
  console.warn('[Push]', e.message);
}

async function sendPushToUser(userId, payload, excludeEndpoint) {
  if (!webpush || !VAPID_PUBLIC) return;
  const subs = (db.push_subscriptions || []).filter((s) => s.user_id === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    if (excludeEndpoint && sub.endpoint === excludeEndpoint) continue;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        body,
        { TTL: 60 * 60, urgency: 'high' }
      );
    } catch (err) {
      const code = err.statusCode || err.status;
      // 404/410 = subscription expired → remove
      if (code === 404 || code === 410) {
        db.push_subscriptions = db.push_subscriptions.filter((s) => s.endpoint !== sub.endpoint);
        persist();
        console.log('[Push] Subscription removida (expirada):', sub.endpoint.slice(0, 48));
      } else {
        console.warn('[Push] Falha ao enviar:', code || err.message);
      }
    }
  }
}


// ============== EXPRESS + SOCKET.IO ==============
const app = express();

// CORS: permite frontend na Netlify/Vercel + local
const allowedOrigins = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(null, true); // MVP: libera; restrinja em produção com CORS_ORIGINS
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));

// Frontend estático (quando backend e web no mesmo host)
const webDirCandidates = [
  path.join(__dirname, '../web'),
  path.join(__dirname, 'web'),
  path.join(__dirname)
];
const webDir = webDirCandidates.find(d => {
  try { return require('fs').existsSync(path.join(d, 'index.html')); } catch { return false; }
}) || path.join(__dirname, '../web');
app.use(express.static(webDir));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const onlineUsers = new Map();
const typingUsers = new Map();

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, display_name: user.display_name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token necessário' });
  }
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('Auth error'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Auth error'));
  }
}

// ============== REST API ==============

app.post('/api/register', async (req, res) => {
  try {
    const { email, password, display_name } = req.body;
    if (!email || !password || !display_name) {
      return res.status(400).json({ error: 'email, password e display_name são obrigatórios' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
    }

    const emailLower = email.toLowerCase().trim();
    if (db.users.find(u => u.email === emailLower)) {
      return res.status(409).json({ error: 'E-mail já cadastrado' });
    }

    const id = uuidv4();
    const hash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();

    const user = {
      id,
      email: emailLower,
      password_hash: hash,
      display_name: display_name.trim(),
      personal_message: '',
      avatar_url: '',
      status: 'offline',
      last_seen: now,
      created_at: now
    };

    db.users.push(user);
    persist();

    const token = generateToken(user);
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        personal_message: '',
        avatar_url: '',
        status: 'offline'
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email e password obrigatórios' });

    const user = db.users.find(u => u.email === email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        personal_message: user.personal_message || '',
        avatar_url: user.avatar_url || '',
        status: user.status || 'offline'
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json({
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    personal_message: user.personal_message || '',
    avatar_url: user.avatar_url || '',
    status: user.status,
    last_seen: user.last_seen
  });
});

app.patch('/api/me', authMiddleware, (req, res) => {
  const { display_name, personal_message, avatar_url, status } = req.body;
  const allowedStatus = ['online', 'busy', 'away', 'invisible', 'offline'];

  if (status && !allowedStatus.includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  if (display_name !== undefined) user.display_name = display_name;
  if (personal_message !== undefined) user.personal_message = personal_message;
  if (avatar_url !== undefined) user.avatar_url = avatar_url;
  if (status !== undefined) user.status = status;
  user.last_seen = new Date().toISOString();

  persist();

  if (status && status !== 'invisible') {
    broadcastStatusToContacts(req.user.id, status);
  } else if (status === 'invisible') {
    broadcastStatusToContacts(req.user.id, 'offline');
  }

  res.json({
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    personal_message: user.personal_message || '',
    avatar_url: user.avatar_url || '',
    status: user.status
  });
});

app.get('/api/users/search', authMiddleware, (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);

  const users = db.users
    .filter(u =>
      u.id !== req.user.id &&
      (u.email.includes(q) || u.display_name.toLowerCase().includes(q))
    )
    .slice(0, 20)
    .map(u => ({
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      personal_message: u.personal_message || '',
      avatar_url: u.avatar_url || '',
      status: u.status === 'invisible' ? 'offline' : u.status
    }));

  res.json(users);
});

app.get('/api/contacts', authMiddleware, (req, res) => {
  try { repairFriendRequests(); } catch (e) { console.warn('[repair]', e.message); }
  const myContacts = db.contacts.filter(c => c.user_id === req.user.id && c.status !== 'blocked' && c.status !== 'rejected');

  const result = myContacts.map(c => {
    const u = db.users.find(user => user.id === c.contact_id);
    if (!u) return null;
    // relation_status = vínculo (incoming/pending/accepted); status = presença online
    const presence = u.status === 'invisible' ? 'offline' : (u.status || 'offline');
    return {
      contact_relation_id: c.id,
      relation_status: c.status, // incoming | pending | accepted | blocked
      nickname: c.nickname || null,
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      personal_message: c.status === 'incoming' ? 'Quer ser seu contato' : (u.personal_message || ''),
      avatar_url: u.avatar_url || '',
      status: c.status === 'incoming' || c.status === 'pending' ? presence : presence,
      last_seen: u.last_seen
    };
  }).filter(Boolean);

  const order = { online: 1, busy: 2, away: 3, offline: 4 };
  result.sort((a, b) => (order[a.status] || 5) - (order[b.status] || 5) || a.display_name.localeCompare(b.display_name));

  res.json(result);
});

// Garante par pending (quem enviou) + incoming (quem recebe)
function ensureFriendRequestPair(fromUserId, toUserId) {
  let outgoing = db.contacts.find(
    c => c.user_id === fromUserId && c.contact_id === toUserId && (c.status === 'pending' || c.status === 'accepted')
  );
  let incoming = db.contacts.find(
    c => c.user_id === toUserId && c.contact_id === fromUserId && (c.status === 'incoming' || c.status === 'accepted')
  );

  // Remove lixo rejected entre os dois
  db.contacts = db.contacts.filter(c => {
    const pair =
      (c.user_id === fromUserId && c.contact_id === toUserId) ||
      (c.user_id === toUserId && c.contact_id === fromUserId);
    if (!pair) return true;
    if (c.status === 'rejected') return false;
    return true;
  });

  outgoing = db.contacts.find(c => c.user_id === fromUserId && c.contact_id === toUserId);
  incoming = db.contacts.find(c => c.user_id === toUserId && c.contact_id === fromUserId);

  if (outgoing && outgoing.status === 'accepted' && incoming && incoming.status === 'accepted') {
    return { alreadyFriends: true };
  }
  if (outgoing && outgoing.status === 'blocked') {
    return { blocked: true };
  }

  // Se o OUTRO já me enviou pedido, eu devo ver em Solicitações (incoming no meu lado)
  if (incoming && incoming.status === 'pending') {
    // Dados invertidos de versão antiga: corrige
    incoming.status = 'incoming';
  }
  if (outgoing && outgoing.status === 'incoming') {
    // Eu tinha "incoming" errado como quem envia — vira pending
    outgoing.status = 'pending';
  }

  if (!outgoing) {
    outgoing = {
      id: uuidv4(),
      user_id: fromUserId,
      contact_id: toUserId,
      status: 'pending',
      nickname: null,
      created_at: new Date().toISOString()
    };
    db.contacts.push(outgoing);
  } else if (outgoing.status !== 'accepted') {
    outgoing.status = 'pending';
  }

  if (!incoming) {
    incoming = {
      id: uuidv4(),
      user_id: toUserId,
      contact_id: fromUserId,
      status: 'incoming',
      nickname: null,
      created_at: new Date().toISOString()
    };
    db.contacts.push(incoming);
  } else if (incoming.status !== 'accepted') {
    incoming.status = 'incoming';
  }

  persist();
  return { outgoing, incoming, alreadyFriends: false };
}

/** Repara pedidos antigos só com pending de um lado */
function repairFriendRequests() {
  let changed = false;
  const pendings = db.contacts.filter(c => c.status === 'pending');
  for (const p of pendings) {
    let other = db.contacts.find(c => c.user_id === p.contact_id && c.contact_id === p.user_id);
    if (!other) {
      db.contacts.push({
        id: uuidv4(),
        user_id: p.contact_id,
        contact_id: p.user_id,
        status: 'incoming',
        nickname: null,
        created_at: p.created_at || new Date().toISOString()
      });
      changed = true;
    } else if (other.status === 'pending') {
      // Dois pendings espelhados: o "recebedor" deve ser incoming
      // Mantém quem tem created_at mais antigo como pending (remetente)
      other.status = 'incoming';
      changed = true;
    } else if (other.status !== 'incoming' && other.status !== 'accepted' && other.status !== 'blocked') {
      other.status = 'incoming';
      changed = true;
    }
  }
  if (changed) persist();
}

app.post('/api/contacts', authMiddleware, (req, res) => {
  try {
    const { contact_id, email } = req.body || {};
    let targetId = contact_id;

    if (!targetId && email) {
      const emailNorm = String(email).toLowerCase().trim();
      const u = db.users.find(user => (user.email || '').toLowerCase().trim() === emailNorm);
      if (!u) {
        return res.status(404).json({
          error: 'Usuário não encontrado. A pessoa precisa se cadastrar no WEB MSN primeiro.'
        });
      }
      targetId = u.id;
    }

    if (!targetId) return res.status(400).json({ error: 'Informe o email do contato' });
    if (targetId === req.user.id) return res.status(400).json({ error: 'Não pode adicionar a si mesmo' });

    // Já existe pedido DELES para mim?
    const theyAsked = db.contacts.find(
      c => c.user_id === req.user.id && c.contact_id === targetId && c.status === 'incoming'
    );
    if (theyAsked) {
      return res.status(409).json({
        error: 'Esta pessoa já te enviou um pedido. Abra a seção Solicitações e aceite.'
      });
    }

    const result = ensureFriendRequestPair(req.user.id, targetId);
    if (result.alreadyFriends) {
      return res.status(409).json({ error: 'Vocês já são contatos' });
    }
    if (result.blocked) {
      return res.status(400).json({ error: 'Contato bloqueado' });
    }

    const fromUser = db.users.find(u => u.id === req.user.id);
    const displayName = fromUser ? fromUser.display_name : (req.user.display_name || 'Alguém');
    const payload = {
      from: req.user.id,
      display_name: displayName,
      email: fromUser ? fromUser.email : '',
      relation_id: result.incoming && result.incoming.id
    };

    io.to(`user:${targetId}`).emit('contact:request', payload);
    const targetSocket = onlineUsers.get(targetId);
    if (targetSocket && targetSocket.socketId) {
      io.to(targetSocket.socketId).emit('contact:request', payload);
    }
    // Também pede refresh da lista
    io.to(`user:${targetId}`).emit('contact:updated', {});
    io.to(`user:${req.user.id}`).emit('contact:updated', {});

    if (typeof sendPushToUser === 'function') {
      sendPushToUser(targetId, {
        title: 'Solicitação de amizade',
        body: displayName + ' quer adicionar você',
        contactId: req.user.id,
        url: '/?source=friend_request'
      }).catch(() => {});
    }

    res.status(201).json({
      id: result.outgoing.id,
      status: 'pending',
      message: 'Convite enviado! A pessoa verá em Solicitações.'
    });
  } catch (err) {
    console.error('[contacts POST]', err);
    res.status(500).json({ error: 'Erro ao enviar convite' });
  }
});

app.patch('/api/contacts/:relationId', authMiddleware, (req, res) => {
  const { status } = req.body;
  // accepted | blocked | rejected
  if (!['accepted', 'blocked', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status deve ser accepted, blocked ou rejected' });
  }

  const rel = db.contacts.find(c => c.id === req.params.relationId && c.user_id === req.user.id);
  if (!rel) return res.status(404).json({ error: 'Relação não encontrada' });

  if (status === 'rejected') {
    // Remove pedido dos dois lados
    db.contacts = db.contacts.filter(c =>
      !(c.user_id === req.user.id && c.contact_id === rel.contact_id) &&
      !(c.user_id === rel.contact_id && c.contact_id === req.user.id && (c.status === 'pending' || c.status === 'incoming'))
    );
    persist();
    const other = onlineUsers.get(rel.contact_id);
    if (other) {
      io.to(`user:${rel.contact_id}`).emit('contact:updated', {});
      io.to(other.socketId).emit('contact:updated', {});
    }
    return res.json({ ok: true, status: 'rejected' });
  }

  rel.status = status === 'blocked' ? 'blocked' : 'accepted';

  if (status === 'accepted') {
    let reverse = db.contacts.find(c => c.user_id === rel.contact_id && c.contact_id === req.user.id);
    if (!reverse) {
      db.contacts.push({
        id: uuidv4(),
        user_id: rel.contact_id,
        contact_id: req.user.id,
        status: 'accepted',
        nickname: null,
        created_at: new Date().toISOString()
      });
    } else {
      reverse.status = 'accepted';
    }
    // Limpa incoming residual
    db.contacts.forEach(c => {
      if (c.user_id === req.user.id && c.contact_id === rel.contact_id) c.status = 'accepted';
      if (c.user_id === rel.contact_id && c.contact_id === req.user.id) c.status = 'accepted';
    });
    ensureDirectConversation(req.user.id, rel.contact_id);
    const other = onlineUsers.get(rel.contact_id);
    if (other) {
      io.to(`user:${rel.contact_id}`).emit('contact:updated', {});
      io.to(other.socketId).emit('contact:updated', {});
    }
  }

  persist();
  res.json({ ok: true, status });
});

app.get('/api/conversations/with/:contactId', authMiddleware, (req, res) => {
  const convId = ensureDirectConversation(req.user.id, req.params.contactId);
  res.json({ conversation_id: convId });
});

app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  const isParticipant = db.participants.some(
    p => p.conversation_id === req.params.id && p.user_id === req.user.id
  );
  if (!isParticipant) return res.status(403).json({ error: 'Não autorizado' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  let messages = db.messages
    .filter(m => m.conversation_id === req.params.id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (req.query.before) {
    const beforeMsg = db.messages.find(m => m.id === req.query.before);
    if (beforeMsg) {
      messages = messages.filter(m => new Date(m.created_at) < new Date(beforeMsg.created_at));
    }
  }

  messages = messages.slice(-limit);

  const result = messages.map(m => {
    const sender = db.users.find(u => u.id === m.sender_id);
    return {
      ...m,
      sender_name: sender ? sender.display_name : 'Desconhecido'
    };
  });

  res.json(result);
});

function ensureDirectConversation(userA, userB) {
  const convsOfA = db.participants.filter(p => p.user_id === userA).map(p => p.conversation_id);
  for (const convId of convsOfA) {
    const conv = db.conversations.find(c => c.id === convId && c.type === 'direct');
    if (!conv) continue;
    const hasB = db.participants.some(p => p.conversation_id === convId && p.user_id === userB);
    if (hasB) return convId;
  }

  const id = uuidv4();
  db.conversations.push({ id, type: 'direct', created_at: new Date().toISOString() });
  db.participants.push({ conversation_id: id, user_id: userA });
  db.participants.push({ conversation_id: id, user_id: userB });
  persist();
  return id;
}

function broadcastStatusToContacts(userId, status) {
  const contacts = db.contacts.filter(c => c.contact_id === userId && c.status === 'accepted');
  for (const c of contacts) {
    const info = onlineUsers.get(c.user_id);
    if (info) {
      io.to(info.socketId).emit('user:status', { userId, status });
    }
  }
}

io.use(socketAuth);

io.on('connection', (socket) => {
  const userId = socket.user.id;
  console.log(`[+] ${socket.user.display_name} connected (${userId})`);

  const currentUser = db.users.find(u => u.id === userId);
  const newStatus = currentUser?.status === 'invisible' ? 'invisible' : 'online';

  if (currentUser) {
    currentUser.status = newStatus;
    currentUser.last_seen = new Date().toISOString();
    persist();
  }

  onlineUsers.set(userId, { socketId: socket.id, status: newStatus });

  if (newStatus !== 'invisible') {
    broadcastStatusToContacts(userId, 'online');
  }

  socket.join(`user:${userId}`);

  socket.on('status:set', (status) => {
    const allowed = ['online', 'busy', 'away', 'invisible', 'offline'];
    if (!allowed.includes(status)) return;

    if (currentUser) {
      currentUser.status = status;
      currentUser.last_seen = new Date().toISOString();
      persist();
    }
    onlineUsers.set(userId, { socketId: socket.id, status });

    const visible = status === 'invisible' ? 'offline' : status;
    broadcastStatusToContacts(userId, visible);
    socket.emit('status:ok', { status });
  });

  socket.on('message:send', (data, callback) => {
    try {
      const { conversation_id, content, type = 'text' } = data;
      if (!conversation_id || !content?.trim()) {
        return callback?.({ error: 'Dados inválidos' });
      }

      const isParticipant = db.participants.some(
        p => p.conversation_id === conversation_id && p.user_id === userId
      );
      if (!isParticipant) return callback?.({ error: 'Não autorizado' });

      const participants = db.participants.filter(p => p.conversation_id === conversation_id);
      for (const p of participants) {
        if (p.user_id === userId) continue;
        const blocked = db.contacts.find(
          c => c.user_id === p.user_id && c.contact_id === userId && c.status === 'blocked'
        );
        if (blocked) return callback?.({ error: 'Você está bloqueado' });
      }

      const msgId = uuidv4();
      const message = {
        id: msgId,
        conversation_id,
        sender_id: userId,
        content: content.trim(),
        type,
        created_at: new Date().toISOString()
      };

      db.messages.push(message);
      persist();

      const fullMessage = {
        ...message,
        sender_name: socket.user.display_name
      };

      for (const p of participants) {
        io.to(`user:${p.user_id}`).emit('message:new', fullMessage);
      }

      // Push real para destinatários (multi-dispositivo), exceto quem enviou
      const preview =
        type === 'nudge'
          ? 'Chamou sua atenção!'
          : content.trim().slice(0, 120);
      for (const p of participants) {
        if (p.user_id === userId) continue;
        const isOnline = onlineUsers.has(p.user_id);
        // Envia push sempre (outros dispositivos / app em background)
        sendPushToUser(p.user_id, {
          title: socket.user.display_name || 'WEB MSN',
          body: preview,
          conversationId: conversation_id,
          contactId: userId,
          url: '/?chat=' + encodeURIComponent(userId),
          online: !!isOnline
        }).catch(() => {});
      }

      callback?.({ ok: true, message: fullMessage });
    } catch (err) {
      console.error(err);
      callback?.({ error: 'Erro ao enviar' });
    }
  });

  socket.on('typing:start', ({ conversation_id }) => {
    if (!typingUsers.has(conversation_id)) typingUsers.set(conversation_id, new Set());
    typingUsers.get(conversation_id).add(userId);

    const participants = db.participants.filter(p => p.conversation_id === conversation_id);
    for (const p of participants) {
      if (p.user_id !== userId) {
        io.to(`user:${p.user_id}`).emit('typing:update', {
          conversation_id,
          user_id: userId,
          display_name: socket.user.display_name,
          is_typing: true
        });
      }
    }
  });

  socket.on('typing:stop', ({ conversation_id }) => {
    typingUsers.get(conversation_id)?.delete(userId);

    const participants = db.participants.filter(p => p.conversation_id === conversation_id);
    for (const p of participants) {
      if (p.user_id !== userId) {
        io.to(`user:${p.user_id}`).emit('typing:update', {
          conversation_id,
          user_id: userId,
          display_name: socket.user.display_name,
          is_typing: false
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.user.display_name} disconnected`);
    onlineUsers.delete(userId);

    if (currentUser) {
      currentUser.status = 'offline';
      currentUser.last_seen = new Date().toISOString();
      persist();
    }
    broadcastStatusToContacts(userId, 'offline');
  });
});

// Página de status do servidor (a raiz / serve o app web)
app.get('/server', (req, res) => {
  const online = onlineUsers.size;
  const users = db.users.length;
  const messages = db.messages.length;
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MSN Classic Backend</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(180deg, #1B5E20 0%, #2E7D32 40%, #E8F5E9 40%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #1B5E20;
    }
    .card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      padding: 40px 48px;
      text-align: center;
      max-width: 420px;
      width: 90%;
    }
    .logo {
      width: 72px;
      height: 72px;
      background: linear-gradient(135deg, #2E7D32, #66BB6A);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 36px;
      color: white;
      box-shadow: 0 4px 12px rgba(46,125,50,0.3);
    }
    h1 { font-size: 26px; font-weight: 700; color: #1B5E20; margin-bottom: 4px; }
    .subtitle { color: #66BB6A; font-size: 14px; margin-bottom: 28px; }
    .status {
      display: inline-flex; align-items: center; gap: 8px;
      background: #E8F5E9; color: #2E7D32;
      padding: 8px 16px; border-radius: 20px;
      font-weight: 600; font-size: 14px; margin-bottom: 24px;
    }
    .status .dot {
      width: 10px; height: 10px; background: #4CAF50;
      border-radius: 50%; animation: pulse 1.5s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 24px; }
    .stat { background: #F1F8E9; border-radius: 8px; padding: 14px 8px; }
    .stat .num { font-size: 24px; font-weight: 700; color: #2E7D32; }
    .stat .label { font-size: 11px; color: #689F38; text-transform: uppercase; letter-spacing: 0.5px; }
    .endpoints {
      text-align: left; font-size: 13px; color: #555;
      background: #FAFAFA; border-radius: 8px; padding: 14px 16px; line-height: 1.7;
    }
    .endpoints strong { color: #2E7D32; }
    .footer { margin-top: 20px; font-size: 12px; color: #9E9E9E; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">💬</div>
    <h1>MSN Classic</h1>
    <div class="subtitle">Backend 2005/2006</div>
    <div class="status"><span class="dot"></span> Servidor Online</div>
    <div class="stats">
      <div class="stat"><div class="num">${users}</div><div class="label">Usuários</div></div>
      <div class="stat"><div class="num">${online}</div><div class="label">Online</div></div>
      <div class="stat"><div class="num">${messages}</div><div class="label">Mensagens</div></div>
    </div>
    <div class="endpoints">
      <strong>API pronta:</strong><br>
      POST /api/register &nbsp;·&nbsp; POST /api/login<br>
      GET /api/contacts &nbsp;·&nbsp; GET /health<br>
      Socket.io ativo na porta ${PORT}
    </div>
    <div class="footer">
      Inspirado no MSN Messenger clássico<br>
      Feito do zero para smartphones
    </div>
  </div>
</body>
</html>`);
});


// VAPID public key for client subscribe
app.get('/api/push/vapid-public-key', (req, res) => {
  if (!VAPID_PUBLIC) {
    return res.status(503).json({ error: 'Push não configurado no servidor (npm install web-push)' });
  }
  res.json({ publicKey: VAPID_PUBLIC });
});

// Register push subscription (multi-device)
app.post('/api/push/subscribe', authMiddleware, (req, res) => {
  const { endpoint, keys, userAgent } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Subscription inválida' });
  }
  db.push_subscriptions = db.push_subscriptions || [];
  // upsert by endpoint
  const existing = db.push_subscriptions.findIndex((s) => s.endpoint === endpoint);
  const row = {
    id: existing >= 0 ? db.push_subscriptions[existing].id : uuidv4(),
    user_id: req.user.id,
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    userAgent: userAgent || '',
    created_at: existing >= 0 ? db.push_subscriptions[existing].created_at : new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (existing >= 0) db.push_subscriptions[existing] = row;
  else db.push_subscriptions.push(row);
  persist();
  res.json({ ok: true, devices: db.push_subscriptions.filter((s) => s.user_id === req.user.id).length });
});

app.delete('/api/push/subscribe', authMiddleware, (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint necessário' });
  db.push_subscriptions = (db.push_subscriptions || []).filter(
    (s) => !(s.user_id === req.user.id && s.endpoint === endpoint)
  );
  persist();
  res.json({ ok: true });
});

app.get('/api/push/devices', authMiddleware, (req, res) => {
  const devices = (db.push_subscriptions || [])
    .filter((s) => s.user_id === req.user.id)
    .map((s) => ({
      endpoint_hint: s.endpoint.slice(-24),
      userAgent: s.userAgent,
      updated_at: s.updated_at
    }));
  res.json({ devices });
});


app.get('/api', (req, res) => {
  res.json({
    name: 'WEB MSN API',
    status: 'ok',
    endpoints: ['/api/register', '/api/login', '/api/contacts', '/health', '/server']
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', online: onlineUsers.size, users: db.users.length }));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║         WEB MSN Backend                ║
║         http://localhost:${PORT}                        ║
║         Storage: JSON (no native deps)               ║
║         Socket.io ready                              ║
╚══════════════════════════════════════════════════════╝
  `);
});
