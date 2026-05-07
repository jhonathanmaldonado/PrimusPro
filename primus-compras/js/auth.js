// ============================================================================
// AUTH.JS — Login, cadastro e proteção anti-brute-force
// ============================================================================

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

import { auth, db } from './firebase-init.js';

import {
  WORKSPACE_ID,
  EMAIL_DOMAIN,
  MAX_TENTATIVAS,
  BLOQUEIO_MINUTOS,
  ADMIN_CODE
} from './firebase-config.js';

// ============================================================================
// HELPERS DE CRIPTOGRAFIA
// ============================================================================

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

export async function derivarSenha(pin, segredo) {
  const dados = pin + ':' + segredo;
  const buffer = new TextEncoder().encode(dados);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArr = Array.from(new Uint8Array(hashBuffer));
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function normalizarUsername(s) {
  return (s || '').toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function validarPin(pin) {
  return /^\d{4}$/.test(pin);
}

export function validarUsername(u) {
  return /^[a-z0-9_]{3,20}$/.test(u);
}

// ============================================================================
// LOOKUP PRÉ-LOGIN
// ============================================================================

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

export function estaBloqueado(lookup) {
  if (!lookup || !lookup.bloqueadoAte) return false;
  const ate = lookup.bloqueadoAte.toDate ? lookup.bloqueadoAte.toDate() : new Date(lookup.bloqueadoAte);
  return ate > new Date();
}

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

  const lookup = await buscarAuthLookup(username);
  if (!lookup) {
    const e = new Error('Usuário não encontrado');
    e.codigo = 'nao_encontrado';
    throw e;
  }

  if (estaBloqueado(lookup)) {
    const ate = lookup.bloqueadoAte.toDate();
    const min = Math.ceil((ate - new Date()) / 60000);
    const e = new Error(`Conta bloqueada por excesso de tentativas. Tente novamente em ${min} minuto(s).`);
    e.codigo = 'bloqueado';
    throw e;
  }

  const senha = await derivarSenha(pin, lookup.segredo);

  try {
    const userCred = await signInWithEmailAndPassword(auth, lookup.emailTecnico, senha);
    await zerarTentativas(lookup.id);

    const userRef = doc(db, 'workspaces', WORKSPACE_ID, 'usuarios', userCred.user.uid);
    await setDoc(userRef, { ultimoLogin: serverTimestamp() }, { merge: true });

    return userCred.user;
  } catch (err) {
    await registrarTentativaFalha(lookup.id);
    const e = new Error('PIN incorreto');
    e.codigo = 'pin_incorreto';
    throw e;
  }
}

// ============================================================================
// CADASTRO DO DONO
// ============================================================================

export async function workspaceTemDono() {
  const wsRef = doc(db, 'workspaces', WORKSPACE_ID);
  const snap = await getDoc(wsRef);
  return snap.exists() && snap.data().criadoPor;
}

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

  if (await workspaceTemDono()) {
    const e = new Error('Workspace já está configurado. Faça login normalmente.');
    e.codigo = 'ja_existe';
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

  const userCred = await createUserWithEmailAndPassword(auth, emailTecnico, senha);
  const uid = userCred.user.uid;

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
// CADASTRO DE NOVO MEMBRO
// ============================================================================

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

export async function carregarPerfil(uid) {
  const userRef = doc(db, 'workspaces', WORKSPACE_ID, 'usuarios', uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return null;
  return { id: uid, ...snap.data() };
}

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
      callback({ user, perfil });
    }
  });
}
