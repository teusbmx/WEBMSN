# WEB MSN na Vercel — corrigir 404 NOT_FOUND

## Configuração correta no painel Vercel

1. Project → **Settings → General**
2. **Root Directory:** deixe em branco (raiz do repo) **ou** defina `web` (veja opções abaixo)
3. **Framework Preset:** Other
4. **Build Command:** deixe **vazio**
5. **Output Directory:** `web`   ← se Root Directory for a raiz do repo
6. **Install Command:** deixe vazio

### Opção A (recomendada) — Root = raiz do repo

| Campo | Valor |
|--------|--------|
| Root Directory | (vazio) |
| Build Command | (vazio) |
| Output Directory | `web` |

### Opção B — Root = pasta web

| Campo | Valor |
|--------|--------|
| Root Directory | `web` |
| Build Command | (vazio) |
| Output Directory | (vazio / `.`) |

Depois: **Deployments → Redeploy** (com “Use existing Build Cache” **desmarcado**).

## Arquivos obrigatórios dentro de `web/`

- index.html
- app.js
- style.css
- config.js  → deve ter: `window.WEB_MSN_API = 'https://webmsn.onrender.com';`
- assets/msn-message.mp3
- assets/msn-nudge.mp3

## API (cadastro)

O frontend **não** usa a Vercel como API. Cadastro vai para o Render:

`https://webmsn.onrender.com`

## Erro NOT_FOUND (gru1::...)

Significa que a Vercel não achou o `index.html` no output do deploy.

Causas comuns:
1. Output Directory errado (ex.: `.` com arquivos em `web/`)
2. Repo sem a pasta `web` no branch que a Vercel usa
3. `vercel.json` antigo com `builds`/`routes` incompatível

Use o `vercel.json` novo deste projeto (só `outputDirectory: web`).
