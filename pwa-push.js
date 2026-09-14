/* WEB MSN — PWA install + Web Push real + unread helpers */
(function (global) {
  'use strict';

  function totalUnread(map) {
    return Object.values(map || {}).reduce((a, b) => a + (b || 0), 0);
  }

  global.WebMsnPWA = {
    deferredInstallPrompt: null,
    pushSubscribed: false,

    saveUnread() {
      try {
        localStorage.setItem('msn_unread', JSON.stringify(global.unreadByConv || {}));
      } catch (_) {}
      this.updateUnreadBadge();
    },

    updateUnreadBadge() {
      const el = document.getElementById('unread-total');
      const n = totalUnread(global.unreadByConv);
      if (el) {
        if (n > 0) {
          el.textContent = n > 99 ? '99+' : String(n);
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
      try {
        document.title = n > 0 ? '(' + n + ') WEB MSN' : 'WEB MSN';
      } catch (_) {}
    },

    clearUnread(conversationId) {
      if (!conversationId || !global.unreadByConv) return;
      if (global.unreadByConv[conversationId]) {
        delete global.unreadByConv[conversationId];
        this.saveUnread();
      }
    },

    bumpUnread(conversationId) {
      if (!conversationId) return;
      if (global.currentConvId === conversationId && !document.hidden) return;
      global.unreadByConv = global.unreadByConv || {};
      global.unreadByConv[conversationId] = (global.unreadByConv[conversationId] || 0) + 1;
      this.saveUnread();
    },

    async installApp() {
      if (!this.deferredInstallPrompt) {
        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        if (isIOS) {
          if (global.showToast) showToast('Instalar no iPhone', 'Safari → Compartilhar → Adicionar à Tela de Início');
        } else if (window.matchMedia('(display-mode: standalone)').matches) {
          if (global.showToast) showToast('Já instalado', 'O WEB MSN já está como aplicativo');
        } else {
          if (global.showToast) showToast('Instalar', 'Menu do navegador → Instalar app / Adicionar à tela inicial');
        }
        return;
      }
      this.deferredInstallPrompt.prompt();
      const choice = await this.deferredInstallPrompt.userChoice;
      this.deferredInstallPrompt = null;
      const btn = document.getElementById('btn-install');
      if (btn) btn.classList.add('hidden');
      if (choice && choice.outcome === 'accepted' && global.showToast) {
        showToast('WEB MSN', 'Instalação iniciada');
      }
    },

    urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(base64);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    },

    async registerServiceWorker() {
      if (!('serviceWorker' in navigator)) return null;
      try {
        return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch (e) {
        console.warn('[SW]', e);
        return null;
      }
    },

    async ensurePushSubscription(showToastMsg) {
      const API = global.API || global.__WEB_MSN_API__;
      const token = global.token;
      if (!API || !token) return false;

      if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) {
        if (showToastMsg && global.showToast) showToast('Notificações', 'Este navegador não suporta Web Push');
        return false;
      }

      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }
      if (permission !== 'granted') {
        if (showToastMsg && global.showToast) {
          showToast('Permissão', 'Permita notificações nas configurações do sistema/navegador');
        }
        return false;
      }

      const reg = await this.registerServiceWorker();
      if (!reg) return false;

      let publicKey;
      try {
        const res = await fetch(API + '/api/push/vapid-public-key');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Push indisponível no servidor');
        publicKey = data.publicKey;
      } catch (e) {
        if (showToastMsg && global.showToast) showToast('Push', e.message || 'Erro VAPID');
        return false;
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.urlBase64ToUint8Array(publicKey)
        });
      }

      const json = sub.toJSON();
      try {
        const res2 = await fetch(API + '/api/push/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
          },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
            userAgent: navigator.userAgent
          })
        });
        if (!res2.ok) throw new Error('Falha ao registrar dispositivo');
      } catch (e) {
        if (showToastMsg && global.showToast) showToast('Push', e.message);
        return false;
      }

      this.pushSubscribed = true;
      const btn = document.getElementById('btn-notify');
      if (btn) {
        btn.textContent = '🔔✓';
        btn.title = 'Notificações ativas neste aparelho';
      }
      if (showToastMsg && global.showToast) showToast('Notificações', 'Push ativado neste dispositivo');
      return true;
    },

    init() {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferredInstallPrompt = e;
        const btn = document.getElementById('btn-install');
        if (btn) btn.classList.remove('hidden');
      });

      window.addEventListener('appinstalled', () => {
        this.deferredInstallPrompt = null;
        const btn = document.getElementById('btn-install');
        if (btn) btn.classList.add('hidden');
      });

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          const data = event.data || {};
          if (data.type !== 'NOTIFICATION_CLICK') return;
          const contactId = data.contactId;
          if (!contactId) return;
          const open = () => {
            const c = (global.contacts || []).find((x) => x.id === contactId);
            if (c && typeof global.openChat === 'function') global.openChat(c);
          };
          if (global.contacts && global.contacts.length) open();
          else if (typeof global.loadContacts === 'function') {
            Promise.resolve(global.loadContacts()).then(open);
          }
        });
        this.registerServiceWorker();
      }

      const bi = document.getElementById('btn-install');
      if (bi) bi.addEventListener('click', () => this.installApp());
      const bn = document.getElementById('btn-notify');
      if (bn) bn.addEventListener('click', () => this.ensurePushSubscription(true));

      if (window.matchMedia('(display-mode: standalone)').matches) {
        if (bi) bi.classList.add('hidden');
      }

      this.updateUnreadBadge();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => global.WebMsnPWA.init());
  } else {
    setTimeout(() => global.WebMsnPWA.init(), 0);
  }
})(window);
