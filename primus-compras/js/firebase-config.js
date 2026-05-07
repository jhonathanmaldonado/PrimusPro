// ============================================================================
// CONFIGURAÇÃO DO FIREBASE
// ============================================================================
// 👉 SUBSTITUA os valores abaixo pelos da sua configuração do Firebase.
// Você encontra em: Console Firebase → ⚙️ → Configurações do projeto →
//                   Seus apps → Configuração do SDK
// ============================================================================

export const firebaseConfig = {
  apiKey: "COLE_AQUI_SUA_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJECT_ID",
  storageBucket: "SEU_PROJETO.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID"
};

// ============================================================================
// CONSTANTES DO APP
// ============================================================================

// ID do workspace (fixo para esta aplicação)
export const WORKSPACE_ID = "primus";

// 🔐 Código de admin para criar a conta do DONO no primeiro acesso.
// Este código aparece SOMENTE na tela de "Criar workspace" — depois de criado,
// não é mais usado. Use uma string única que só você sabe.
// 👉 ALTERE ESTE VALOR antes do deploy.
export const ADMIN_CODE = "PRIMUS-DONO-2026";

// Domínio fictício usado para gerar emails técnicos (não precisa ser real)
export const EMAIL_DOMAIN = "primus.local";

// Limite de tentativas falhas antes de bloquear
export const MAX_TENTATIVAS = 5;

// Tempo de bloqueio após excesso de tentativas (em minutos)
export const BLOQUEIO_MINUTOS = 15;
