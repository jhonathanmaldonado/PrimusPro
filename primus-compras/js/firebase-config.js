// ============================================================================
// CONFIGURAÇÃO DO FIREBASE
// ============================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyC6LrpWnG5b8TjlbEKySJSxqgeaAy9CdnA",
  authDomain: "primus-lista.firebaseapp.com",
  projectId: "primus-lista",
  storageBucket: "primus-lista.firebasestorage.app",
  messagingSenderId: "204346297039",
  appId: "1:204346297039:web:37ca253eb3f353024485ba"
};

// ============================================================================
// CONSTANTES DO APP
// ============================================================================

// ID do workspace (fixo para esta aplicação)
export const WORKSPACE_ID = "primus";

// 🔐 Código de admin para criar a conta do DONO no primeiro acesso.
// Este código aparece SOMENTE na tela de "Criar workspace" — depois de criado,
// não é mais usado. Use uma string única que só você sabe.
// 👉 ALTERE ESTE VALOR antes do primeiro acesso e ANOTE em local seguro.
export const ADMIN_CODE = "Deus@@100";

// Domínio fictício usado para gerar emails técnicos (não precisa ser real)
export const EMAIL_DOMAIN = "primus.local";

// Limite de tentativas falhas antes de bloquear
export const MAX_TENTATIVAS = 5;

// Tempo de bloqueio após excesso de tentativas (em minutos)
export const BLOQUEIO_MINUTOS = 15;
