// ============================================================================
// FIREBASE-INIT.JS — Inicialização única do Firebase
// ============================================================================
// Este arquivo é importado por todos os outros módulos para garantir que o
// Firebase seja inicializado UMA VEZ SÓ, antes de qualquer uso.
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

import { firebaseConfig } from './firebase-config.js';

// Inicializa Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
