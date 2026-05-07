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
    await setDoc(userRef, {
