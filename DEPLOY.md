# WEB MSN — Deploy (Backend Render + Frontend Netlify/Vercel)

## Por que dava "Cannot GET" e cadastro falhava?

1. **Netlify e Vercel não rodam** o `server.js` (Express + Socket.io) 24h.
2. O frontend usava `window.location.origin` → tentava chamar a API **no próprio Netlify/Vercel**, onde **não existe** `/api/register`.
3. O backend precisa estar no **Render** (ou similar) e o frontend deve apontar para a URL do Render.

Arquitetura correta:

```
[ Navegador ]
     │
     ├─ HTML/CSS/JS  →  Netlify ou Vercel  (pasta /web)
     │
     └─ API + Socket.io  →  Render  (pasta /backend)
```

---

## 1. Backend no Render

1. Suba o repositório no **GitHub**.
2. [Render](https://render.com) → **New → Web Service** → conecte o repo.
3. Configuração:
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance:** Free
4. Variáveis de ambiente (Environment):
   - `JWT_SECRET` = uma string longa aleatória
   - `CORS_ORIGINS` = `*` (ou `https://seu-site.netlify.app,https://seu-site.vercel.app`)
5. Deploy. Anote a URL, exemplo:
   `https://web-msn-api.onrender.com`

### Teste do backend

Abra no navegador:

- `https://SUA-API.onrender.com/health`  
  → deve retornar `{"status":"ok",...}`

- `https://SUA-API.onrender.com/api`  
  → lista endpoints

**Não** espere página HTML bonita em `/api/register` (é POST, não GET).  
`Cannot GET /api/register` no navegador é **normal**.

### Plano free do Render

O serviço **dorme** após ~15 min sem uso. A primeira requisição pode demorar 30–60s. Aguarde e tente de novo.

---

## 2. Frontend no Netlify

1. **Site settings → Build:**
   - Base directory: (raiz do repo) ou deixe vazio
   - **Publish directory:** `web`
   - Build command: (vazio) ou `echo ok`
2. Edite **antes do deploy** o arquivo `web/config.js`:

```js
window.WEB_MSN_API = 'https://web-msn-api.onrender.com'; // SUA URL do Render
```

3. Commit + push. O `netlify.toml` já publica a pasta `web` e evita 404 em rotas.

---

## 3. Frontend na Vercel

1. Importar o repo GitHub.
2. **Root** do projeto; output/static na pasta `web` (ou use o `vercel.json`).
3. Mesmo `web/config.js` com a URL do Render.
4. Deploy.

---

## 4. Checklist se o cadastro ainda falhar

| Sintoma | Causa | Solução |
|--------|--------|---------|
| `Cannot GET /` no Netlify | Rota sem `index.html` | `netlify.toml` redirects 200 → index.html |
| Cadastro “não conecta” | `WEB_MSN_API` vazio ou errado | Preencher `web/config.js` com URL Render **https** |
| CORS error no console | Origem bloqueada | `CORS_ORIGINS=*` no Render |
| Timeout no primeiro login | Render free “acordando” | Esperar 1 min e tentar de novo |
| `Cannot GET /api/register` | Abrir no browser (GET) | Use o app; register é **POST** |
| Socket não conecta | API HTTP vs site HTTPS | API deve ser **https://** no Render |

### Teste rápido no console do navegador (F12)

```js
fetch('https://SUA-API.onrender.com/health').then(r => r.json()).then(console.log)
```

Deve mostrar `{ status: 'ok', ... }`.

---

## 5. GitHub

Estrutura recomendada no repo:

```
msn-classic-messenger/
├── backend/          ← Root Directory no Render
│   ├── package.json
│   └── server.js
├── web/              ← Publish no Netlify/Vercel
│   ├── index.html
│   ├── config.js     ← URL do Render aqui
│   ├── app.js
│   ├── style.css
│   └── assets/
├── netlify.toml
├── vercel.json
└── render.yaml
```

Não coloque `node_modules` no Git. O Render roda `npm install` sozinho.

---

## 6. Tudo no Render (alternativa simples)

Se quiser **um único serviço**:

- Root Directory: **raiz do repo** (não só backend)
- Ajuste start para: `cd backend && npm install && node server.js`
- Ou rootDir `backend` e copie `web` para dentro de `backend/public` e sirva static de lá.

No código atual, o backend já serve `../web` se a estrutura for mantida:

```
repo/
  backend/server.js
  web/index.html
```

No Render com **Root Directory = backend**, a pasta `web` fica **fora** e o static pode falhar. Por isso o modelo **API no Render + web no Netlify** é o mais confiável.

Opção “tudo no Render”:

1. Root Directory: deixe **em branco** (raiz).
2. Build: `cd backend && npm install`
3. Start: `cd backend && node server.js`
4. Acesse a URL do Render — ela serve o WEB MSN e a API juntos.  
   Nesse caso `config.js` pode ficar com `WEB_MSN_API` vazio.
