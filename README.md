# Windows Live Messenger (Classic)

Recriação nostálgica e funcional do **Windows Live Messenger / MSN 2005–2009** para navegador e smartphones.

Interface inspirada no cliente clássico (tema azul/céu, lista de contatos, status, nudge), com backend em tempo real e autenticação.

---

## Funcionalidades

| Recurso | Status |
|--------|--------|
| Login / registro (JWT + bcrypt) | OK |
| Lista de contatos com status | OK |
| Bonequinhos coloridos (online/ocupado/ausente/offline) | OK |
| Mensagem pessoal + notas musicais | OK |
| Chat 1:1 em tempo real (Socket.io) | OK |
| Indicador "esta digitando..." | OK |
| Nudge (chamar atencao) + som + shake | OK |
| Toasts, titulo piscando, notificacoes do sistema | OK |
| Busca de contatos | OK |
| Adicionar / aceitar contatos | OK |
| Historico persistente (JSON) | OK |
| Versao web (navegador) | OK |
| App Flutter (Android/iOS) | OK (codigo-fonte) |
| Grupos / push / E2E | Em breve |

---

## Inicio rapido (versao web)

### 1. Backend

```bash
cd backend
npm install
npm start
```

Servidor em **http://localhost:3000**

- App web: http://localhost:3000
- Health: http://localhost:3000/health
- Status do servidor: http://localhost:3000/server

### 2. Testar com 2 usuarios

1. Abra http://localhost:3000
2. Abra outra janela anonima
3. Crie duas contas e adicione um ao outro
4. Converse e teste o botao **Nudge**

---

## Estrutura

```
msn-classic-messenger/
├── backend/          # Node.js + Express + Socket.io + JSON DB
│   ├── server.js
│   └── package.json
├── web/              # Cliente web (HTML/CSS/JS)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── mobile/           # App Flutter (Android + iOS)
└── README.md
```

---

## Stack

- **Backend:** Node.js, Express, Socket.io, bcryptjs, JWT
- **Storage:** arquivo db.json (sem dependencias nativas — funciona no Windows sem Visual Studio)
- **Web:** HTML5, CSS3 (tema WLM + efeitos 3D leves), Vanilla JS
- **Mobile:** Flutter (codigo em /mobile)

---

## App Flutter

```bash
cd mobile
flutter pub get
flutter run --dart-define=API_URL=http://SEU_IP:3000
```

- Emulador Android: http://10.0.2.2:3000
- iOS Simulator: http://localhost:3000
- Celular fisico: IP da maquina na rede local

---

## Seguranca (MVP)

- Senhas com bcrypt
- Tokens JWT (7 dias)
- Validacao basica de entrada
- Bloqueio de mensagens de contatos bloqueados

Para producao: HTTPS, refresh tokens, rate limiting, backup do db.json e secret forte em JWT_SECRET.

---

## Licenca

Projeto educacional / nostalgico. Feito do zero, sem codigo proprietario da Microsoft.
