// ============================================================================
// AUTH.JS — Login, cadastro e proteção anti-brute-force
// ============================================================================

import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
  Timestamp,
  increment
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

import {
  WORKSPACE_ID,
  EMAIL_DOMAIN,
  MAX_TENTATIVAS,
  BLOQUEIO_MINUTOS,
  ADMIN_CODE
} from './firebase-config.js';

const auth = getAuth();
const db = getFirestore();

// ============================================================================
// HELPERS DE CRIPTOGRAFIA
// ============================================================================

/**
 * Gera um segredo aleatório de 24 caracteres.
 * Usado na criação da conta para ser combinado com o PIN.
 */
export function gerarSegredo() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < arr.length; i++) {
    out += chars[arr[i] % chars.length];
  }
  return out;
}

/**
 * Gera a senha real do Firebase Auth a partir do PIN + segredo.
 * Usa SHA-256 para combinar os dois de forma determinística.
 */
export async function derivarSenha(pin, segredo) {
  const dados = pin + ':' + segredo;
  const buffer = new TextEncoder().encode(dados);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArr = Array.from(new Uint8Array(hashBuffer));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normaliza username: minúsculas, sem espaços, só letras/números/underscore.
 */
export function normalizarUsername(s) {
  return (s || '').toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Valida formato do PIN (4 dígitos).
 */
export function validarPin(pin) {
  return /^\d{4}$/.test(pin);
}

/**
 * Valida formato do username (3-20 caracteres, alfanumérico + _).
 */
export function validarUsername(u) {
  return /^[a-z0-9_]{3,20}$/.test(u);
}

// ============================================================================
// LOOKUP PRÉ-LOGIN
// ============================================================================

/**
 * Busca o auth_lookup de um usuário pelo username (lookup público).
 * Retorna { id, ...dados } ou null se não existir.
 */
export async function buscarAuthLookup(username) {
  const usernameNorm = normalizarUsername(username);
  if (!usernameNorm) return null;

  const lookupRef = collection(db, 'workspaces', WORKSPACE_ID, 'auth_lookup');
  const q = query(lookupRef, where('username', '==', usernameNorm));
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const docSnap = snap.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
}

/**
 * Verifica se o usuário está bloqueado por excesso de tentativas.
 */
export function estaBloqueado(lookup) {
  if (!lookup || !lookup.bloqueadoAte) return false;
  const ate = lookup.bloqueadoAte.toDate ? lookup.bloqueadoAte.toDate() : new Date(lookup.bloqueadoAte);
  return ate > new Date();
}

/**
 * Incrementa tentativas falhas e bloqueia se necessário.
 */
async function registrarTentativaFalha(lookupId) {
  const lookupRef = doc(db, 'workspaces', WORKSPACE_ID, 'auth_lookup', lookupId);
  const snap = await getDoc(lookupRef);
  if (!snap.exists()) return;

  const dados = snap.data();
  const novasTentativas = (dados.tentativasFalhas || 0) + 1;

  const update = {
    tentativasFalhas: novasTentativas,
    ultimaTentativa: serverTimestamp()
  };

  if (novasTentativas >= MAX_TENTATIVAS) {
    const bloqueioAte = new Date(Date.now() + BLOQUEIO_MINUTOS * 60 * 1000);
    update.bloqueadoAte = Timestamp.fromDate(bloqueioAte);
  }

  await setDoc(lookupRef, update, { merge: true });
}

/**
 * Zera contador de tentativas após login bem-sucedido.
 */
async function zerarTentativas(lookupId) {
  const lookupRef = doc(db, 'workspaces', WORKSPACE_ID, 'auth_lookup', lookupId);
  await setDoc(lookupRef, {
    tentativasFalhas: 0,
    bloqueadoAte: null,
    ultimaTentativa: serverTimestamp()
  }, { merge: true });
}

// ============================================================================
// LOGIN
// ============================================================================

/**
 * Faz login com username + PIN.
 * Lança erro com .codigo legível em português.
 */
export async function login(username, pin) {
  if (!validarUsername(normalizarUsername(username))) {
    const e = new Error('Nome de usuário inválido');
    e.codigo = 'username_invalido';
    throw e;
  }
  if (!validarPin(pin)) {
    const e = new Error('PIN deve ter 4 dígitos');
    e.codigo = 'pin_invalido';
    throw e;
  }

  // 1. Busca o auth_lookup
  const lookup = await buscarAuthLookup(username);
  if (!lookup) {
    const e = new Error('Usuário não encontrado');
    e.codigo = 'nao_encontrado';
    throw e;
  }

  // 2. Verifica bloqueio
  if (estaBloqueado(lookup)) {
    const ate = lookup.bloqueadoAte.toDate();
    const min = Math.ceil((ate - new Date()) / 60000);
    const e = new Error(`Conta bloqueada por excesso de tentativas. Tente novamente em ${min} minuto(s).`);
    e.codigo = 'bloqueado';
    throw e;
  }

  // 3. Deriva senha real
  const senha = await derivarSenha(pin, lookup.segredo);

  // 4. Tenta login no Firebase Auth
  try {
    const userCred = await signInWithEmailAndPassword(auth, lookup.emailTecnico, senha);
    await zerarTentativas(lookup.id);

    // Atualiza ultimoLogin no perfil
    const userRef = doc(db, 'workspaces', WORKSPACE_ID, 'usuarios', userCred.user.uid);
    await setDoc(userRef, { ultimoLogin: serverTimestamp() }, { merge: true });

    return userCred.user;
  } catch (err) {
    // Login falhou: registra tentativa e relança erro amigável
    await registrarTentativaFalha(lookup.id);
    const e = new Error('PIN incorreto');
    e.codigo = 'pin_incorreto';
    throw e;
  }
}

// ============================================================================
// CADASTRO DO DONO (primeiro acesso)
// ============================================================================

/**
 * Verifica se o workspace já tem um dono cadastrado.
 */
export async function workspaceTemDono() {
  const wsRef = doc(db, 'workspaces', WORKSPACE_ID);
  const snap = await getDoc(wsRef);
  return snap.exists() && snap.data().criadoPor;
}

/**
 * Cria o workspace e o usuário dono.
 * Requer o ADMIN_CODE definido em firebase-config.js.
 */
export async function criarWorkspaceEDono({ adminCode, nomeWorkspace, nome, username, pin }) {
  if (adminCode !== ADMIN_CODE) {
    const e = new Error('Código de administrador inválido');
    e.codigo = 'admin_invalido';
    throw e;
  }

  const usernameNorm = normalizarUsername(username);
  if (!validarUsername(usernameNorm)) {
    const e = new Error('Nome de usuário inválido (use 3-20 letras/números/underscore)');
    e.codigo = 'username_invalido';
    throw e;
  }
  if (!validarPin(pin)) {
    const e = new Error('PIN deve ter 4 dígitos');
    e.codigo = 'pin_invalido';
    throw e;
  }

  // Verifica se já existe dono
  if (await workspaceTemDono()) {
    const e = new Error('Workspace já está configurado. Faça login normalmente.');
    e.codigo = 'ja_existe';
    throw e;
  }

  // Verifica se username já existe (não deveria, mas por segurança)
  const lookupExistente = await buscarAuthLookup(usernameNorm);
  if (lookupExistente) {
    const e = new Error('Este nome de usuário já está em uso');
    e.codigo = 'username_em_uso';
    throw e;
  }

  // Gera segredo e cria conta no Firebase Auth
  const segredo = gerarSegredo();
  const emailTecnico = `${usernameNorm}@${EMAIL_DOMAIN}`;
  const senha = await derivarSenha(pin, segredo);

  const userCred = await createUserWithEmailAndPassword(auth, emailTecnico, senha);
  const uid = userCred.user.uid;

  // Cria workspace root
  const wsRef = doc(db, 'workspaces', WORKSPACE_ID);
  await setDoc(wsRef, {
    nome: nomeWorkspace || 'Peixaria Primus',
    criadoEm: serverTimestamp(),
    criadoPor: uid,
    config: {
      moeda: 'BRL',
      locale: 'pt-BR'
    }
  });

  // Cria usuário dono
  const userRef = doc(db, 'workspaces', WORKSPACE_ID, 'usuarios', uid);
  await setDoc(userRef, {
    nome: nome,
    username: usernameNorm,
    role: 'dono',
    ativo: true,
    emailTecnico: emailTecnico,
    criadoEm: serverTimestamp(),
    ultimoLogin: serverTimestamp()
  });

  // Cria auth_lookup
  const lookupRef = doc(db, 'workspaces', WORKSPACE_ID, 'auth_lookup', uid);
  await setDoc(lookupRef, {
    username: usernameNorm,
    emailTecnico: emailTecnico,
    segredo: segredo,
    tentativasFalhas: 0,
    bloqueadoAte: null,
    ultimaTentativa: null
  });

  return userCred.user;
}

// ============================================================================
// CADASTRO DE NOVO MEMBRO (pelo dono, depois de logado)
// ============================================================================

/**
 * Cria um novo membro do workspace (chamado pelo dono).
 * IMPORTANTE: este fluxo usa createUserWithEmailAndPassword, que faz signOut
 * implícito do dono. Por isso, retornamos a info necessária para o dono refazer
 * login depois.
 *
 * Em uma versão futura, isso deveria ser feito via Cloud Function para não
 * desconectar o admin. Por simplicidade, na v10 avisamos o usuário.
 */
export async function criarMembro({ nome, username, pin, role = 'membro' }) {
  const usernameNorm = normalizarUsername(username);
  if (!validarUsername(usernameNorm)) {
    const e = new Error('Nome de usuário inválido');
    e.codigo = 'username_invalido';
    throw e;
  }
  if (!validarPin(pin)) {
    const e = new Error('PIN deve ter 4 dígitos');
    e.codigo = 'pin_invalido';
    throw e;
  }

  const lookupExistente = await buscarAuthLookup(usernameNorm);
  if (lookupExistente) {
    const e = new Error('Este nome de usuário já está em uso');
    e.codigo = 'username_em_uso';
    throw e;
  }

  const segredo = gerarSegredo();
  const emailTecnico = `${usernameNorm}@${EMAIL_DOMAIN}`;
  const senha = await derivarSenha(pin, segredo);

  // ⚠️ Esta chamada vai fazer signIn do novo usuário automaticamente,
  // desconectando o dono atual. Por isso retornamos uma flag.
  const userCred = await createUserWithEmailAndPassword(auth, emailTecnico, senha);
  const uid = userCred.user.uid;

  await setDoc(doc(db, 'workspaces', WORKSPACE_ID, 'usuarios', uid), {
    nome: nome,
    username: usernameNorm,
    role: role,
    ativo: true,
    emailTecnico: emailTecnico,
    criadoEm: serverTimestamp(),
    ultimoLogin: null
  });

  await setDoc(doc(db, 'workspaces', WORKSPACE_ID, 'auth_lookup', uid), {
    username: usernameNorm,
    emailTecnico: emailTecnico,
    segredo: segredo,
    tentativasFalhas: 0,
    bloqueadoAte: null,
    ultimaTentativa: null
  });

  // Faz logout do novo usuário criado (volta para tela de login)
  await signOut(auth);

  return { uid, username: usernameNorm, precisaReLogin: true };
}

// ============================================================================
// LOGOUT
// ============================================================================

export async function logout() {
  await signOut(auth);
}

// ============================================================================
// OBSERVADOR DE ESTADO DE AUTH
// ============================================================================

/**
 * Carrega o perfil completo do usuário autenticado.
 */
export async function carregarPerfil(uid) {
  const userRef = doc(db, 'workspaces', WORKSPACE_ID, 'usuarios', uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return null;
  return { id: uid, ...snap.data() };
}

/**
 * Registra observador de mudanças de auth.
 * Callback recebe: { user, perfil } ou null (deslogado)
 */
export function observarAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback(null);
      return;
    }
    try {
      const perfil = await carregarPerfil(user.uid);
      callback({ user, perfil });
    } catch (err) {
      console.error('Erro ao carregar perfil:', err);
      callback({ user, perfil: null });
    }
  });
}
