/**
 * WEB MSN — configuração do frontend
 *
 * LOCAL: deixe como está (API no mesmo servidor Node).
 * PRODUÇÃO (Netlify / Vercel): coloque a URL pública do backend no Render.
 *
 * Exemplo Render:
 *   window.WEB_MSN_API = 'https://web-msn-api.onrender.com';
 */
window.WEB_MSN_API = window.WEB_MSN_API || '';
// Se vazio, o app usa window.location.origin (modo all-in-one / local).
