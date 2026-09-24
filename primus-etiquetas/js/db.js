// ============================================================
// PRIMUS ETIQUETAS - js/db.js (v1)
// Firebase: inicializacao, login usuario+PIN, perfil, setup inicial
// Projeto Firebase proprio: primus-etiquetas (independente dos outros sistemas)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, writeBatch, collection, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCrg1urUvvy5IKwNUFxGaUeN0cb1Sfr2wU",
  authDomain: "primus-etiquetas.firebaseapp.com",
  projectId: "primus-etiquetas",
  storageBucket: "primus-etiquetas.firebasestorage.app",
  messagingSenderId: "954447192543",
  appId: "1:954447192543:web:2524c4cb6fdd3896be246a"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ---------------------------------------------------------------- usuario + PIN
// O usuario vira um e-mail interno e o PIN vira a senha (o Firebase exige 6+ caracteres).
// Ninguem ve esse e-mail: a tela so pede usuario e PIN.
const DOMINIO_INTERNO = "primus-etiquetas.app";

export function normalizarUsuario(texto) {
  return String(texto || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9.]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.|\.$/g, "");
}

export function validarUsuario(usuario) {
  if (usuario.length < 3) return "O usuário precisa ter pelo menos 3 letras.";
  if (usuario.length > 20) return "O usuário pode ter no máximo 20 caracteres.";
  return "";
}

export function validarPin(pin) {
  return /^\d{4}$/.test(String(pin || "")) ? "" : "O PIN precisa ter exatamente 4 números.";
}

function usuarioParaEmail(usuario) {
  return `${usuario}@${DOMINIO_INTERNO}`;
}

function pinParaSenha(pin) {
  return `pe-${pin}-primus`;
}

export function traduzirErro(e) {
  const codigo = (e && e.code) || "";
  if (codigo === "auth/invalid-credential" || codigo === "auth/wrong-password" || codigo === "auth/user-not-found" || codigo === "auth/invalid-email")
    return "Usuário ou PIN incorretos.";
  if (codigo === "auth/too-many-requests")
    return "Muitas tentativas erradas. Aguarde alguns minutos e tente de novo.";
  if (codigo === "auth/network-request-failed" || codigo === "unavailable")
    return "Sem conexão com a internet.";
  if (codigo === "auth/email-already-in-use")
    return "Esse usuário já existe.";
  if (codigo === "permission-denied")
    return "Sem permissão para essa ação.";
  return "Erro inesperado: " + (e && e.message ? e.message : String(e));
}

// ---------------------------------------------------------------- setup inicial
export async function setupFeito() {
  const snap = await getDoc(doc(db, "config", "sistema"));
  return snap.exists();
}

// Cria o primeiro gestor. So funciona enquanto config/sistema nao existir (garantido pelas regras).
export async function fazerSetup(nome, usuario, pin) {
  const email = usuarioParaEmail(usuario);
  const senha = pinParaSenha(pin);
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, senha);
  } catch (e) {
    // Se uma tentativa anterior criou o login mas falhou no perfil, entra e completa
    if (e.code === "auth/email-already-in-use") {
      cred = await signInWithEmailAndPassword(auth, email, senha);
    } else {
      throw e;
    }
  }
  const uid = cred.user.uid;
  const lote = writeBatch(db);
  lote.set(doc(db, "usuarios", uid), {
    usuario,
    nome: nome.trim(),
    papel: "gestor",
    ativo: true,
    criadoEm: serverTimestamp(),
    criadoPor: uid
  });
  lote.set(doc(db, "config", "sistema"), {
    setupConcluido: true,
    criadoEm: serverTimestamp(),
    criadoPor: uid
  });
  await lote.commit();
}

// ---------------------------------------------------------------- sessao
export function entrar(usuario, pin) {
  return signInWithEmailAndPassword(auth, usuarioParaEmail(usuario), pinParaSenha(pin));
}

export function sair() {
  return signOut(auth);
}

export function observarSessao(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function carregarPerfil(uid) {
  const snap = await getDoc(doc(db, "usuarios", uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

// ---------------------------------------------------------------- status da impressora
// O agente do PC da cozinha grava agentes/{PC}.ultimoSinal a cada 60 s.
export function observarAgentes(callback, callbackErro) {
  return onSnapshot(collection(db, "agentes"), (snap) => {
    const lista = snap.docs.map((d) => {
      const dados = d.data();
      return {
        id: d.id,
        impressora: dados.impressora || "",
        versao: dados.versao || "",
        ultimoSinal: dados.ultimoSinal && dados.ultimoSinal.toDate ? dados.ultimoSinal.toDate() : null
      };
    });
    callback(lista);
  }, callbackErro);
}
