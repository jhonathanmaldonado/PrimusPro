// ============================================================
// PRIMUS ETIQUETAS - js/ui.js (v1)
// Utilitarios de tela compartilhados (telas, modais, avisos, texto)
// ============================================================

export const $ = (id) => document.getElementById(id);

export function mostrarTela(id) {
  for (const t of document.querySelectorAll(".tela")) t.hidden = t.id !== id;
  window.scrollTo(0, 0);
}

export function mostrarErro(idCaixa, msg) {
  const el = $(idCaixa);
  el.textContent = msg || "";
  el.hidden = !msg;
}

export function ocupado(botao, sim, textoOcupado) {
  if (sim) {
    botao.dataset.texto = botao.textContent;
    botao.textContent = textoOcupado || "Aguarde...";
    botao.disabled = true;
  } else {
    botao.textContent = botao.dataset.texto || botao.textContent;
    botao.disabled = false;
  }
}

export function abrirModal(id) {
  $(id).hidden = false;
  $(id).scrollTop = 0;
  document.body.classList.add("com-modal");
}

export function fecharModal(id) {
  $(id).hidden = true;
  if (!document.querySelector(".modal:not([hidden])")) document.body.classList.remove("com-modal");
}

export function fecharTodosModais() {
  for (const m of document.querySelectorAll(".modal")) m.hidden = true;
  document.body.classList.remove("com-modal");
}

let timerAviso = null;
export function aviso(msg) {
  const el = $("aviso");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => { el.hidden = true; }, 3200);
}

export function escapar(texto) {
  return String(texto == null ? "" : texto)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function focarSemRolar(id) {
  const el = $(id);
  if (el) el.focus({ preventScroll: true });
}
