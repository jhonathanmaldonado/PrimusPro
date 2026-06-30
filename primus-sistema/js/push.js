// ===== PUSH (notificações) — PRIMUS =====
// Captura o token FCM do GESTOR e salva no Firestore (coleção primus_push_tokens).
// No iPhone, a permissão precisa partir de um TOQUE do usuário — por isso usamos
// um botão "Ativar notificações" em vez de pedir automático.

import { getMessaging, getToken, onMessage }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import { db, doc, setDoc, serverTimestamp } from './firebase-config.js';
import { getSessao } from './auth.js';

const VAPID_KEY = 'BCOHu1B-wMnCMZTJhUdZ4bX3b7k_C40_0PwBxhH73dqlGg1RrqjoYDVN7_ez_B9qr9Do-fond4VnBFuOiJrBHRA';
const SW_PATH   = 'firebase-messaging-sw.js'; // relativo a /primus-sistema/
const COL_TOKENS = 'primus_push_tokens';

export async function inicializarPush() {
  const sessao = getSessao();
  if (!sessao || sessao.perfil !== 'gestor') return;        // só gestor, por enquanto
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) {
    console.warn('[push] navegador sem suporte a push');
    return;
  }

  if (Notification.permission === 'granted') {
    // Já autorizado: atualiza o token silenciosamente (ele pode mudar com o tempo)
    await registrarToken(sessao);
  } else if (Notification.permission !== 'denied') {
    mostrarBotaoAtivar(sessao);
  }
}

function mostrarBotaoAtivar(sessao) {
  if (document.getElementById('btn-ativar-push')) return;
  const btn = document.createElement('button');
  btn.id = 'btn-ativar-push';
  btn.type = 'button';
  btn.textContent = '🔔 Ativar notificações';
  btn.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:9999;padding:12px 16px;border:none;' +
    'border-radius:999px;background:var(--vinho,#7C0047);color:#fff;font-weight:700;' +
    'font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer';
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Ativando...';
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        await registrarToken(sessao);
        btn.textContent = '✓ Notificações ativadas';
        setTimeout(() => btn.remove(), 2500);
      } else {
        btn.disabled = false;
        btn.textContent = '🔔 Ativar notificações';
        alert('Permissão negada. Você pode reativar em Ajustes do iPhone → Notificações → Primus.');
      }
    } catch (e) {
      console.error('[push] erro ao ativar:', e);
      btn.disabled = false;
      btn.textContent = '🔔 Ativar notificações';
      alert('Não foi possível ativar agora: ' + e.message);
    }
  };
  document.body.appendChild(btn);
}

async function registrarToken(sessao) {
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH);
    const messaging = getMessaging();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg
    });
    if (!token) { console.warn('[push] sem token (permissão?)'); return; }

    // 1 documento por gestor (id = uid da sessão), guardando o token do aparelho
    await setDoc(doc(db, COL_TOKENS, sessao.id), {
      token,
      nome: sessao.nome,
      perfil: sessao.perfil,
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    console.log('[push] token salvo para', sessao.nome);

    // Notificação enquanto o app está ABERTO (foreground)
    onMessage(messaging, (payload) => {
      const titulo = payload.notification?.title || 'Primus';
      const corpo  = payload.notification?.body || '';
      try { new Notification(titulo, { body: corpo }); } catch (_) {}
    });
  } catch (e) {
    console.error('[push] erro ao registrar token:', e);
  }
}
