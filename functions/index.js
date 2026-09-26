// ===== CLOUD FUNCTIONS — PRIMUS (notificações push) =====
// Dispara uma notificação para os gestores quando uma contagem é salva.
// Lê os tokens de primus_push_tokens e envia via FCM.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

const REGIAO = "southamerica-east1"; // mesma região do Firestore

// Telegram — token e chat id guardados como SECRETS (firebase functions:secrets:set),
// nunca no código/GitHub. Só ligados a esta função e lidos em runtime com .value().
const { defineSecret } = require("firebase-functions/params");
const TELEGRAM_TOKEN = defineSecret("TELEGRAM_TOKEN");
const TELEGRAM_CHAT_ID = defineSecret("TELEGRAM_CHAT_ID");

const TIPO_LABEL = { ini: "INÍCIO", fin: "FINAL", sorv: "SORVETE" };

function formatarDataBR(iso) {
  if (!iso || typeof iso !== "string") return iso || "";
  const partes = iso.split("-"); // YYYY-MM-DD
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}`; // DD/MM
}

// Lê todos os tokens salvos (1 doc por gestor)
async function lerTokens() {
  const snap = await db.collection("primus_push_tokens").get();
  const tokens = [];
  const refs = [];
  snap.forEach((d) => {
    const t = d.data().token;
    if (t && typeof t === "string") {
      tokens.push(t);
      refs.push(d.ref);
    }
  });
  return { tokens, refs };
}

// Envia para vários tokens e remove os que já não valem mais
async function enviarPush(titulo, corpo) {
  const { tokens, refs } = await lerTokens();
  if (!tokens.length) {
    console.log("[push] nenhum token cadastrado — nada a enviar");
    return;
  }

  const resp = await getMessaging().sendEachForMulticast({
    notification: { title: titulo, body: corpo },
    tokens,
  });

  console.log(`[push] enviadas: ${resp.successCount} | falhas: ${resp.failureCount}`);

  // Limpa tokens inválidos/expirados (aparelho desinstalou, token rotacionou, etc.)
  const remover = [];
  resp.responses.forEach((r, i) => {
    if (!r.success) {
      const code = (r.error && r.error.code) || "";
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        remover.push(refs[i]);
      }
    }
  });
  for (const ref of remover) {
    await ref.delete().catch(() => {});
  }
  if (remover.length) console.log(`[push] removidos ${remover.length} token(s) inválido(s)`);
}

// ===== IDEMPOTÊNCIA =====
// O Firestore Gen2 entrega eventos com garantia "at-least-once": o MESMO evento
// pode chegar 2+ vezes, disparando notificações repetidas mesmo com 1 token e 1
// função. Guardamos o event.id numa coleção de controle (transação atômica): se
// já foi processado, ignora. Em erro, prefere enviar (não perder aviso).
async function jaProcessado(eventId) {
  if (!eventId) return false;
  const ref = db.collection("primus_push_dedup").doc(String(eventId));
  try {
    const novo = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;            // já existe = entrega repetida
      tx.set(ref, { em: new Date().toISOString() });
      return true;                              // primeira vez
    });
    return !novo;
  } catch (e) {
    console.error("[dedup] erro na transação:", e);
    return false;
  }
}

// ===== VIRADA D-1 VIA TELEGRAM =====
// Quando o INÍCIO de hoje é lançado, compara com o FINAL do dia operacional
// anterior (último 'fin' antes desta data) e manda a lista de itens com diferença.
// Mesma conta da auditoria: início − (final − consumo interno do dia anterior).

// Nome legível a partir do slug (ex: "heineken_600ml" -> "Heineken 600ml").
function nomeLegivel(slug) {
  const upper = new Set(["ks", "pdv", "gv", "kids", "c"]);
  return String(slug)
    .split("_")
    .filter(Boolean)
    .map((w) => (upper.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// Total por slug — mesma lógica do extrairEstoque do front (usa o total salvo).
function extrairEstoque(contagem) {
  const estoque = {};
  const itens = (contagem && contagem.itens) || {};
  Object.entries(itens).forEach(([chave, v]) => {
    if (!v || typeof v !== "object") return;
    if (chave.endsWith("__fin")) { estoque[chave.replace(/__fin$/, "")] = v.final || 0; return; }
    if (chave.endsWith("__ini")) { estoque[chave.replace(/__ini$/, "")] = v.qtd || 0; return; }
    const total = (typeof v.total === "number" && v.total > 0)
      ? v.total
      : (v.est || v.estoque || 0) + (v.frPrinc || 0) + (v.frAux || 0) + (v.fr || v.freezer || 0);
    estoque[chave] = total;
  });
  return estoque;
}

async function enviarTelegram(token, chatId, texto) {
  if (!token || !chatId) { console.error("[telegram] token/chatId ausente (secrets)"); return; }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: "HTML" }),
    });
    if (!resp.ok) console.error("[telegram] falha:", resp.status, await resp.text().catch(() => ""));
  } catch (e) {
    console.error("[telegram] erro de rede:", e);
  }
}

async function enviarDiferencasD1(cIni, token, chatId) {
  const dataIni = cIni && cIni.data;
  if (!dataIni) return;

  // Último FIN lançado ANTES da data do início (dia operacional anterior).
  const finSnap = await db.collection("primus_contagens").where("tipo", "==", "fin").get();
  let finAnt = null;
  finSnap.forEach((d) => {
    const c = d.data();
    if (!c.data || c.data >= dataIni) return;
    const maisNovo = !finAnt
      || c.data > finAnt.data
      || (c.data === finAnt.data && ((c.criadoEm && c.criadoEm.toMillis && c.criadoEm.toMillis()) || 0) > ((finAnt.criadoEm && finAnt.criadoEm.toMillis && finAnt.criadoEm.toMillis()) || 0));
    if (maisNovo) finAnt = c;
  });
  if (!finAnt) { console.log("[D-1] sem FIN anterior — nada a comparar"); return; }

  // Consumo interno do dia do FIN anterior (abatido do final, como na auditoria).
  let consumoAnt = {};
  try {
    const cs = await db.collection("primus_consumo_interno").doc(finAnt.data).get();
    if (cs.exists) consumoAnt = cs.data().itens || {};
  } catch (_) { /* sem consumo, segue */ }

  const iniPorSlug = extrairEstoque(cIni);
  const fimPorSlug = extrairEstoque(finAnt);

  const linhas = [];
  new Set([...Object.keys(iniPorSlug), ...Object.keys(fimPorSlug)]).forEach((slug) => {
    const fimAdj = (fimPorSlug[slug] || 0) - (consumoAnt[slug] || 0);
    const ini = iniPorSlug[slug] || 0;
    const dif = ini - fimAdj;
    if (dif !== 0) linhas.push({ nome: nomeLegivel(slug), fim: fimAdj, ini, dif });
  });
  linhas.sort((a, b) => a.dif - b.dif); // maior sumiço (mais negativo) primeiro

  const fmt = (iso) => { const p = String(iso).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}` : iso; };
  const dataFmt = fmt(dataIni);
  const finFmt = fmt(finAnt.data);

  let texto;
  if (!linhas.length) {
    texto = `\u2705 <b>Virada D-1 \u2014 ${dataFmt}</b>\nTudo bateu! Nenhuma diferen\u00e7a entre o final de ${finFmt} e o in\u00edcio de hoje.`;
  } else {
    const corpo = linhas.map((l) => {
      const sinal = l.dif > 0 ? `+${l.dif}` : `${l.dif}`;
      const emoji = l.dif < 0 ? "\ud83d\udd34" : "\ud83d\udfe1";
      return `${emoji} <b>${l.nome}</b>: ${sinal}  <i>(fim ${l.fim} \u2192 in\u00ed ${l.ini})</i>`;
    }).join("\n");
    texto = `\ud83d\udcca <b>Virada D-1 \u2014 ${dataFmt}</b>\nFinal de ${finFmt} \u00d7 in\u00edcio de hoje.\n\n${corpo}\n\n\ud83d\udd34 faltou \u00b7 \ud83d\udfe1 sobrou`;
  }

  await enviarTelegram(token, chatId, texto);
}

