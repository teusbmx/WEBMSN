# WEB MSN — PWA + Push real

## Deploy (Render)

1. `cd backend && npm install` (inclui `web-push`)
2. Start: `node server.js`
3. Na primeira execução o servidor gera `vapid.json` automaticamente.
4. Opcional no Render Environment:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT=mailto:seu@email.com`

## No celular

1. Abra https://webmsn.onrender.com (HTTPS obrigatório para Push e Install)
2. Login
3. Toque **🔔** e aceite a permissão de notificações
4. Toque **⬇️** (Instalar app) quando aparecer — ou menu do navegador
5. iPhone (Safari): Compartilhar → Adicionar à Tela de Início (Push no iOS 16.4+ requer PWA instalada)

## Multi-dispositivo

Cada aparelho que tocar em 🔔 registra uma subscription.
Mensagens novas disparam Web Push para todos os dispositivos do destinatário.

## Clique na notificação

Abre `/?chat=CONTACT_ID` e a conversa correspondente.
