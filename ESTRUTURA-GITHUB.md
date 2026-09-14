# Seu GitHub está em estrutura PLANA (tudo na raiz)

Isso é ok. Ajuste os hosts assim:

## Netlify
- Base directory: (vazio)
- Build command: (vazio)
- **Publish directory: `.`** (ponto = raiz)  ← NÃO use `web`
- Site: https://webmsn.netlify.app

Arquivos na raiz do repo: index.html, app.js, style.css, config.js

## Vercel
- Root Directory: (vazio)
- Build: (vazio)
- **Output Directory: `.`**  ← NÃO use `web`
- Framework: Other

## Render (backend)
- **Root Directory: (vazio)**  ← NÃO use `backend`
- Build: `npm install`
- Start: `node server.js`
- package.json e server.js devem estar na **raiz** do repo

## config.js (obrigatório na raiz)
```js
window.WEB_MSN_API = 'https://webmsn.onrender.com';
```

## app.js (primeira linha da API)
Não use `window.location.origin` em produção.
Deve apontar para o Render (via config.js ou direto).

## Sons
Na raiz: `msn-message.mp3` e `msn-nudge.mp3` (como no seu upload).