// Campos de sorvete por slug (ini e fin separados, da folha 'sorv').
function extrairCamposSorvetes(contagem) {
  const out = {};
  const itens = (contagem && contagem.itens) || {};
  Object.entries(itens).forEach(([chave, v]) => {
    if (!v || typeof v !== "object") return;
    if (chave.endsWith("__ini")) {
      const slug = chave.replace(/__ini$/, "");
      (out[slug] = out[slug] || {}).ini = v.qtd || 0;
    } else if (chave.endsWith("__fin")) {
      const slug = chave.replace(/__fin$/, "");
      out[slug] = out[slug] || {};
      out[slug].fin = v.final || 0;
      out[slug].abast = v.abast || 0;
    }
  });
  return out;
}

// Virada D-1 dos SORVETES/EMBALAGENS: dispara ao lançar a folha 'sorv'.
// Compara o início desta folha com o FINAL da folha de sorvete anterior.
// (Sem desconto de consumo — igual à auditoria de virada dos sorvetes.)
async function enviarDiferencasD1Sorvetes(cSorv, token, chatId) {
  const dataAtual = cSorv && cSorv.data;
  if (!dataAtual) return;

  const snap = await db.collection("primus_contagens").where("tipo", "==", "sorv").get();
  let sorvAnt = null;
  snap.forEach((d) => {
    const c = d.data();
    if (!c.data || c.data >= dataAtual) return;
    const maisNovo = !sorvAnt
      || c.data > sorvAnt.data
      || (c.data === sorvAnt.data && ((c.criadoEm && c.criadoEm.toMillis && c.criadoEm.toMillis()) || 0) > ((sorvAnt.criadoEm && sorvAnt.criadoEm.toMillis && sorvAnt.criadoEm.toMillis()) || 0));
    if (maisNovo) sorvAnt = c;
  });
  if (!sorvAnt) { console.log("[D-1 sorv] sem folha anterior \u2014 nada a comparar"); return; }

  const atu = extrairCamposSorvetes(cSorv);
  const ant = extrairCamposSorvetes(sorvAnt);

  const linhas = [];
  new Set([...Object.keys(atu), ...Object.keys(ant)]).forEach((slug) => {
    const fimAnterior = (ant[slug] && ant[slug].fin) || 0;
    const iniAtual = (atu[slug] && atu[slug].ini) || 0;
    const dif = iniAtual - fimAnterior;
    if (dif !== 0) linhas.push({ nome: nomeLegivel(slug), fim: fimAnterior, ini: iniAtual, dif });
  });
  linhas.sort((a, b) => a.dif - b.dif);

  const fmt = (iso) => { const p = String(iso).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}` : iso; };
  const dataFmt = fmt(dataAtual);
  const finFmt = fmt(sorvAnt.data);

  let texto;
  if (!linhas.length) {
    texto = `\u2705 <b>Virada D-1 Sorvetes/Embalagens \u2014 ${dataFmt}</b>\nTudo bateu! Nenhuma diferen\u00e7a entre o final de ${finFmt} e o in\u00edcio de hoje.`;
  } else {
    const corpo = linhas.map((l) => {
      const sinal = l.dif > 0 ? `+${l.dif}` : `${l.dif}`;
      const emoji = l.dif < 0 ? "\ud83d\udd34" : "\ud83d\udfe1";
      return `${emoji} <b>${l.nome}</b>: ${sinal}  <i>(fim ${l.fim} \u2192 in\u00ed ${l.ini})</i>`;
    }).join("\n");
    texto = `\ud83c\udf68 <b>Virada D-1 Sorvetes/Embalagens \u2014 ${dataFmt}</b>\nFinal de ${finFmt} \u00d7 in\u00edcio de hoje.\n\n${corpo}\n\n\ud83d\udd34 faltou \u00b7 \ud83d\udfe1 sobrou`;
  }
  await enviarTelegram(token, chatId, texto);
}

// ===== DIFERENÇA DO DIA (auditoria operacional) VIA TELEGRAM =====
// Quando o dia fica COMPLETO, manda a diferença de cada item:
//   BEBIDAS:   INÍCIO + recebido − vendido − consumo interno  × FINAL contado
//   SORVETES/EMBALAGENS: folha 'sorv' (início + abast − vendido − consumo × final)
// É a MESMA conta de calcularAuditoriaOperacional / calcularAuditoriaSorvetes
// (primus-sistema/js/auditoria.js) — se mudar lá, mudar aqui também.
//
// "Completo" = bebidas: ini + fin + vendas do dia · sorvetes: sorv + vendas do dia.
// Proteção contra venda PARCIAL (/vendas hoje no meio do expediente): a seção só
// sai se as vendas foram gravadas DEPOIS da contagem final correspondente.
// Não repete: guarda um hash da última mensagem enviada por dia; se o conteúdo
// não mudou (ex.: /vendas rodado de novo com os mesmos dados), não reenvia.

// --- Catálogo base: CÓPIA de primus-sistema/js/produtos.js (BEBIDAS e SORVETES).
// Produto novo criado pelo painel NÃO precisa vir pra cá (vem dos overrides).
// Só atualizar esta lista se alguém editar o produtos.js no código.
const CATALOGO_BEBIDAS = [
  { nome: "Louvada Primus", grupo: "🍺 Cervejas" },
  { nome: "Heineken 600ml", grupo: "🍺 Cervejas" },
  { nome: "Original", grupo: "🍺 Cervejas" },
  { nome: "Heineken Zero Long Neck", grupo: "🍺 Cervejas" },
  { nome: "Louvada German", grupo: "🍺 Cervejas" },
  { nome: "Louvada Hop Zero", grupo: "🍺 Cervejas" },
  { nome: "Stella SG Longneck", grupo: "🍺 Cervejas" },
  { nome: "Coca Cola KS", grupo: "🔷 Refrigerantes KS" },
  { nome: "Coca Cola KS Zero", grupo: "🔷 Refrigerantes KS" },
  { nome: "Fanta Laranja KS", grupo: "🔷 Refrigerantes KS" },
  { nome: "Sprite KS", grupo: "🔷 Refrigerantes KS" },
  { nome: "Kuat KS", grupo: "🔷 Refrigerantes KS" },
  { nome: "Coca Cola Lata", grupo: "🥤 Refrigerantes" },
  { nome: "Coca Cola Zero Lata", grupo: "🥤 Refrigerantes" },
  { nome: "Fanta Laranja Lata", grupo: "🥤 Refrigerantes" },
  { nome: "Água Tônica", grupo: "💧 Especiais" },
  { nome: "Schweppes Citrus", grupo: "💧 Especiais" },
  { nome: "Sprite Lemon Fresch", grupo: "💧 Especiais" },
  { nome: "Água Prata Com Gás", grupo: "💧 Águas" },
  { nome: "Água Prata Sem Gás", grupo: "💧 Águas" },
  { nome: "Água Premium Com Gás", grupo: "💧 Águas" },
  { nome: "Água Premium Sem Gás", grupo: "💧 Águas" },
  { nome: "Kombucha Guaraná", grupo: "🌿 Kombuchas" },
  { nome: "Kombucha Morango", grupo: "🌿 Kombuchas" },
  { nome: "Kombucha de Limão", grupo: "🌿 Kombuchas" },
  { nome: "Cappuccino", grupo: "☕ Cafés" },
  { nome: "Café Ameno", grupo: "☕ Cafés" },
  { nome: "Café Forza", grupo: "☕ Cafés" },
  { nome: "Café Gourmet", grupo: "☕ Cafés" },
  { nome: "Suco Acerola 500ml", grupo: "🧃 Sucos 500ml" },
  { nome: "Suco Abacaxi Hort. 500ml", grupo: "🧃 Sucos 500ml" },
  { nome: "Suco Maracujá 500ml", grupo: "🧃 Sucos 500ml" },
  { nome: "Suco Morango 500ml", grupo: "🧃 Sucos 500ml" },
];
const CATALOGO_SORVETES = [
  { nome: "Sorbet Moranja", grupo: "🍨 Sorbets" },
  { nome: "Sorbet Manga+Maracujá", grupo: "🍨 Sorbets" },
  { nome: "Sorbet Frutas Vermelhas", grupo: "🍨 Sorbets" },
  { nome: "Gelato Doce de Leite", grupo: "🍦 Gelatos" },
  { nome: "Gelato Chocolatudo", grupo: "🍦 Gelatos" },
  { nome: "Gelato Iogurte+Frutas Amarelas", grupo: "🍦 Gelatos" },
  { nome: "Gelato Cacau com Laranja 0%", grupo: "🍦 Gelatos" },
  { nome: "Gelato Ninho Trufado", grupo: "🍦 Gelatos" },
  { nome: "Gelato Paçoca Proteica", grupo: "🍦 Gelatos" },
  { nome: "Chocolate Proteico", grupo: "🍦 Gelatos" },
  { nome: "Gelato Cookie e Crean Proteico", grupo: "🍦 Gelatos" },
  { nome: "Embalagem P", grupo: "📦 Embalagens" },
  { nome: "Embalagem M", grupo: "📦 Embalagens" },
  { nome: "Embalagem G", grupo: "📦 Embalagens" },
  { nome: "Kit Festa", grupo: "📦 Embalagens" },
  { nome: "Espátula Descartável", grupo: "📦 Embalagens" },
];

// Idêntico ao slugify de produtos.js (é o que casa nome do PDV com a contagem).
function slugify(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Mesmo merge do produtos-store.js (base + editados + novos; tira ocultos).
function aplicarOverridesCatalogo(listaBase, ov, tipo) {
  const editados = ov.editados || {};
  const ocultos = new Set(ov.ocultos || []);
  const novos = (ov.novos || []).filter((n) => (n._tipo || "bebidas") === tipo);
  const efetiva = listaBase.map((p) => {
    const slug = slugify(p.nome);
    const merged = editados[slug] ? { ...p, ...editados[slug] } : { ...p };
    merged._slug = slug;
    merged._oculto = ocultos.has(slug);
    return merged;
  });
  novos.forEach((n) => {
    const slug = slugify(n.nome);
    efetiva.push({ ...n, _slug: slug, _oculto: ocultos.has(slug) });
  });
  return efetiva.filter((p) => !p._oculto);
}

async function lerCatalogoEfetivo() {
  let ov = {};
  try {
    const s = await db.collection("primus_produtos").doc("overrides").get();
    if (s.exists) ov = s.data() || {};
  } catch (e) {
    console.error("[diferenca] erro lendo overrides (usa só o catálogo base):", e);
  }
  return {
    bebidas: aplicarOverridesCatalogo(CATALOGO_BEBIDAS, ov, "bebidas"),
    sorvetes: aplicarOverridesCatalogo(CATALOGO_SORVETES, ov, "sorvetes"),
  };
}

// Vínculos de venda — cópia de somarVinculosDeVenda (auditoria.js).
function somarVinculosDeVenda(catalogo, vendidoPorSlug) {
  const extras = {};
  (catalogo || []).forEach((item) => {
    const vincs = item && item.vinculos;
    if (!Array.isArray(vincs) || !vincs.length) return;
    const slugItem = slugify(item.nome);
    let soma = 0;
    vincs.forEach((v) => {
      if (!v || !v.nome) return;
      const slugV = slugify(v.nome);
      if (slugV === slugItem) return;
      const f = Number(v.fator);
      const fator = (isFinite(f) && f > 0) ? f : 1;
      soma += (vendidoPorSlug[slugV] || 0) * fator;
    });
    if (soma > 0) extras[slugItem] = Math.round(soma);
  });
  Object.entries(extras).forEach(([slug, qtd]) => {
    vendidoPorSlug[slug] = (vendidoPorSlug[slug] || 0) + qtd;
  });
  return extras;
}

function vendidoPorSlugDe(vendasDia) {
  const out = {};
  ((vendasDia && vendasDia.produtos) || []).forEach((p) => {
    const s = slugify(p.nome);
    out[s] = (out[s] || 0) + (p.qtd || 0);
  });
  return out;
}

// Estoque por slug — cópia EXATA do extrairEstoque da auditoria.js (a tela).
// (O extrairEstoque lá de cima é o da virada D-1; não misturar.)
function extrairEstoqueAuditoria(contagem) {
  const estoque = {};
  Object.entries((contagem && contagem.itens) || {}).forEach(([chave, v]) => {
    if (typeof v !== "object" || v === null) return;
    if (chave.endsWith("__fin")) { estoque[chave.replace(/__fin$/, "")] = v.final || 0; return; }
    const total = (typeof v.total === "number" && v.total > 0)
      ? v.total
      : (v.fr || v.freezer || 0) + (v.est || v.estoque || 0);
    estoque[chave] = total;
  });
  return estoque;
}

// Status igual à auditoria: ≥5 crítico, ≥2 atenção, ≥1 leve.
function statusPorDif(dif) {
  const a = Math.abs(dif);
  return a >= 5 ? "critico" : a >= 2 ? "atencao" : a >= 1 ? "leve" : "ok";
}

// MOTOR — bebidas (calcularAuditoriaOperacional)
function calcularDiferencaBebidas(cIni, cFin, vendasDia, recebimentos, consumoDia, bebidas) {
  const estIni = extrairEstoqueAuditoria(cIni);
  const estFin = extrairEstoqueAuditoria(cFin);

  const recebido = {};
  recebimentos.forEach((r) => (r.itens || []).forEach((i) => {
    recebido[i.slug] = (recebido[i.slug] || 0) + (i.qtd || 0);
  }));
  Object.entries(cFin.itens || {}).forEach(([chave, v]) => {
    if (typeof v !== "object" || v === null || chave.includes("__")) return;
    if ((v.rec || 0) > 0) recebido[chave] = (recebido[chave] || 0) + v.rec;
  });

  const vendido = vendidoPorSlugDe(vendasDia);
  somarVinculosDeVenda(bebidas, vendido);

  return bebidas.map((b) => {
    const slug = slugify(b.nome);
    const ini = estIni[slug] || 0;
    const fin = estFin[slug] || 0;
    const rec = recebido[slug] || 0;
    const ven = vendido[slug] || 0;
    const con = consumoDia[slug] || 0;
    const esperado = ini + rec - ven - con;
    const diferenca = fin - esperado;
    const semDados = ini === 0 && fin === 0 && rec === 0 && ven === 0;
    return { nome: b.nome, grupo: b.grupo || "", esperado, real: fin, diferenca,
      status: semDados ? "semdados" : statusPorDif(diferenca) };
  });
}

// MOTOR — sorvetes/embalagens (calcularAuditoriaSorvetes)
function calcularDiferencaSorvetes(cSorv, vendasDia, consumoDia, sorvetes) {
  const campos = extrairCamposSorvetes(cSorv);
  const vendido = vendidoPorSlugDe(vendasDia);
  somarVinculosDeVenda(sorvetes, vendido);

  return sorvetes.map((s) => {
    const slug = slugify(s.nome);
    const c = campos[slug] || {};
    const ini = c.ini || 0;
    const abast = c.abast || 0;
    const fin = c.fin || 0;
    const ven = vendido[slug] || 0;
    const con = consumoDia[slug] || 0;
    const esperado = ini + abast - ven - con;
    const diferenca = fin - esperado;
    const semDados = ini === 0 && fin === 0 && abast === 0 && ven === 0 && con === 0;
    return { nome: s.nome, grupo: s.grupo || "", esperado, real: fin, diferenca,
      status: semDados ? "semdados" : statusPorDif(diferenca) };
  });
}

// ---------- montagem da mensagem ----------
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtNum(n) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
}

function blocoSecao(titulo, linhas) {
  const dif = linhas.filter((r) => r.status !== "semdados" && Math.round(r.diferenca * 100) !== 0);
  if (!dif.length) return `${titulo}\n\u2705 Tudo bateu!`;
  dif.sort((a, b) => a.diferenca - b.diferenca); // maior falta primeiro
  const corpo = dif.map((r) => {
    const sinal = r.diferenca > 0 ? `+${fmtNum(r.diferenca)}` : fmtNum(r.diferenca);
    const emoji = r.diferenca < 0 ? "\ud83d\udd34" : "\ud83d\udfe1";
    const alerta = r.status === "critico" ? " \u26a0\ufe0f" : "";
    return `${emoji} <b>${escHtml(r.nome)}</b>: ${sinal}${alerta}  <i>(esperado ${fmtNum(r.esperado)} \u2192 contado ${fmtNum(r.real)})</i>`;
  }).join("\n");
  return `${titulo}\n${corpo}`;
}

const msDe = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);
const momentoContagem = (c) => Math.max(msDe(c && c.criadoEm), msDe(c && c.editadoEm));

// Monta o texto da diferença do dia (ou null se nada estiver completo).
async function montarDiferencaDia(dia) {
  const vSnap = await db.collection("primus_vendas").doc(dia).get();
  if (!vSnap.exists) { console.log(`[diferenca ${dia}] sem vendas — aguardando`); return null; }
  const vendasDia = vSnap.data() || {};
  const vendasMs = msDe(vendasDia.atualizadoEm); // 0 = sem horário → não bloqueia

  // Contagem mais recente de cada tipo no dia (igual à auditoria).
  const cSnap = await db.collection("primus_contagens").where("data", "==", dia).get();
  const ultima = {};
  cSnap.forEach((d) => {
    const c = d.data();
    if (!c || !c.tipo) return;
    if (!ultima[c.tipo] || msDe(c.criadoEm) > msDe(ultima[c.tipo].criadoEm)) ultima[c.tipo] = c;
  });
  const cIni = ultima.ini, cFin = ultima.fin, cSorv = ultima.sorv;

  const vendaAtrasada = (c) => vendasMs > 0 && vendasMs < momentoContagem(c);
  const avisoParcial = "vendas gravadas antes da contagem final (parcial) \u2014 mande /vendas de novo";

  const temBebidas = !!(cIni && cFin) && !vendaAtrasada(cFin);
  const temSorvetes = !!cSorv && !vendaAtrasada(cSorv);
  if (!temBebidas && !temSorvetes) {
    console.log(`[diferenca ${dia}] dia ainda incompleto (ini:${!!cIni} fin:${!!cFin} sorv:${!!cSorv} vendas-parcial:${cFin ? vendaAtrasada(cFin) : "-"})`);
    return null;
  }

  const catalogo = await lerCatalogoEfetivo();
  let consumoDia = {};
  try {
    const cs = await db.collection("primus_consumo_interno").doc(dia).get();
    if (cs.exists) consumoDia = cs.data().itens || {};
  } catch (_) { /* sem consumo, segue */ }

  const partes = [];

  if (temBebidas) {
    const recebimentos = [];
    const rSnap = await db.collection("primus_compras").where("tipo", "==", "recebimento").get();
    rSnap.forEach((d) => { const r = d.data(); if (r.data === dia) recebimentos.push(r); });
    const linhas = calcularDiferencaBebidas(cIni, cFin, vendasDia, recebimentos, consumoDia, catalogo.bebidas);
    partes.push(blocoSecao("\ud83c\udf7a <b>Bebidas</b>", linhas));
  } else if (cIni && cFin) {
    partes.push(`\ud83c\udf7a <b>Bebidas</b>\n\u23f3 ${avisoParcial}`);
  } else {
    const falta = [!cIni && "IN\u00cdCIO", !cFin && "FINAL"].filter(Boolean).join(" e ");
    partes.push(`\ud83c\udf7a <b>Bebidas</b>\n\u23f3 aguardando contagem de ${falta}`);
  }

  if (temSorvetes) {
    const linhas = calcularDiferencaSorvetes(cSorv, vendasDia, consumoDia, catalogo.sorvetes);
    const ehEmb = (r) => /embalage/i.test(r.grupo);
    partes.push(blocoSecao("\ud83c\udf68 <b>Sorvetes</b>", linhas.filter((r) => !ehEmb(r))));
    partes.push(blocoSecao("\ud83d\udce6 <b>Embalagens</b>", linhas.filter(ehEmb)));
  } else if (cSorv) {
    partes.push(`\ud83c\udf68 <b>Sorvetes e embalagens</b>\n\u23f3 ${avisoParcial}`);
  } else {
    partes.push("\ud83c\udf68 <b>Sorvetes e embalagens</b>\n\u23f3 aguardando a folha de sorvete");
  }

  const p = dia.split("-");
  const dataFmt = p.length === 3 ? `${p[2]}/${p[1]}` : dia;
  return `\ud83d\udccb <b>Diferen\u00e7a do dia \u2014 ${dataFmt}</b>\n` +
    `<i>in\u00edcio + entradas \u2212 vendas \u2212 consumo \u00d7 final contado</i>\n\n` +
    partes.join("\n\n") +
    `\n\n\ud83d\udd34 faltou \u00b7 \ud83d\udfe1 sobrou \u00b7 \u26a0\ufe0f cr\u00edtico (5+)`;
}

async function verificarDiferencaDia(dia) {
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
  const texto = await montarDiferencaDia(dia);
  if (!texto) return;

  // Não reenvia a mesma mensagem (mesmo conteúdo) pro mesmo dia.
  const hash = require("crypto").createHash("sha1").update(texto).digest("hex");
  const ref = db.collection("primus_push_dedup").doc(`diferenca_${dia}`);
  const ant = await ref.get();
  if (ant.exists && ant.data().hash === hash) {
    console.log(`[diferenca ${dia}] conteúdo igual ao último envio — não reenvia`);
    return;
  }
  await enviarTelegram(TELEGRAM_TOKEN.value(), TELEGRAM_CHAT_ID.value(), texto);
  await ref.set({ hash, em: new Date().toISOString() });
}

// Nunca deixa erro da diferença derrubar o resto do gatilho.
async function verificarDiferencaDiaSeguro(dia) {
  try {
    await verificarDiferencaDia(dia);
  } catch (e) {
    console.error(`[diferenca ${dia}] erro:`, e);
  }
}

// ===== GATILHO: contagem criada OU atualizada =====
// onDocumentWritten pega create E update — pra notificar também quando a contagem
// é substituída/editada (que virou update depois de liberarmos update nas regras).
// Delete é ignorado; correção do gestor (origem='correcao') continua sem notificar.
exports.notificarContagem = onDocumentWritten(
  { document: "primus_contagens/{id}", region: REGIAO, secrets: [TELEGRAM_TOKEN, TELEGRAM_CHAT_ID] },
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return; // delete (ou sem doc) → ignora

    const c = after.data() || {};

    // Ignora entregas repetidas do mesmo evento (at-least-once do Gen2).
    if (await jaProcessado(event.id)) {
      console.log("[notificarContagem] evento repetido, ignorando:", event.id);
      return;
    }

    // Correções/edições do gestor NÃO notificam push/D-1 (não são contagens novas),
    // mas a DIFERENÇA DO DIA é recalculada (se mudou, chega a versão corrigida).
    if (c.origem === "correcao") {
      console.log("[notificarContagem] doc é correção — só recalcula diferença do dia");
      await verificarDiferencaDiaSeguro(c.data);
      return;
    }

    const tipo = TIPO_LABEL[c.tipo] || (c.tipo || "contagem");
    const dataFmt = formatarDataBR(c.data);
    const autor = c.autorNome || "Alguém";

    const titulo = "Contagem registrada 🐟";
    const corpo = `${autor} lançou a contagem de ${tipo} de ${dataFmt}.`;

    try {
      await enviarPush(titulo, corpo);
    } catch (e) {
      console.error("[notificarContagem] erro:", e);
    }

    // INÍCIO do dia: manda no Telegram a virada D-1 das bebidas (final anterior × início).
    if (c.tipo === "ini") {
      try {
        await enviarDiferencasD1(c, TELEGRAM_TOKEN.value(), TELEGRAM_CHAT_ID.value());
      } catch (e) {
        console.error("[D-1 telegram] erro:", e);
      }
    }

    // Folha de SORVETE/EMBALAGEM: manda a virada D-1 dos sorvetes.
    if (c.tipo === "sorv") {
      try {
        await enviarDiferencasD1Sorvetes(c, TELEGRAM_TOKEN.value(), TELEGRAM_CHAT_ID.value());
      } catch (e) {
        console.error("[D-1 sorv telegram] erro:", e);
      }
    }

    // DIFERENÇA DO DIA: se com esta contagem o dia ficou completo, manda.
    await verificarDiferencaDiaSeguro(c.data);
  }
);

// ===== GATILHO: vendas do dia gravadas (robô /vendas ou manual) =====
// Normalmente a venda é a última peça do dia — é aqui que a diferença sai.
exports.notificarVendas = onDocumentWritten(
  { document: "primus_vendas/{dia}", region: REGIAO, secrets: [TELEGRAM_TOKEN, TELEGRAM_CHAT_ID] },
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return; // delete → ignora
    if (await jaProcessado(event.id)) {
      console.log("[notificarVendas] evento repetido, ignorando:", event.id);
      return;
    }
    await verificarDiferencaDiaSeguro(event.params.dia);
  }
);

// ===== LEMBRETE DAS 17h =====
// Todo dia às 17h (horário de Cuiabá), checa as contagens de HOJE e avisa o
// gestor: se faltar alguma, lista o que falta; se estiver tudo, confirma.

// Data de hoje no fuso de Cuiabá, no formato YYYY-MM-DD (en-CA já entrega assim)
function hojeCuiaba() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Cuiaba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

exports.lembrete17h = onSchedule(
  { schedule: "0 17 * * *", timeZone: "America/Cuiaba", region: REGIAO },
  async () => {
    const hoje = hojeCuiaba();

    // Busca as contagens de hoje e vê quais tipos já existem
    const snap = await db.collection("primus_contagens").where("data", "==", hoje).get();
    const feitos = new Set();
    snap.forEach((d) => {
      const t = d.data().tipo;
      if (t) feitos.add(t);
    });

    const faltam = [];
    if (!feitos.has("ini")) faltam.push("INÍCIO");
    if (!feitos.has("fin")) faltam.push("FINAL");
    if (!feitos.has("sorv")) faltam.push("SORVETE");

    let titulo, corpo;
    if (faltam.length === 0) {
      titulo = "Contagens do dia ✅";
      corpo = "Tudo certo! Início, final e sorvete de hoje já foram contados.";
    } else {
      titulo = "Faltam contagens de hoje ⏰";
      corpo = `Ainda não foi feita a contagem de ${faltam.join(", ")}.`;
    }

    try {
      await enviarPush(titulo, corpo);
    } catch (e) {
      console.error("[lembrete17h] erro:", e);
    }
  }
);
