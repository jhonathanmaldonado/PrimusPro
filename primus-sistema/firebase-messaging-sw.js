// ===== SERVICE WORKER DE PUSH — PRIMUS =====
// Recebe notificações mesmo com o app fechado (PWA no iPhone).
// Usa o SDK "compat" 10.12.0 (MESMA versão do firebase-config.js do app).
// Fica na RAIZ de /primus-sistema/.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDEo7pB-dLtSHFGjqvYf8Bt8n7VSu5HdrY",
  authDomain: "projeto-primus-9b643.firebaseapp.com",
  projectId: "projeto-primus-9b643",
  storageBucket: "projeto-primus-9b643.firebasestorage.app",
  messagingSenderId: "547842320766",
  appId: "1:547842320766:web:a87b857ce7c2d434cdab2f"
});

const messaging = firebase.messaging();

// Notificação recebida com o app FECHADO / em segundo plano
messaging.onBackgroundMessage(function (payload) {
  const titulo = (payload.notification && payload.notification.title) || 'Primus';
  const corpo  = (payload.notification && payload.notification.body)  || '';
  self.registration.showNotification(titulo, {
    body: corpo,
    tag: (payload.data && payload.data.tag) || 'primus',
    data: payload.data || {}
  });
});

// Ao tocar na notificação, abre/foca o app
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
      for (const c of lista) {
        if ('focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('./gestor.html');
    })
  );
});
