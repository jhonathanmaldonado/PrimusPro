// ===== CONFIG FIREBASE — PRIMUS PEIXARIA =====
// Importa via CDN do Firebase v10 (modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDEo7pB-dLtSHFGjqvYf8Bt8n7VSu5HdrY",
  authDomain: "projeto-primus-9b643.firebaseapp.com",
  projectId: "projeto-primus-9b643",
  storageBucket: "projeto-primus-9b643.firebasestorage.app",
  messagingSenderId: "547842320766",
  appId: "1:547842320766:web:a87b857ce7c2d434cdab2f",
  measurementId: "G-JSZL3TXD7D"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Exporta tudo que os outros arquivos vão usar
export {
  db,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp
};
