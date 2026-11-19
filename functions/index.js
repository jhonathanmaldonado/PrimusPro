// ===== CLOUD FUNCTIONS — PRIMUS (notificações push) =====
// Dispara uma notificação para os gestores quando uma contagem é salva.
// Lê os tokens de primus_push_tokens e envia via FCM.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldPath } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

const REGIAO = "southamerica-east1"; // mesma região do Firestore

// Telegram — token e chat id guardados como SECRETS (firebase functions:secrets:set),
// nunca no código/GitHub. Só ligados a esta função e lidos em runtime com .value().
const { defineSecret } = require("firebase-functions/params");
const TELEGRAM_TOKEN = defineSecret("TELEGRAM_TOKEN");
const TELEGRAM_CHAT_ID = defineSecret("TELEGRAM_CHAT_ID");
// Senha que o Telegram manda no cabecalho de cada chamada do webhook do Primus
// Avisos (setWebhook ... &secret_token=). Sem ela, a funcao recusa a chamada.
const TELEGRAM_WEBHOOK_SECRET = defineSecret("TELEGRAM_WEBHOOK_SECRET");
// Chave da API do Claude (eventos da cidade + leitura do dia na previsão).
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
// Bot separado só da previsão (Primus Previsão): previsão das 7h, /previsao, /pessoas.
const TELEGRAM_PREVISAO_TOKEN = defineSecret("TELEGRAM_PREVISAO_TOKEN");
// Bot "I.A. da Primus": analista de vendas pra conversar/debater (só o dono).
const TELEGRAM_IA_TOKEN = defineSecret("TELEGRAM_IA_TOKEN");

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

async function enviarTelegramPara(token, chatId, texto) {
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

// ===== QUEM RECEBE OS AVISOS =====
// Lista do painel (Usuarios -> Telegram): primus_config/telegram.destinatarios,
// [{ nome, id, avisos }]. Recebe quem estiver com avisos = true, cada um no seu
// privado. Sem lista cadastrada (ou erro ao ler) -> so o chat do secret
// TELEGRAM_CHAT_ID (o dono), como era antes.
async function destinatariosAvisos(chatPadrao) {
  try {
    const snap = await db.collection("primus_config").doc("telegram").get();
    const lista = snap.exists && Array.isArray(snap.data().destinatarios) ? snap.data().destinatarios : [];
    if (!lista.length) return chatPadrao ? [String(chatPadrao)] : [];
    return [...new Set(lista
      .filter((d) => d && d.avisos && /^-?\d{5,20}$/.test(String(d.id || "").trim()))
      .map((d) => String(d.id).trim()))];
  } catch (e) {
    console.error("[telegram] erro lendo a lista de destinatarios (usa o padrao):", e);
    return chatPadrao ? [String(chatPadrao)] : [];
  }
}

// Envia um AVISO pra todos da lista com avisos ligados.
// (chatPadrao = secret TELEGRAM_CHAT_ID, usado so se a lista estiver vazia.)
async function enviarTelegram(token, chatPadrao, texto) {
  const ids = await destinatariosAvisos(chatPadrao);
  if (!ids.length) { console.log("[telegram] ninguem com avisos ligados — nada enviado"); return; }
  for (const id of ids) {
    await enviarTelegramPara(token, id, texto);
  }
  console.log(`[telegram] aviso enviado pra ${ids.length} destinatario(s)`);
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
    // Recontagem feita no INICIO (contagem.js): confirmou o mesmo numero ou corrigiu
    const rc = ((cIni.itens || {})[slug] || {}).recontagem;
    const marca = rc ? (rc.confirmado ? "confirmado" : "corrigido") : "";
    if (dif !== 0) linhas.push({ nome: nomeLegivel(slug), fim: fimAdj, ini, dif, marca });
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
      const marca = l.marca === "confirmado" ? " \u2705" : l.marca === "corrigido" ? " \ud83d\udd01" : "";
      return `${emoji} <b>${l.nome}</b>: ${sinal}${marca}  <i>(fim ${l.fim} \u2192 in\u00ed ${l.ini})</i>`;
    }).join("\n");
    const temMarca = linhas.some((l) => l.marca);
    const legendaRc = temMarca
      ? "\n\u2705 in\u00edcio conferido 2x (o erro tende a ser o FINAL de ontem) \u00b7 \ud83d\udd01 corrigido na recontagem"
      : "";
    texto = `\ud83d\udcca <b>Virada D-1 \u2014 ${dataFmt}</b>\nFinal de ${finFmt} \u00d7 in\u00edcio de hoje.\n\n${corpo}\n\n\ud83d\udd34 faltou \u00b7 \ud83d\udfe1 sobrou${legendaRc}`;
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
// sobDemanda = pedido pelo botao 📋 Diferenca do Primus Avisos: sempre devolve um texto
// (explica o que falta em vez de ficar em silencio) e nao trava venda "parcial"
// (so avisa). O automatico (sobDemanda=false) continua conservador.
async function montarDiferencaDia(dia, sobDemanda = false) {
  const p0 = dia.split("-");
  const dataFmt0 = p0.length === 3 ? `${p0[2]}/${p0[1]}` : dia;
  const vSnap = await db.collection("primus_vendas").doc(dia).get();
  if (!vSnap.exists) {
    console.log(`[diferenca ${dia}] sem vendas — aguardando`);
    return sobDemanda
      ? `\ud83d\udccb <b>Diferen\u00e7a do dia \u2014 ${dataFmt0}</b>\n\n\u23f3 As vendas desse dia ainda n\u00e3o foram lan\u00e7adas. Lance com \ud83d\udcca Vendas primeiro.`
      : null;
  }
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

  // Venda gravada ANTES da contagem = parcial. Excecao: contagem de CORRECAO
  // (ajuste na auditoria) — ela nasce com horario novo, mas as vendas nao ficaram
  // velhas por isso. Sob demanda nao trava: calcula e avisa no topo.
  const atrasadaReal = (c) => !!c && c.origem !== "correcao" && vendasMs > 0 && vendasMs < momentoContagem(c);
  const vendaAtrasada = (c) => !sobDemanda && atrasadaReal(c);
  const avisoParcial = "vendas gravadas antes da contagem final (parcial) \u2014 mande /vendas de novo";

  const temBebidas = !!(cIni && cFin) && !vendaAtrasada(cFin);
  const temSorvetes = !!cSorv && !vendaAtrasada(cSorv);
  if (!temBebidas && !temSorvetes && !sobDemanda) {
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
  const alertaParcial = sobDemanda && (atrasadaReal(cFin) || atrasadaReal(cSorv))
    ? `\u26a0\ufe0f <i>vendas lan\u00e7adas antes da contagem final \u2014 podem estar parciais</i>\n` : "";
  return `\ud83d\udccb <b>Diferen\u00e7a do dia \u2014 ${dataFmt}</b>\n` + alertaParcial +
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

// ===== PRIMUS AVISOS: WEBHOOK (botão 📋 Diferença, /diferenca, /meuid) =====
// O Telegram chama esta URL a cada mensagem/clique no bot Primus Avisos
// (configurado 1x com setWebhook + secret_token). Quem pode usar: qualquer um da
// lista do painel (Usuarios -> Telegram); lista vazia -> so o TELEGRAM_CHAT_ID.
// A diferença usa a MESMA conta do aviso automático, sem trava de repetição.
const BOTAO_DIFERENCA = "\ud83d\udccb Diferen\u00e7a";
const BOTAO_PREVISAO = "\ud83c\udf24 Previs\u00e3o";
const TECLADO_AVISOS = { keyboard: [[{ text: BOTAO_DIFERENCA }]], resize_keyboard: true, is_persistent: true };
const TECLADO_PREVISAO = { keyboard: [[{ text: BOTAO_PREVISAO }]], resize_keyboard: true, is_persistent: true };
const DIAS_SEMANA_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "s\u00e1b"];

async function tgApi(token, metodo, params) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
    });
    if (!r.ok) console.error(`[avisos ${metodo}] falha:`, r.status, await r.text().catch(() => ""));
  } catch (e) {
    console.error(`[avisos ${metodo}] erro de rede:`, e);
  }
}

async function chatsAutorizados(chatPadrao) {
  try {
    const snap = await db.collection("primus_config").doc("telegram").get();
    const lista = snap.exists && Array.isArray(snap.data().destinatarios) ? snap.data().destinatarios : [];
    const ids = lista.map((d) => String((d && d.id) || "").trim()).filter((id) => /^-?\d{5,20}$/.test(id));
    if (ids.length) return new Set(ids);
  } catch (e) {
    console.error("[avisos] erro lendo a lista (usa o padrao):", e);
  }
  return new Set(chatPadrao ? [String(chatPadrao)] : []);
}

// Botoes: [Ontem][Hoje parcial] + 6 dias anteriores (datas no fuso de Cuiaba).
function menuDiasDiferenca() {
  const [y, m, d] = hojeCuiaba().split("-").map(Number);
  const dia = (n) => new Date(Date.UTC(y, m - 1, d - n));
  const iso = (dt) => dt.toISOString().slice(0, 10);
  const ddmm = (dt) => `${String(dt.getUTCDate()).padStart(2, "0")}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
  const b = (dt, rotulo) => ({ text: rotulo, callback_data: "df:" + iso(dt) });
  const linhas = [[b(dia(1), `Ontem ${ddmm(dia(1))}`), b(dia(0), "Hoje (parcial)")]];
  const ant = [2, 3, 4, 5, 6, 7].map(dia);
  for (let i = 0; i < ant.length; i += 3) {
    linhas.push(ant.slice(i, i + 3).map((dt) => b(dt, `${DIAS_SEMANA_PT[dt.getUTCDay()]} ${ddmm(dt)}`)));
  }
  return { inline_keyboard: linhas };
}

async function tratarUpdateAvisos(upd, token, chatPadrao) {
  const cb = upd.callback_query;
  const msg = upd.message;
  const chat = String((cb ? (cb.message && cb.message.chat && cb.message.chat.id) : (msg && msg.chat && msg.chat.id)) || "");
  if (!chat) return;
  const texto = ((msg && msg.text) || "").trim();

  // /meuid responde pra qualquer um (e como a pessoa se cadastra)
  if (/^\/meuid(@\w+)?$/i.test(texto)) {
    await tgApi(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: `\ud83c\udd94 Seu chat id: <code>${chat}</code>` });
    return;
  }

  const autorizados = await chatsAutorizados(chatPadrao);
  if (!autorizados.has(chat)) {
    if (cb) await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Voc\u00ea n\u00e3o est\u00e1 autorizado." });
    else await tgApi(token, "sendMessage", { chat_id: chat, parse_mode: "HTML",
      text: `\ud83d\udd12 Voc\u00ea ainda n\u00e3o tem acesso.\n\ud83c\udd94 Seu chat id: <code>${chat}</code>\nPe\u00e7a pro gestor cadastrar no Primus Pro (Usu\u00e1rios \u2192 Telegram).` });
    console.log(`[avisos] chat nao autorizado: ${chat}`);
    return;
  }

  if (cb) {
    const dado = cb.data || "";
    const mid = cb.message && cb.message.message_id;
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id });
    const dia = dado.startsWith("df:") ? dado.slice(3) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !mid) return;
    const p = dia.split("-");
    await tgApi(token, "editMessageText", { chat_id: chat, message_id: mid, parse_mode: "HTML",
      text: `\u23f3 Calculando a diferen\u00e7a de <b>${p[2]}/${p[1]}</b>...` });
    let resposta;
    try {
      resposta = await montarDiferencaDia(dia, true);
    } catch (e) {
      console.error(`[avisos diferenca ${dia}] erro:`, e);
      resposta = `\u274c Erro ao calcular a diferen\u00e7a: ${String(e.message || e).slice(0, 200)}`;
    }
    await tgApi(token, "editMessageText", { chat_id: chat, message_id: mid, parse_mode: "HTML", text: resposta });
    return;
  }

  if (texto === BOTAO_DIFERENCA || /^\/diferenca(@\w+)?$/i.test(texto)) {
    await tgApi(token, "sendMessage", { chat_id: chat, parse_mode: "HTML",
      text: "\ud83d\udccb <b>Diferen\u00e7a de qual dia?</b>", reply_markup: menuDiasDiferenca() });
    return;
  }

  // /start, /ajuda ou qualquer outra coisa: explica e (re)mostra o teclado
  await tgApi(token, "setMyCommands", { commands: [
    { command: "diferenca", description: "Diferen\u00e7a do dia (estoque x vendas)" },
    { command: "meuid", description: "Mostra o seu chat id" }] });
  await tgApi(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", reply_markup: TECLADO_AVISOS,
    text: "\ud83d\udd14 <b>Primus Avisos</b>\nAqui chegam os avisos autom\u00e1ticos (diferen\u00e7a do dia, virada D-1).\nToque em <b>\ud83d\udccb Diferen\u00e7a</b> quando quiser.\n<i>A previs\u00e3o do dia agora fica no bot Primus Previs\u00e3o.</i>" });
}

exports.telegramAvisos = onRequest(
  { region: REGIAO, secrets: [TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(200).send("ok"); return; }
    if (req.get("X-Telegram-Bot-Api-Secret-Token") !== TELEGRAM_WEBHOOK_SECRET.value()) {
      res.status(403).send("forbidden"); return;
    }
    // A previsão com busca de eventos demora: se o Telegram reenviar o mesmo update, ignora.
    const updId = req.body && req.body.update_id;
    if (updId && await jaProcessado(`tg_${updId}`)) { res.status(200).send("ok"); return; }
    try {
      await tratarUpdateAvisos(req.body || {}, TELEGRAM_TOKEN.value(), TELEGRAM_CHAT_ID.value());
    } catch (e) {
      console.error("[avisos webhook] erro:", e);
    }
    res.status(200).send("ok"); // sempre 200: senao o Telegram fica reenviando
  }
);

// ===== GATILHO: vendas do dia gravadas (robô /vendas ou manual) =====
// Normalmente a venda é a última peça do dia — é aqui que a diferença sai.
exports.notificarVendas = onDocumentWritten(
  { document: "primus_vendas/{dia}", region: REGIAO, secrets: [TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_PREVISAO_TOKEN] },
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return; // delete → ignora
    if (await jaProcessado(event.id)) {
      console.log("[notificarVendas] evento repetido, ignorando:", event.id);
      return;
    }
    await verificarDiferencaDiaSeguro(event.params.dia);
    try {
      await perguntarProdutosNovos(event.params.dia, after.data() || {}, TELEGRAM_PREVISAO_TOKEN.value(), TELEGRAM_CHAT_ID.value());
    } catch (e) {
      console.error("[pessoas] erro perguntando produtos novos:", e);
    }
    try {
      await conferirRealizado(event.params.dia, after.data() || {}, TELEGRAM_PREVISAO_TOKEN.value(), TELEGRAM_CHAT_ID.value());
    } catch (e) {
      console.error("[realizado] erro:", e);
    }
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

// ===== PREVISÃO DO DIA (Fase 1) — Telegram às 7h =====
// Clima da janela de atendimento (11h–15h) + vendas de referência do histórico
// (primus_vendas) + vendedores. Só manda em dia de casa aberta: quarta a domingo,
// ou segunda/terça se for feriado. Sob demanda: /previsao [dd/mm] no Primus Avisos.
//
// Fontes externas (sem chave): Open-Meteo (clima) e BrasilAPI (feriados nacionais).
// Feriado local fica em FERIADOS_LOCAIS.

const CUIABA = { lat: -15.601, lon: -56.097 };
const HORAS_ATENDIMENTO = [11, 12, 13, 14, 15];
const DIAS_SEMANA_LONGO = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
// sábado e domingo são masculinos: "últimos domingos", "3º domingo"
const masc = (dow) => dow === 0 || dow === 6;
const ordinal = (n, dow) => `${n}${masc(dow) ? "º" : "ª"}`;
const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
  "agosto", "setembro", "outubro", "novembro", "dezembro"];
// Feriados municipais/estaduais (MM-DD) que a BrasilAPI não traz.
const FERIADOS_LOCAIS = { "04-08": "Aniversário de Cuiabá" };
const AMOSTRA_MESMO_DIA = 8; // últimas N ocorrências do mesmo dia da semana

// ---------- datas (sempre 'YYYY-MM-DD', sem fuso) ----------
const dParse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const dIso = (dt) => dt.toISOString().slice(0, 10);
const dAdd = (s, n) => { const dt = dParse(s); dt.setUTCDate(dt.getUTCDate() + n); return dIso(dt); };
const dDow = (s) => dParse(s).getUTCDay();
const dBR = (s) => { const p = s.split("-"); return `${p[2]}/${p[1]}`; };
const dBRAno = (s) => { const p = s.split("-"); return `${p[2]}/${p[1]}/${p[0].slice(2)}`; };
const brl = (v) => "R$ " + Math.round(v || 0).toLocaleString("pt-BR");

function resolverDiaPrevisao(arg) {
  const a = String(arg || "").trim().toLowerCase();
  const hoje = hojeCuiaba();
  if (!a || a === "hoje") return hoje;
  if (a === "amanha" || a === "amanhã") return dAdd(hoje, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
  const m = a.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  let y = m[3] ? Number(m[3]) : Number(hoje.slice(0, 4));
  if (y < 100) y += 2000;
  return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}

// n-ésima ocorrência (1..5) do dia da semana `dow` no mês; se não existir, a última.
function nesimoDiaSemana(ano, mes, dow, n) {
  const datas = [];
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(ano, mes - 1, d));
    if (dt.getUTCMonth() !== mes - 1) break;
    if (dt.getUTCDay() === dow) datas.push(dIso(dt));
  }
  return datas[Math.min(n, datas.length) - 1];
}

async function buscarJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url.split("?")[0]}`);
  return r.json();
}

// ---------- feriados ----------
const _cacheFeriados = {};
async function feriadosDoAno(ano) {
  if (_cacheFeriados[ano]) return _cacheFeriados[ano];
  const mapa = {};
  try {
    const lista = await buscarJson(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    (lista || []).forEach((f) => { if (f && f.date) mapa[f.date] = f.name; });
  } catch (e) {
    console.error(`[previsao] feriados ${ano} indisponíveis:`, e.message);
  }
  Object.entries(FERIADOS_LOCAIS).forEach(([md, nome]) => { mapa[`${ano}-${md}`] = mapa[`${ano}-${md}`] || nome; });
  _cacheFeriados[ano] = mapa;
  return mapa;
}

// ---------- clima ----------
function descreverTempo(codigo) {
  const c = Number(codigo);
  if (c === 0) return "☀️ céu limpo";
  if (c <= 2) return "🌤 poucas nuvens";
  if (c === 3) return "☁️ nublado";
  if (c === 45 || c === 48) return "🌫 neblina";
  if (c >= 51 && c <= 57) return "🌦 garoa";
  if (c >= 61 && c <= 67) return "🌧 chuva";
  if (c >= 80 && c <= 82) return "🌦 pancadas de chuva";
  if (c >= 95) return "⛈ trovoada";
  return "🌤 tempo variável";
}

async function climaAtendimento(dia) {
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${CUIABA.lat}&longitude=${CUIABA.lon}&timezone=America%2FCuiaba`
    + "&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code"
    + `&start_date=${dia}&end_date=${dia}`;
  const j = await buscarJson(url);
  const h = j.hourly || {};
  const horas = [];
  (h.time || []).forEach((t, i) => {
    const hora = Number(String(t).slice(11, 13));
    if (String(t).slice(0, 10) === dia && HORAS_ATENDIMENTO.includes(hora)) {
      horas.push({ hora, temp: h.temperature_2m[i], sens: h.apparent_temperature[i],
        prob: h.precipitation_probability[i] || 0, mm: h.precipitation[i] || 0, cod: h.weather_code[i] });
    }
  });
  if (!horas.length) throw new Error("sem previsão horária pra esse dia (Open-Meteo prevê até 16 dias)");
  const temps = horas.map((x) => x.temp);
  const probMax = Math.max(...horas.map((x) => x.prob));
  const mm = horas.reduce((s, x) => s + x.mm, 0);
  const primeiraChuva = horas.find((x) => x.prob >= 50);
  const pior = horas.reduce((a, b) => (Number(b.cod) > Number(a.cod) ? b : a));
  return {
    tMin: Math.round(Math.min(...temps)), tMax: Math.round(Math.max(...temps)),
    sensMax: Math.round(Math.max(...horas.map((x) => x.sens))),
    probMax, mm: Math.round(mm * 10) / 10,
    horaChuva: primeiraChuva ? primeiraChuva.hora : null,
    descricao: descreverTempo(pior.cod),
  };
}

// ---------- vendas ----------
// Vendedores do dia: detalhado do robô (sem o caixa); senão a seção VENDEDOR do agrupado.
function contarVendedores(v) {
  const det = Array.isArray(v.vendedoresDetalhado) ? v.vendedoresDetalhado.filter((x) => x && !x.caixa) : null;
  if (det && det.length) return det.length;
  const vs = v.vendedores;
  if (Array.isArray(vs)) return vs.filter((x) => x && !/OPERADOR/i.test(String(x.nome || ""))).length;
  if (vs && typeof vs === "object") return Object.keys(vs).filter((k) => !/OPERADOR/i.test(k)).length;
  return 0;
}

// Mapa "pessoas por produto" (primus_config/pessoas_produto.mapa), chaves trim+MAIÚSCULAS.
// Mesma conta da página de Estimativa do Compras: clientes = Σ qtd × pessoas dos
// produtos configurados; produto sem configuração fica de fora (vira "cobertura").
async function lerPessoasPorProduto() {
  try {
    const s = await db.collection("primus_config").doc("pessoas_produto").get();
    return (s.exists && s.data().mapa) || {};
  } catch (e) {
    console.error("[previsao] erro lendo pessoas por produto:", e.message);
    return {};
  }
}

function clientesDoDia(produtos, mapa) {
  let clientes = 0, receita = 0, receitaSemConfig = 0;
  (produtos || []).forEach((p) => {
    const total = Number(p.total) || 0;
    receita += total;
    const pes = mapa[String(p.nome || "").trim().toUpperCase()];
    if (pes === undefined || pes === null || pes === "") receitaSemConfig += total;
    else clientes += (Number(p.qtd) || 0) * Number(pes);
  });
  return { clientes, cobertura: receita ? 1 - receitaSemConfig / receita : 0 };
}

async function historicoVendas(ateExclusivo, mapaPessoas) {
  const snap = await db.collection("primus_vendas")
    .where(FieldPath.documentId(), "<", ateExclusivo)
    .select("totais", "vendedores", "vendedoresDetalhado", "produtos")
    .get();
  const temMapa = Object.keys(mapaPessoas || {}).length > 0;
  const porDia = {};
  snap.forEach((d) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.id)) return;
    const v = d.data() || {};
    const total = Number((v.totais && v.totais.total) || 0);
    if (total <= 0) return;
    const c = temMapa ? clientesDoDia(v.produtos, mapaPessoas) : { clientes: 0, cobertura: 0 };
    porDia[d.id] = { total, vendedores: contarVendedores(v), clientes: c.clientes, cobertura: c.cobertura };
  });
  return porDia;
}

function media(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }

// Véspera de feriado: feriado nos próximos 1 a 3 dias (o próprio dia não é feriado).
function vesperaDe(d, feriados) {
  if (feriados[d]) return null;
  for (let k = 1; k <= 3; k++) {
    const dd = dAdd(d, k);
    if (feriados[dd]) return { nome: feriados[dd], data: dd, dias: k };
  }
  return null;
}
// Fase do mês (ciclo de pagamento): 1–5, 6–10, 11–20, 21–31.
function faseMes(d) {
  const n = Number(d.slice(8, 10));
  return n <= 5 ? 0 : n <= 10 ? 1 : n <= 20 ? 2 : 3;
}

// Monta a mensagem. Devolve { texto, aberto }. sobDemanda: manda mesmo em dia fechado.
// opcoes: { apiKey, usarCache } — eventos/leitura do Claude (cache em primus_previsoes/{dia}).
async function montarPrevisao(dia, sobDemanda = false, opcoes = {}) {
  const ano = Number(dia.slice(0, 4));
  const dow = dDow(dia);
  const [fAtual, fAnt1, fAnt2] = await Promise.all([feriadosDoAno(ano), feriadosDoAno(ano - 1), feriadosDoAno(ano - 2)]);
  const todosFeriados = { ...fAnt2, ...fAnt1, ...fAtual, ...(await feriadosDoAno(ano + 1)) };
  const feriado = fAtual[dia] || null;
  const aberto = !(dow === 1 || dow === 2) || !!feriado;

  const titulo = `📅 <b>Previsão — ${DIAS_SEMANA_LONGO[dow]}, ${dBR(dia)}</b>`;
  if (!aberto) {
    return { aberto, texto: `${titulo}\n💤 Casa fechada (${DIAS_SEMANA_LONGO[dow]} sem feriado).` };
  }

  const partes = [titulo + (feriado ? `\n🎉 <b>Feriado:</b> ${escHtml(feriado)}` : "")];

  // Clima
  let climaHoje = null;
  let faixaPrev = null;
  try {
    const c = await climaAtendimento(dia);
    climaHoje = c;
    let chuva;
    if (c.probMax < 20) chuva = "sem chuva prevista";
    else if (c.horaChuva !== null) chuva = `<b>${c.probMax}% de chance de chuva</b>, a partir das ${c.horaChuva}h` + (c.mm >= 1 ? ` (~${String(c.mm).replace(".", ",")} mm)` : "");
    else chuva = `${c.probMax}% de chance de chuva`;
    partes.push(`🌡 <b>Clima 11h–15h:</b> ${c.descricao}, ${c.tMin}–${c.tMax}°C` +
      (c.sensMax > c.tMax + 1 ? ` (sensação ${c.sensMax}°C)` : "") + `\n☔ ${chuva}`);
  } catch (e) {
    console.error(`[previsao ${dia}] clima:`, e.message);
    partes.push(`🌡 <b>Clima:</b> indisponível agora (${escHtml(e.message)})`);
  }

  // Vendas de referência
  const mapaPessoas = await lerPessoasPorProduto();
  const hist = await historicoVendas(dia, mapaPessoas);
  const datas = Object.keys(hist).sort();
  if (!datas.length) {
    partes.push("📊 Sem histórico de vendas ainda.");
  } else {
    const linhas = [];

    // 1) Mesmo dia da semana — últimas N (sem feriados, se hoje não é feriado)
    const mesmos = datas.filter((d) => dDow(d) === dow && (feriado || !todosFeriados[d])).slice(-AMOSTRA_MESMO_DIA);
    if (mesmos.length) {
      const tot = mesmos.map((d) => hist[d].total);
      const ult = mesmos[mesmos.length - 1];
      linhas.push(`• Média ${masc(dow) ? "dos últimos" : "das últimas"} ${mesmos.length} ${DIAS_SEMANA_LONGO[dow]}s: <b>${brl(media(tot))}</b>` +
        ` <i>(de ${brl(Math.min(...tot))} a ${brl(Math.max(...tot))})</i>`);
      linhas.push(`• ${masc(dow) ? "Último" : "Última"} ${DIAS_SEMANA_LONGO[dow]} (${dBR(ult)}): ${brl(hist[ult].total)}`);
    }

    // Anos anteriores com histórico (do ano passado pra trás)
    const anoIni = Number(datas[0].slice(0, 4));
    const anosAnt = [];
    for (let a = ano - 1; a >= anoIni; a--) anosAnt.push(a);
    const feriadosAnos = {};
    for (const a of anosAnt) feriadosAnos[a] = await feriadosDoAno(a);

    // Uma linha: "média de N anos" (se tiver 2+) · "ano passado (data) valor"
    const curto = (d) => `${DIAS_SEMANA_LONGO[dDow(d)].slice(0, 3)} ${dBRAno(d)}`;
    function linhaAnos(rotulo, itens, marcarFeriado) {
      const validos = itens.filter((x) => x.d && x.d >= datas[0]);
      if (!validos.length) return;
      const comVenda = validos.filter((x) => hist[x.d]).map((x) => hist[x.d].total);
      const pedacos = [];
      if (comVenda.length >= 2) pedacos.push(`média de ${comVenda.length} anos <b>${brl(media(comVenda))}</b>`);
      const ap = validos.find((x) => x.ano === ano - 1);
      if (ap) {
        const fer = marcarFeriado && todosFeriados[ap.d] ? ` 🎉 ${escHtml(todosFeriados[ap.d])}` : "";
        pedacos.push(`ano passado (${curto(ap.d)}) ${hist[ap.d] ? brl(hist[ap.d].total) : "sem venda"}${fer}`);
      }
      if (pedacos.length) linhas.push(`• ${rotulo}: ${pedacos.join(" · ")}`);
    }

    // 2) Mesma posição no mês (ex.: 3º domingo de novembro)
    const mes = Number(dia.slice(5, 7));
    const n = Math.ceil(Number(dia.slice(8, 10)) / 7);
    linhaAnos(`${ordinal(n, dow)} ${DIAS_SEMANA_LONGO[dow]} de ${MESES_PT[mes - 1]}`,
      anosAnt.map((a) => ({ ano: a, d: nesimoDiaSemana(a, mes, dow, n) })), true);

    // 3) Feriado: o mesmo feriado nos anos anteriores (se cair sempre na mesma
    //    data, junta com a "mesma data" pra não repetir a linha)
    let feriadoFixo = false;
    if (feriado) {
      const itensFer = anosAnt.map((a) => ({ ano: a,
        d: Object.keys(feriadosAnos[a]).find((x) => feriadosAnos[a][x] === feriado) }));
      feriadoFixo = itensFer.filter((x) => x.d).every((x) => x.d.slice(4) === dia.slice(4));
      if (!feriadoFixo) linhaAnos(escHtml(feriado), itensFer, false);
    }

    // 4) Mesma data
    linhaAnos(feriadoFixo ? `Mesma data (${escHtml(feriado)})` : "Mesma data",
      anosAnt.map((a) => ({ ano: a, d: `${a}${dia.slice(4)}` })), false);

    partes.push(`📊 <b>Vendas de referência</b>\n${linhas.join("\n")}`);

    // Vendedores nas mesmas datas da média
    const comVend = mesmos.filter((d) => hist[d].vendedores > 0);
    if (comVend.length) {
      const mv = media(comVend.map((d) => hist[d].vendedores));
      const fatPorVend = media(comVend.map((d) => hist[d].total / hist[d].vendedores));
      partes.push(`🧑‍🍳 <b>Vendedores:</b> média de ${String(Math.round(mv * 10) / 10).replace(".", ",")} ` +
        `${masc(dow) ? "nesses" : "nessas"} ${DIAS_SEMANA_LONGO[dow]}s · ${brl(fatPorVend)} por vendedor`);
    }
    // Clientes estimados nas mesmas datas da média (pessoas por produto)
    const comCli = mesmos.filter((d) => hist[d].clientes > 0);
    if (comCli.length) {
      const mc = media(comCli.map((d) => hist[d].clientes));
      const ticket = media(comCli.map((d) => hist[d].total / hist[d].clientes));
      const porVend = comCli.filter((d) => hist[d].vendedores > 0);
      const cliVend = porVend.length ? media(porVend.map((d) => hist[d].clientes / hist[d].vendedores)) : 0;
      partes.push(`👥 <b>Clientes:</b> média de <b>${Math.round(mc)}</b> ${masc(dow) ? "nesses" : "nessas"} ${DIAS_SEMANA_LONGO[dow]}s` +
        ` · ticket ${brl(ticket)}/pessoa` + (cliVend ? ` · ${Math.round(cliVend)} por vendedor` : ""));
    }
    const dows = `${DIAS_SEMANA_LONGO[dow]}s`;
    let efeitoVespera = null;
    // Tendência: últimas 3 x a média do período de referência
    if (mesmos.length >= 6) {
      const mRef = media(mesmos.map((d) => hist[d].total));
      const m3 = media(mesmos.slice(-3).map((d) => hist[d].total));
      const dv = m3 / mRef - 1;
      if (Math.abs(dv) >= 0.10) {
        partes.push(`${dv < 0 ? "📉" : "📈"} <b>Tendência:</b> média ${masc(dow) ? "dos últimos 3" : "das últimas 3"} ${dows} ${brl(m3)} — ` +
          `${Math.round(Math.abs(dv) * 100)}% ${dv < 0 ? "abaixo" : "acima"} da média ${masc(dow) ? "dos" : "das"} ${mesmos.length}`);
      }
    }
    // Véspera de feriado: compara com as mesmas vésperas do histórico
    const vesp = feriado ? null : vesperaDe(dia, todosFeriados);
    if (vesp) {
      const doTipo = datas.filter((d) => dDow(d) === dow && !todosFeriados[d]);
      const vespHist = doTipo.filter((d) => vesperaDe(d, todosFeriados));
      const normais = doTipo.filter((d) => !vesperaDe(d, todosFeriados)).slice(-12);
      let txt = `⚠️ <b>Véspera de feriado:</b> ${escHtml(vesp.nome)} ${vesp.dias === 1 ? "amanhã" : `em ${vesp.dias} dias`} (${DIAS_SEMANA_LONGO[dDow(vesp.data)]}, ${dBR(vesp.data)})`;
      if (vespHist.length >= 2 && normais.length >= 3) {
        const mv = media(vespHist.map((d) => hist[d].total)), mn = media(normais.map((d) => hist[d].total));
        const ef = mv / mn - 1;
        efeitoVespera = ef;
        txt += `\n${masc(dow) ? "Nos" : "Nas"} ${vespHist.length} ${dows} antes de feriado vendemos em média ${brl(mv)} — ` +
          `<b>${Math.round(Math.abs(ef) * 100)}% ${ef < 0 ? "menos" : "mais"}</b> que ${masc(dow) ? "nos" : "nas"} ${dows} normais (${brl(mn)})` +
          `\n<i>${vespHist.slice(-3).map((d) => `${dBRAno(d)} ${brl(hist[d].total)}`).join(" · ")}</i>`;
      } else {
        txt += `\n<i>Pouco histórico de ${dows} antes de feriado pra medir o efeito.</i>`;
      }
      partes.push(txt);
    }
    if (mesmos.length < 4) partes.push(`<i>⚠️ histórico curto: só ${mesmos.length} ${DIAS_SEMANA_LONGO[dow]}(s) na base.</i>`);

    // Dias parecidos + faixa provável + efeito chuva (clima real guardado em primus_clima)
    try {
      const climaHist = await garantirClimaHistorico(datas);
      const bloco = blocoDiasParecidos({ dia, dow, feriado, climaHoje, hist, climaHist, todosFeriados, efeitoVespera });
      if (bloco) { partes.push(bloco.texto); faixaPrev = bloco.faixa; }
    } catch (e) {
      console.error(`[previsao ${dia}] dias parecidos:`, e);
    }
  }

  // Guarda a faixa pra comparar com o realizado (a das 7h é a oficial)
  if (faixaPrev) {
    try {
      const ref = db.collection("primus_previsoes").doc(dia);
      const s0 = opcoes.oficial ? null : await ref.get();
      if (opcoes.oficial || !(s0.exists && s0.data().faixa)) {
        await ref.set({ faixa: faixaPrev, faixaEm: new Date().toISOString(), faixaOficial: !!opcoes.oficial }, { merge: true });
      }
    } catch (e) { console.error(`[previsao ${dia}] gravar faixa:`, e.message); }
  }

  // Eventos da cidade + leitura do dia (Claude com busca na web)
  if (opcoes.apiKey) {
    try {
      const fatos = partes.join("\n\n").replace(/<[^>]+>/g, "");
      const ia = await eventosELeitura(dia, fatos, opcoes.apiKey, !!opcoes.usarCache);
      if (ia) partes.push(blocoEventosLeitura(ia));
    } catch (e) {
      console.error(`[previsao ${dia}] Claude:`, e);
      partes.push("🎉 <b>Eventos na cidade</b>\n<i>Não consegui verificar os eventos hoje.</i>");
    }
  }

  return { aberto, texto: partes.join("\n\n") };
}

exports.previsaoManha = onSchedule(
  { schedule: "0 7 * * *", timeZone: "America/Cuiaba", region: REGIAO, timeoutSeconds: 300,
    secrets: [TELEGRAM_PREVISAO_TOKEN, TELEGRAM_CHAT_ID, ANTHROPIC_API_KEY] },
  async () => {
    const dia = hojeCuiaba();
    try {
      const { aberto, texto } = await montarPrevisao(dia, false, { apiKey: ANTHROPIC_API_KEY.value(), usarCache: false, oficial: true });
      if (!aberto) { console.log(`[previsao ${dia}] casa fechada — não envia`); return; }
      await enviarTelegram(TELEGRAM_PREVISAO_TOKEN.value(), TELEGRAM_CHAT_ID.value(), texto);
    } catch (e) {
      console.error(`[previsao ${dia}] erro:`, e);
    }
  }
);

// ===== PESSOAS POR PRODUTO — configuração pelo Telegram (Primus Avisos) =====
// Doc primus_config/pessoas_produto:
//   mapa:        { NOME_MAIUSCULO: pessoas }   (usado na previsão)
//   ids:         { id8: NOME }                 (callback_data tem limite de 64 bytes)
//   perguntados: { NOME: true }                (produto novo só é perguntado 1x)
//   baselineFeito: true  -> só depois da arrumação inicial (/pessoas) o aviso
//                           automático de produto novo é ligado (senão pergunta
//                           de toda bebida/sorvete que nunca foi configurado).
// Botões: pp:<valor>:<id>:<a|n>  (a = fluxo /pessoas, mostra o próximo; n = avulso)
//         pz (pede confirmação) · pzs (zera os restantes) · pc:<id> (corrigir)

const REF_PESSOAS = () => db.collection("primus_config").doc("pessoas_produto");
const VALORES_PESSOAS = [0, 1, 2, 3, 4];
const idProduto = (nome) => require("crypto").createHash("sha1").update(nome).digest("hex").slice(0, 8);
const normProd = (n) => String(n || "").trim().toUpperCase();

async function lerDocPessoas() {
  const s = await REF_PESSOAS().get();
  const d = (s.exists && s.data()) || {};
  return { mapa: d.mapa || {}, ids: d.ids || {}, perguntados: d.perguntados || {}, baselineFeito: !!d.baselineFeito };
}

// Produtos vendidos nos últimos 90 dias sem "pessoas" configurado, do que mais fatura pro que menos.
async function listarPendentesPessoas() {
  const { mapa } = await lerDocPessoas();
  const desde = dAdd(hojeCuiaba(), -90);
  const snap = await db.collection("primus_vendas")
    .where(FieldPath.documentId(), ">=", desde)
    .select("produtos")
    .get();
  const agg = {};
  snap.forEach((d) => {
    ((d.data() || {}).produtos || []).forEach((p) => {
      const nome = normProd(p.nome);
      if (!nome || nome in mapa) return;
      const a = agg[nome] || (agg[nome] = { nome, qtd: 0, total: 0 });
      a.qtd += Number(p.qtd) || 0;
      a.total += Number(p.total) || 0;
    });
  });
  return Object.values(agg).sort((a, b) => b.total - a.total);
}

function tecladoValores(id, modo) {
  return [VALORES_PESSOAS.map((v) => ({ text: String(v), callback_data: `pp:${v}:${id}:${modo}` }))];
}

async function enviarOuEditar(token, chat, mid, texto, teclado) {
  const base = { chat_id: chat, parse_mode: "HTML", text: texto };
  if (teclado) base.reply_markup = { inline_keyboard: teclado };
  if (mid) await tgApi(token, "editMessageText", { ...base, message_id: mid });
  else await tgApi(token, "sendMessage", base);
}

// Fluxo /pessoas: mostra o próximo pendente (ou fecha a arrumação).
async function mostrarProximoPendente(token, chat, mid) {
  const pend = await listarPendentesPessoas();
  if (!pend.length) {
    await REF_PESSOAS().set({ baselineFeito: true }, { merge: true });
    await enviarOuEditar(token, chat, mid,
      "✅ <b>Todos os produtos vendidos nos últimos 90 dias estão configurados.</b>\n" +
      "Daqui pra frente, quando aparecer produto novo no PDV, eu pergunto aqui.");
    return;
  }
  const p = pend[0];
  const id = idProduto(p.nome);
  await REF_PESSOAS().set({ ids: { [id]: p.nome } }, { merge: true });
  const teclado = tecladoValores(id, "a");
  if (pend.length > 1) teclado.push([{ text: `Zerar os ${pend.length} restantes`, callback_data: "pz" }]);
  await enviarOuEditar(token, chat, mid,
    `🍽 <b>${escHtml(p.nome)}</b>\n` +
    `${Math.round(p.qtd)} vendidos · ${brl(p.total)} nos últimos 90 dias\n\n` +
    "Quantas pessoas esse produto serve?\n<i>0 = bebida, sorvete, sobremesa, descartável, acompanhamento</i>\n" +
    `<i>Faltam ${pend.length}.</i>`, teclado);
}

async function tratarCliquePessoas(cb, token) {
  const dado = cb.data || "";
  const chat = String(cb.message.chat.id);
  const mid = cb.message.message_id;

  if (dado === "pz") {
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id });
    const pend = await listarPendentesPessoas();
    const lista = pend.slice(0, 25).map((p) => `• ${escHtml(p.nome)}`).join("\n");
    await enviarOuEditar(token, chat, mid,
      `⚠️ Vou colocar <b>0 pessoas</b> em ${pend.length} produto(s):\n${lista}` +
      (pend.length > 25 ? `\n… e mais ${pend.length - 25}` : "") +
      "\n\nTem algum prato aí no meio? Se tiver, volte e configure ele antes.",
      [[{ text: "Sim, zerar todos", callback_data: "pzs" }, { text: "Voltar", callback_data: "pp:-:-:a" }]]);
    return;
  }

  if (dado === "pzs") {
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Zerando..." });
    const pend = await listarPendentesPessoas();
    const mapa = {};
    pend.forEach((p) => { mapa[p.nome] = 0; });
    await REF_PESSOAS().set({ mapa, baselineFeito: true }, { merge: true });
    await enviarOuEditar(token, chat, mid,
      `✅ ${pend.length} produto(s) ficaram com 0 pessoas.\n` +
      "Arrumação feita! Daqui pra frente, produto novo no PDV eu pergunto aqui.");
    return;
  }

  if (dado.startsWith("pc:")) {   // corrigir um produto já respondido
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id });
    const id = dado.slice(3);
    const { ids, mapa } = await lerDocPessoas();
    const nome = ids[id];
    if (!nome) return;
    await enviarOuEditar(token, chat, mid,
      `✏️ <b>${escHtml(nome)}</b> (hoje: ${nome in mapa ? mapa[nome] : "—"})\nQuantas pessoas esse produto serve?`,
      tecladoValores(id, "n"));
    return;
  }

  // pp:<valor>:<id>:<modo>
  const [, valor, id, modo] = dado.split(":");
  if (valor === "-") {   // "Voltar" da confirmação de zerar
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id });
    await mostrarProximoPendente(token, chat, mid);
    return;
  }
  const { ids } = await lerDocPessoas();
  const nome = ids[id];
  const v = Number(valor);
  if (!nome || !isFinite(v)) {
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Botão expirado. Mande /pessoas de novo." });
    return;
  }
  await REF_PESSOAS().set({ mapa: { [nome]: v }, perguntados: { [nome]: true } }, { merge: true });
  await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id, text: `${nome} = ${v}` });
  if (modo === "a") {
    await mostrarProximoPendente(token, chat, mid);
  } else {
    await enviarOuEditar(token, chat, mid,
      `✅ <b>${escHtml(nome)}</b> = ${v} pessoa${v === 1 ? "" : "s"}`,
      [[{ text: "corrigir", callback_data: `pc:${id}` }]]);
  }
}

// Disparado quando as vendas de um dia são gravadas. Só olha dias recentes (o
// lote de histórico não pergunta nada) e só depois da arrumação inicial.
async function perguntarProdutosNovos(dia, vendasDia, token, chatDono) {
  if (!token || !chatDono) return;
  if (dia < dAdd(hojeCuiaba(), -3)) return;
  const { mapa, perguntados, baselineFeito } = await lerDocPessoas();
  if (!baselineFeito) return;
  const novos = [...new Set(((vendasDia.produtos) || []).map((p) => normProd(p.nome)))]
    .filter((n) => n && !(n in mapa) && !perguntados[n]);
  if (!novos.length) return;

  const ids = {}, marcados = {};
  novos.forEach((n) => { ids[idProduto(n)] = n; marcados[n] = true; });
  await REF_PESSOAS().set({ ids, perguntados: marcados }, { merge: true });

  for (const nome of novos.slice(0, 10)) {
    await enviarOuEditar(token, String(chatDono), null,
      `🆕 <b>Produto novo no PDV:</b> ${escHtml(nome)}\nQuantas pessoas ele serve?\n` +
      "<i>0 = bebida, sorvete, sobremesa, descartável, acompanhamento</i>",
      tecladoValores(idProduto(nome), "n"));
  }
}

// ===== PREVISÃO — FASE 2: clima histórico, dias parecidos, eventos e leitura =====

// ---------- clima real 11h–15h de cada dia (cache em primus_clima/{dia}) ----------
// Open-Meteo: dias com mais de 7 dias vêm do arquivo histórico (archive-api);
// os da última semana, do endpoint de previsão (que também devolve o passado recente).
function resumirHorasClima(hourly) {
  const porDia = {};
  (hourly.time || []).forEach((t, i) => {
    const d = String(t).slice(0, 10), h = Number(String(t).slice(11, 13));
    if (!HORAS_ATENDIMENTO.includes(h)) return;
    const x = porDia[d] || (porDia[d] = { tMax: -99, mm: 0 });
    x.tMax = Math.max(x.tMax, Number(hourly.temperature_2m[i]));
    x.mm += Number(hourly.precipitation[i]) || 0;
  });
  Object.values(porDia).forEach((x) => { x.tMax = Math.round(x.tMax); x.mm = Math.round(x.mm * 10) / 10; x.chuva = x.mm >= 0.5; });
  return porDia;
}

async function buscarClimaPeriodo(base, ini, fim) {
  const url = `${base}?latitude=${CUIABA.lat}&longitude=${CUIABA.lon}&timezone=America%2FCuiaba` +
    `&hourly=temperature_2m,precipitation&start_date=${ini}&end_date=${fim}`;
  return resumirHorasClima((await buscarJson(url)).hourly || {});
}

async function garantirClimaHistorico(datas) {
  const col = db.collection("primus_clima");
  const cache = {};
  if (!datas.length) return cache;
  const snap = await col.where(FieldPath.documentId(), ">=", datas[0]).get();
  snap.forEach((d) => { cache[d.id] = d.data(); });

  const faltam = datas.filter((d) => !cache[d]);
  if (!faltam.length) return cache;
  const corte = dAdd(hojeCuiaba(), -7);
  const antigos = faltam.filter((d) => d < corte);
  const recentes = faltam.filter((d) => d >= corte);
  const novos = {};
  try {
    if (antigos.length) Object.assign(novos, await buscarClimaPeriodo("https://archive-api.open-meteo.com/v1/archive", antigos[0], antigos[antigos.length - 1]));
    if (recentes.length) Object.assign(novos, await buscarClimaPeriodo("https://api.open-meteo.com/v1/forecast", recentes[0], recentes[recentes.length - 1]));
  } catch (e) {
    console.error("[clima histórico] falhou (tenta de novo amanhã):", e.message);
  }
  const gravar = faltam.filter((d) => novos[d]);
  for (let i = 0; i < gravar.length; i += 400) {
    const batch = db.batch();
    gravar.slice(i, i + 400).forEach((d) => batch.set(col.doc(d), novos[d]));
    await batch.commit();
  }
  if (gravar.length) console.log(`[clima histórico] ${gravar.length} dia(s) gravado(s)`);
  gravar.forEach((d) => { cache[d] = novos[d]; });
  return cache;
}

// ---------- dias parecidos ----------
// Candidatos: mesmo dia da semana fora de feriado (ou, se hoje é feriado, outros
// feriados). Parecença: chuva igual pesa mais; depois temperatura; dias recentes
// valem mais (o restaurante muda com o tempo).
function percentil(arr, p) {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return 0;
  const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

function blocoDiasParecidos({ dia, dow, feriado, climaHoje, hist, climaHist, todosFeriados, efeitoVespera }) {
  if (!climaHoje) return null;
  const chuvaHoje = climaHoje.probMax >= 50 || climaHoje.mm >= 1;
  const tHoje = climaHoje.tMax;
  const tipo = (d) => (feriado ? !!todosFeriados[d] : dDow(d) === dow && !todosFeriados[d]);
  const vespHoje = !feriado && !!vesperaDe(dia, todosFeriados);
  const faseHoje = faseMes(dia);
  const candidatos = Object.keys(hist).filter((d) => tipo(d) && climaHist[d]);
  if (candidatos.length < 3) return null;

  const idadeAnos = (d) => (dParse(dia) - dParse(d)) / (365 * 86400000);
  const score = (d) => {
    const c = climaHist[d];
    return (c.chuva !== chuvaHoje ? 3 : 0) + Math.abs(c.tMax - tHoje) / 3 + idadeAnos(d) * 1.5 +
      (!feriado && !!vesperaDe(d, todosFeriados) !== vespHoje ? 3 : 0) +   // véspera de feriado pesa como chuva
      (faseMes(d) !== faseHoje ? 1 : 0);                                     // fase do mês (ciclo do salário)
  };
  const ordenados = candidatos.sort((a, b) => score(a) - score(b));
  const top = ordenados.slice(0, 5);
  // Véspera de feriado com poucos exemplos: os dias normais que entram na faixa são
  // ajustados pelo efeito véspera medido (ex.: −35%), pra faixa não ficar otimista.
  const ajustarVesp = vespHoje && efeitoVespera !== null && efeitoVespera !== undefined;
  const faixaBase = ordenados.slice(0, 8).map((d) =>
    hist[d].total * (ajustarVesp && !vesperaDe(d, todosFeriados) ? 1 + efeitoVespera : 1));

  const rotTipo = feriado ? "feriados" : `${DIAS_SEMANA_LONGO[dow]}s${vespHoje ? " antes de feriado" : ""}`;
  const linhas = top.map((d) => {
    const c = climaHist[d], h = hist[d];
    return `• ${DIAS_SEMANA_LONGO[dDow(d)].slice(0, 3)} ${dBRAno(d)} · ${c.tMax}°C ${c.chuva ? "🌧" : "☀️"} · <b>${brl(h.total)}</b>` +
      (h.clientes ? ` · ${Math.round(h.clientes)} clientes` : "") + (todosFeriados[d] ? ` 🎉` : "");
  });
  const faixa = { min: Math.round(percentil(faixaBase, 0.25)), max: Math.round(percentil(faixaBase, 0.75)) };
  let txt = `🔁 <b>Dias parecidos</b> <i>(${rotTipo}, ${chuvaHoje ? "com chuva" : "sem chuva"}, ~${tHoje}°C)</i>\n${linhas.join("\n")}` +
    `\n🎯 <b>Faixa provável: ${brl(faixa.min)} a ${brl(faixa.max)}</b>` +
    (ajustarVesp ? ` <i>(ajustada pela véspera: ${Math.round(efeitoVespera * 100)}%)</i>` : "");

  // Efeito chuva no último ano, nesse tipo de dia
  const umAno = candidatos.filter((d) => idadeAnos(d) <= 1);
  const comChuva = umAno.filter((d) => climaHist[d].chuva).map((d) => hist[d].total);
  const semChuva = umAno.filter((d) => !climaHist[d].chuva).map((d) => hist[d].total);
  if (comChuva.length >= 3 && semChuva.length >= 3) {
    const ef = media(comChuva) / media(semChuva) - 1;
    txt += `\n☔ ${feriado || masc(dow) ? "Nos" : "Nas"} ${rotTipo} do último ano, com chuva no almoço vendeu <b>${Math.round(Math.abs(ef) * 100)}% ${ef < 0 ? "menos" : "mais"}</b>` +
      ` <i>(${comChuva.length} com chuva × ${semChuva.length} sem)</i>`;
  }
  return { texto: txt, faixa };
}

// ---------- eventos + leitura (Claude com busca na web) ----------
const MODELO_CLAUDE = "claude-sonnet-5-5";

// Acha o JSON da resposta mesmo com texto em volta: tenta os blocos ```json (do último
// pro primeiro) e depois cada objeto {...} balanceado. Devolve o 1º com eventos/leitura.
function extrairJson(texto) {
  const candidatos = [];
  const cercas = [...String(texto).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  candidatos.push(...cercas.reverse());
  const t = String(texto);
  for (let i = t.lastIndexOf("{"); i >= 0; i = t.lastIndexOf("{", i - 1)) {
    let prof = 0, emTexto = false, esc = false;
    for (let k = i; k < t.length; k++) {
      const ch = t[k];
      if (emTexto) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') emTexto = false; continue; }
      if (ch === '"') emTexto = true;
      else if (ch === "{") prof++;
      else if (ch === "}" && --prof === 0) { candidatos.push(t.slice(i, k + 1)); break; }
    }
    if (i === 0) break;
  }
  for (const c of candidatos) {
    for (const tentativa of [c, c.replace(/,\s*([}\]])/g, "$1")]) {
      try {
        const j = JSON.parse(tentativa);
        if (j && typeof j === "object" && ("eventos" in j || "leitura" in j)) return j;
      } catch (_) { /* tenta o próximo */ }
    }
  }
  throw new Error("sem JSON válido");
}

async function chamarClaude(apiKey, prompt, comBusca = true) {
  const tools = comBusca ? [{ type: "web_search_20250305", name: "web_search", max_uses: 4,
    user_location: { type: "approximate", city: "Cuiabá", region: "Mato Grosso", country: "BR", timezone: "America/Cuiaba" } }] : undefined;
  const messages = [{ role: "user", content: prompt }];
  let uso = { entrada: 0, saida: 0, buscas: 0 };
  for (let volta = 0; volta < 3; volta++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(150000),
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODELO_CLAUDE, max_tokens: 4000, ...(tools ? { tools } : {}), messages }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`API do Claude ${r.status}: ${(j.error && j.error.message) || "erro"}`);
    uso.entrada += (j.usage && j.usage.input_tokens) || 0;
    uso.saida += (j.usage && j.usage.output_tokens) || 0;
    uso.buscas += (j.usage && j.usage.server_tool_use && j.usage.server_tool_use.web_search_requests) || 0;
    if (j.stop_reason === "pause_turn") {   // busca longa: devolve o turno e deixa continuar
      messages.push({ role: "assistant", content: j.content });
      continue;
    }
    const texto = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return { texto, uso };
  }
  throw new Error("a busca não terminou a tempo");
}

async function eventosELeitura(dia, fatos, apiKey, usarCache) {
  const ref = db.collection("primus_previsoes").doc(dia);
  if (usarCache) {
    const s = await ref.get();
    if (s.exists && s.data().ia) return s.data().ia;
  }
  const dow = dDow(dia);
  const prompt =
`Você ajuda o dono da Primus Peixaria: restaurante de peixes no bairro São Gonçalo Beira Rio, em Cuiabá-MT. Atende só no almoço (11h às 15h), de quarta a domingo e feriados, e tem estacionamento próprio.
Data analisada: ${DIAS_SEMANA_LONGO[dow]}, ${dBRAno(dia)}.

TAREFA 1 — Pesquise na web eventos em Cuiabá e Várzea Grande NESSA data que possam afetar o movimento do almoço (pra mais ou pra menos): jogos na Arena Pantanal, shows, feiras, festas e eventos no São Gonçalo Beira Rio e na Orla do Porto, corridas de rua, interdições de vias, grandes eventos religiosos, provas e concursos (ENEM etc.), pontos facultativos. Ignore eventos noturnos que não mexem com o almoço, a não ser que fechem ruas. Inclua só eventos confirmados pra essa data. Se não achar nada relevante, devolva a lista vazia — não invente.

TAREFA 2 — Escreva a leitura do dia em 3 a 6 tópicos curtos (uma ideia por tópico, uma frase cada, tom direto, de dono pra dono), juntando os fatos abaixo e os eventos encontrados. Use SOMENTE os números que estão nos fatos; não crie números novos nem porcentagens novas.

FATOS DO DIA:
${fatos}

Seja breve fora do JSON (no máximo 2 frases sobre a pesquisa). No final da resposta, devolva APENAS este JSON (sem texto depois):
\`\`\`json
{"eventos":[{"nome":"","quando":"","local":"","impacto":"positivo|negativo|neutro","motivo":""}],"leitura":["tópico 1","tópico 2"]}
\`\`\``;

  const uso = { entrada: 0, saida: 0, buscas: 0 };
  const somar = (u) => { uso.entrada += u.entrada; uso.saida += u.saida; uso.buscas += u.buscas; };
  const normalizar = (j) => ({ eventos: Array.isArray(j.eventos) ? j.eventos.slice(0, 6) : [],
    leitura: Array.isArray(j.leitura) ? j.leitura.map(String).filter(Boolean) : String(j.leitura || "") });
  let ia = null, bruto = "";

  // 1) busca + leitura
  try {
    const r = await chamarClaude(apiKey, prompt, true);
    somar(r.uso); bruto = r.texto;
    ia = normalizar(extrairJson(r.texto));
  } catch (e) {
    console.error(`[Claude ${dia}] 1ª tentativa falhou:`, e.message, bruto ? `| início: ${bruto.slice(0, 300)}` : "");
  }
  // 2) veio fora do formato: só reorganiza o que já foi pesquisado (sem nova busca)
  if (!ia && bruto) {
    try {
      const r = await chamarClaude(apiKey,
        `Reorganize o texto abaixo (pesquisa de eventos e leitura do dia de um restaurante) em APENAS este JSON, sem nenhum texto fora dele:\n` +
        `{"eventos":[{"nome":"","quando":"","local":"","impacto":"positivo|negativo|neutro","motivo":""}],"leitura":["tópico 1","tópico 2"]}\n` +
        `Se o texto não tiver leitura, escreva 3 a 6 tópicos curtos usando só estes fatos:\n${fatos}\n\nTEXTO:\n${bruto.slice(-6000)}`, false);
      somar(r.uso);
      ia = normalizar(extrairJson(r.texto));
    } catch (e) {
      console.error(`[Claude ${dia}] reorganizar falhou:`, e.message);
    }
  }
  // 3) busca falhou de vez: avisa que não viu os eventos e escreve a leitura só com os números
  if (!ia) {
    let leitura = [];
    try {
      const r = await chamarClaude(apiKey,
        `Você ajuda o dono da Primus Peixaria (restaurante de peixes em Cuiabá, só almoço). Escreva a leitura do dia em 3 a 6 tópicos curtos, ` +
        `tom direto de dono pra dono, usando SOMENTE os números destes fatos (não crie números). Não comente eventos da cidade.\n` +
        `Responda APENAS com o JSON {"leitura":["tópico 1","tópico 2"]}\n\nFATOS:\n${fatos}`, false);
      somar(r.uso);
      leitura = normalizar(extrairJson(r.texto)).leitura;
    } catch (e) {
      console.error(`[Claude ${dia}] leitura sem eventos falhou:`, e.message);
    }
    ia = { eventos: null, leitura };
  }

  // Só guarda no cache quando os eventos vieram (falha não fica salva: o próximo /previsao tenta de novo)
  const { FieldValue } = require("firebase-admin/firestore");
  const usoSomado = { entrada: FieldValue.increment(uso.entrada), saida: FieldValue.increment(uso.saida), buscas: FieldValue.increment(uso.buscas) };
  await ref.set({ ...(ia.eventos !== null ? { ia } : {}), uso: usoSomado, modelo: MODELO_CLAUDE, geradoEm: new Date().toISOString() }, { merge: true });
  console.log(`[Claude ${dia}] entrada ${uso.entrada} · saída ${uso.saida} · buscas ${uso.buscas}${ia.eventos === null ? " · SEM eventos" : ""}`);
  return ia;
}

// Leitura em tópicos: aceita lista (formato novo) ou texto corrido (cache antigo),
// que é quebrado em frases — sem quebrar "R$ 42.885" nem "08/11".
function topicosLeitura(leitura) {
  if (Array.isArray(leitura)) return leitura.map((t) => String(t).trim()).filter(Boolean);
  return String(leitura || "").split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú])/).map((t) => t.trim()).filter(Boolean);
}

function blocoEventosLeitura(ia) {
  const cor = { positivo: "🟢", negativo: "🔴" };
  if (ia.eventos === null) {
    const topicos = topicosLeitura(ia.leitura);
    return "🎉 <b>Eventos na cidade</b>\n<i>Não consegui verificar os eventos hoje. Se souber de algo na cidade, considere na leitura.</i>" +
      (topicos.length ? `\n\n🧠 <b>Leitura do dia</b>\n${topicos.map((t) => `• ${escHtml(t)}`).join("\n")}` : "");
  }
  const ev = (ia.eventos || []).filter((e) => e && e.nome);
  const linhasEv = ev.length
    ? ev.map((e) => `${cor[e.impacto] || "⚪"} <b>${escHtml(e.nome)}</b>` +
        (e.quando ? ` · ${escHtml(e.quando)}` : "") + (e.local ? ` · ${escHtml(e.local)}` : "") +
        (e.motivo ? `\n   <i>${escHtml(e.motivo)}</i>` : "")).join("\n")
    : "Nenhum evento relevante encontrado pra essa data.";
  const topicos = topicosLeitura(ia.leitura);
  return `🎉 <b>Eventos na cidade</b>\n${linhasEv}` +
    (topicos.length ? `\n\n🧠 <b>Leitura do dia</b>\n${topicos.map((t) => `• ${escHtml(t)}`).join("\n")}` : "");
}

// ===== PRIMUS PREVISÃO: WEBHOOK (bot separado) =====
// 🌤 Previsão / /previsao [dd/mm] · /pessoas · botões de pessoas por produto · /meuid.
// Quem pode usar: a mesma lista do painel (Usuarios -> Telegram); vazia -> só o dono.
// Cada pessoa precisa dar /start neste bot uma vez pra poder receber a previsão das 7h.
async function tratarUpdatePrevisao(upd, token, chatPadrao) {
  const cb = upd.callback_query;
  const msg = upd.message;
  const chat = String((cb ? (cb.message && cb.message.chat && cb.message.chat.id) : (msg && msg.chat && msg.chat.id)) || "");
  if (!chat) return;
  const texto = ((msg && msg.text) || "").trim();

  if (/^\/meuid(@\w+)?$/i.test(texto)) {
    await tgApi(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: `🆔 Seu chat id: <code>${chat}</code>` });
    return;
  }
  const autorizados = await chatsAutorizados(chatPadrao);
  if (!autorizados.has(chat)) {
    if (cb) await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Você não está autorizado." });
    else await tgApi(token, "sendMessage", { chat_id: chat, parse_mode: "HTML",
      text: `🔒 Você ainda não tem acesso.\n🆔 Seu chat id: <code>${chat}</code>\nPeça pro gestor cadastrar no Primus Pro (Usuários → Telegram).` });
    console.log(`[previsao bot] chat nao autorizado: ${chat}`);
    return;
  }

  if (cb) {
    if (/^p[pzc]/.test(cb.data || "")) await tratarCliquePessoas(cb, token);
    else await tgApi(token, "answerCallbackQuery", { callback_query_id: cb.id });
    return;
  }

  if (/^\/pessoas(@\w+)?$/i.test(texto)) {
    await mostrarProximoPendente(token, chat, null);
    return;
  }

  const mPrev = texto.match(/^\/previsao(?:@\w+)?\s*(.*)$/i);
  if (texto === BOTAO_PREVISAO || mPrev) {
    const dia = resolverDiaPrevisao(mPrev ? mPrev[1] : "");
    if (!dia) {
      await tgApi(token, "sendMessage", { chat_id: chat, parse_mode: "HTML",
        text: "\u2753 Use <code>/previsao</code> (hoje) ou <code>/previsao 22/11</code>." });
      return;
    }
    await tgApi(token, "sendMessage", { chat_id: chat, parse_mode: "HTML",
      text: `⏳ Montando a previsão de <b>${dBR(dia)}</b> (a busca de eventos leva uns 30s)...` });
    let resposta;
    try {
      let apiKey = "";
      try { apiKey = ANTHROPIC_API_KEY.value(); } catch (_) { /* sem chave: sai sem eventos */ }
      resposta = (await montarPrevisao(dia, true, { apiKey, usarCache: true })).texto;
    } catch (e) {
      console.error(`[previsao ${dia}] erro:`, e);
      resposta = `\u274c Erro ao montar a previs\u00e3o: ${escHtml(String(e.message || e).slice(0, 200))}`;
    }
    await tgApi(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: resposta });
    return;
  }

  // /start ou qualquer outra coisa: explica e (re)mostra o teclado
  await tgApi(token, "setMyCommands", { commands: [
    { command: "previsao", description: "Previsão do dia (ou /previsao 22/11)" },
    { command: "pessoas", description: "Quantas pessoas cada prato serve" },
    { command: "meuid", description: "Mostra o seu chat id" }] });
  await tgApi(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", reply_markup: TECLADO_PREVISAO,
    text: "🌤 <b>Primus Previsão</b>\nTodo dia de casa aberta, às 7h, chega aqui a previsão do dia: clima do almoço, vendas de referência, dias parecidos, eventos na cidade e a leitura do dia.\nToque em <b>🌤 Previsão</b> pra ver a de hoje, ou mande <code>/previsao 22/11</code>." });
}

exports.telegramPrevisao = onRequest(
  { region: REGIAO, timeoutSeconds: 300,
    secrets: [TELEGRAM_PREVISAO_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, ANTHROPIC_API_KEY] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(200).send("ok"); return; }
    if (req.get("X-Telegram-Bot-Api-Secret-Token") !== TELEGRAM_WEBHOOK_SECRET.value()) {
      res.status(403).send("forbidden"); return;
    }
    // A previsão com busca de eventos demora: se o Telegram reenviar o mesmo update, ignora.
    const updId = req.body && req.body.update_id;
    if (updId && await jaProcessado(`tgp_${updId}`)) { res.status(200).send("ok"); return; }
    try {
      await tratarUpdatePrevisao(req.body || {}, TELEGRAM_PREVISAO_TOKEN.value(), TELEGRAM_CHAT_ID.value());
    } catch (e) {
      console.error("[previsao webhook] erro:", e);
    }
    res.status(200).send("ok"); // sempre 200: senao o Telegram fica reenviando
  }
);

// ===== I.A. DA PRIMUS — analista de vendas no Telegram (só o dono) =====
// Conversa livre com o Claude, que consulta o banco por FERRAMENTAS SÓ DE LEITURA.
// As contas (somas, médias, rankings) são feitas aqui no código; o modelo interpreta.
// Memória: últimas mensagens em primus_ia_conversa/{chat} (/nova zera).
// Uso de tokens por dia em primus_ia_uso/{AAAA-MM-DD}.

const MODELO_IA = "claude-sonnet-5-5";
const IA_MAX_HISTORICO = 20;      // mensagens (pergunta + resposta) guardadas
const IA_MAX_VOLTAS = 12;         // rodadas por pergunta (a última é obrigada a responder, sem ferramenta)
const IA_MAX_DIAS = 1100;         // maior período que uma ferramenta aceita
const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// ---------- carga dos dias (vendas + clientes + vendedores + clima + feriado) ----------
async function carregarDiasIA(ini, fim, comProdutos = false) {
  if (!DIA_ISO.test(ini) || !DIA_ISO.test(fim)) throw new Error("datas devem ser AAAA-MM-DD");
  if (ini > fim) [ini, fim] = [fim, ini];
  if ((dParse(fim) - dParse(ini)) / 86400000 > IA_MAX_DIAS) throw new Error(`período maior que ${IA_MAX_DIAS} dias`);
  const mapa = await lerPessoasPorProduto();
  const snap = await db.collection("primus_vendas")
    .where(FieldPath.documentId(), ">=", ini).where(FieldPath.documentId(), "<=", fim)
    .select("totais", "vendedores", "vendedoresDetalhado", "produtos").get();
  const dias = [];
  snap.forEach((d) => {
    if (!DIA_ISO.test(d.id)) return;
    const v = d.data() || {};
    const total = Number((v.totais && v.totais.total) || 0);
    if (total <= 0) return;
    const c = clientesDoDia(v.produtos, mapa);
    const vend = (Array.isArray(v.vendedoresDetalhado) ? v.vendedoresDetalhado : []).filter((x) => x && !x.caixa);
    dias.push({
      data: d.id, total, itens: Number((v.totais && v.totais.qtd) || 0),
      clientes: Math.round(c.clientes), vendedores: contarVendedores(v),
      vendedoresDet: vend.map((x) => ({ nome: x.nome, total: Number(x.total) || 0, qtd: Number(x.totalQtd) || 0 })),
      produtos: comProdutos ? (v.produtos || []).map((p) => ({ nome: normProd(p.nome), qtd: Number(p.qtd) || 0, total: Number(p.total) || 0 })) : undefined,
    });
  });
  dias.sort((a, b) => a.data.localeCompare(b.data));
  // clima (cache) e feriados
  let clima = {};
  try { clima = await garantirClimaHistorico(dias.map((x) => x.data)); } catch (_) { /* segue sem clima */ }
  const anos = [...new Set(dias.map((x) => Number(x.data.slice(0, 4))))];
  const fer = {};
  for (const a of [...anos, Math.max(...anos, 0) + 1]) if (a) Object.assign(fer, await feriadosDoAno(a));
  dias.forEach((x) => {
    x.diaSemana = DIAS_SEMANA_LONGO[dDow(x.data)];
    x.feriado = fer[x.data] || null;
    const v = vesperaDe(x.data, fer);
    x.vespera = v ? `${v.nome} em ${v.dias} dia(s)` : null;
    x.fase = ["1-5", "6-10", "11-20", "21-31"][faseMes(x.data)];
    const c = clima[x.data];
    x.clima = c ? { tMax: c.tMax, chuvaAlmoco: !!c.chuva, mm: c.mm } : null;
  });
  return dias;
}

const r1 = (n) => Math.round(n * 10) / 10;
const r0 = (n) => Math.round(n);
function filtrarDiaSemana(dias, diaSemana) {
  if (!diaSemana) return dias;
  const alvo = String(diaSemana).toLowerCase().slice(0, 3);
  return dias.filter((x) => x.diaSemana.slice(0, 3) === alvo);
}
function resumoGrupo(ds) {
  const comCli = ds.filter((x) => x.clientes > 0);
  const comVend = ds.filter((x) => x.vendedores > 0);
  const fat = ds.reduce((s, x) => s + x.total, 0);
  const cli = comCli.reduce((s, x) => s + x.clientes, 0);
  return {
    dias: ds.length, faturamento_total: r0(fat), faturamento_medio_dia: r0(fat / (ds.length || 1)),
    clientes_medio_dia: comCli.length ? r0(cli / comCli.length) : null,
    ticket_medio_pessoa: cli ? r0(comCli.reduce((s, x) => s + x.total, 0) / cli) : null,
    vendedores_medio: comVend.length ? r1(media(comVend.map((x) => x.vendedores))) : null,
    clientes_por_vendedor: comVend.filter((x) => x.clientes).length
      ? r1(media(comVend.filter((x) => x.clientes).map((x) => x.clientes / x.vendedores))) : null,
    faturamento_por_vendedor: comVend.length ? r0(media(comVend.map((x) => x.total / x.vendedores))) : null,
  };
}

// ---------- ferramentas ----------
const FERRAMENTAS_IA = [
  { name: "resumo_periodo",
    description: "Resumo de vendas de um período, agrupado por dia, semana, mês ou dia da semana. Traz dias abertos, faturamento total e médio por dia, clientes estimados, ticket por pessoa, vendedores médios, clientes por vendedor e faturamento por vendedor.",
    input_schema: { type: "object", properties: {
      inicio: { type: "string", description: "AAAA-MM-DD" }, fim: { type: "string", description: "AAAA-MM-DD" },
      agrupar: { type: "string", enum: ["total", "dia", "semana", "mes", "dia_semana"] },
      dia_semana: { type: "string", description: "opcional: filtra um dia da semana (ex.: domingo)" } },
      required: ["inicio", "fim"] } },
  { name: "comparar_periodos",
    description: "Compara dois períodos (A e B) com os mesmos indicadores do resumo e a variação percentual de B sobre A. Use pra 'novembro deste ano x do ano passado', 'esta semana x a anterior' etc.",
    input_schema: { type: "object", properties: {
      a_inicio: { type: "string" }, a_fim: { type: "string" }, b_inicio: { type: "string" }, b_fim: { type: "string" },
      dia_semana: { type: "string", description: "opcional: compara só esse dia da semana" } },
      required: ["a_inicio", "a_fim", "b_inicio", "b_fim"] } },
  { name: "ranking_produtos",
    description: "Ranking de produtos vendidos no período (quantidade, faturamento, participação). Opcionalmente compara com um período anterior de referência e mostra quem mais cresceu/caiu.",
    input_schema: { type: "object", properties: {
      inicio: { type: "string" }, fim: { type: "string" },
      ordem: { type: "string", enum: ["faturamento", "quantidade", "crescimento"] },
      limite: { type: "integer", description: "padrão 15" },
      ref_inicio: { type: "string", description: "opcional: início do período de comparação" },
      ref_fim: { type: "string", description: "opcional: fim do período de comparação" },
      busca: { type: "string", description: "opcional: filtra produtos que contenham esse texto" } },
      required: ["inicio", "fim"] } },
  { name: "analise_vendedores",
    description: "Agrupa os dias pela quantidade de vendedores escalados (dentro do mesmo dia da semana, se informado) e mostra, pra cada quantidade: nº de dias, faturamento médio, clientes médios, clientes por vendedor e faturamento por vendedor. Serve pra discutir se vale escalar mais ou menos gente (saturação da equipe).",
    input_schema: { type: "object", properties: {
      inicio: { type: "string" }, fim: { type: "string" },
      dia_semana: { type: "string", description: "recomendado: comparar só o mesmo dia da semana" },
      sem_feriados: { type: "boolean", description: "padrão true" } },
      required: ["inicio", "fim"] } },
  { name: "desempenho_vendedores",
    description: "Desempenho de cada vendedor (garçom) no período: dias trabalhados, faturamento total e médio por dia, itens por dia, e a média do dia quando ele trabalhou.",
    input_schema: { type: "object", properties: {
      inicio: { type: "string" }, fim: { type: "string" }, dia_semana: { type: "string" } },
      required: ["inicio", "fim"] } },
  { name: "dias_detalhe",
    description: "Lista dia a dia (máx. 120 dias): data, dia da semana, feriado, faturamento, clientes, vendedores, temperatura máxima e chuva no almoço (11h–15h).",
    input_schema: { type: "object", properties: {
      inicio: { type: "string" }, fim: { type: "string" }, dia_semana: { type: "string" } },
      required: ["inicio", "fim"] } },
  { name: "comparar_tipos_de_dia",
    description: "Testa hipóteses comparando grupos de dias do mesmo dia da semana (sem feriados): 'vespera' (dias com feriado nos 3 dias seguintes x dias normais), 'fase_mes' (dias 1-5, 6-10, 11-20, 21-31: ciclo do salário), 'chuva' (com x sem chuva no almoço), 'tendencia' (últimas 3, 4-8 e 9-16 ocorrências) e 'ano' (por ano). Traz os indicadores do resumo por grupo e exemplos de datas.",
    input_schema: { type: "object", properties: {
      criterio: { type: "string", enum: ["vespera", "fase_mes", "chuva", "tendencia", "ano"] },
      dia_semana: { type: "string", description: "recomendado (ex.: quarta)" },
      inicio: { type: "string", description: "padrão: 2024-06-01" }, fim: { type: "string", description: "padrão: ontem" } },
      required: ["criterio"] } },
  { name: "previsao_dia",
    description: "A previsão calculada de um dia (até 16 dias à frente): clima do almoço, vendas de referência, dias parecidos, faixa provável, efeito chuva e, se já existir, os eventos encontrados de manhã.",
    input_schema: { type: "object", properties: { dia: { type: "string", description: "AAAA-MM-DD" } }, required: ["dia"] } },
];

async function executarFerramentaIA(nome, inp) {
  const lim = (n, d) => Math.max(1, Math.min(Number(n) || d, 50));
  if (nome === "resumo_periodo") {
    const dias = filtrarDiaSemana(await carregarDiasIA(inp.inicio, inp.fim), inp.dia_semana);
    const modo = inp.agrupar || "total";
    if (modo === "total") return { periodo: [inp.inicio, inp.fim], ...resumoGrupo(dias) };
    const chave = (x) => modo === "dia" ? x.data : modo === "mes" ? x.data.slice(0, 7)
      : modo === "dia_semana" ? x.diaSemana : (() => { const dt = dParse(x.data); dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); return "semana de " + dIso(dt); })();
    const g = {};
    dias.forEach((x) => (g[chave(x)] = g[chave(x)] || []).push(x));
    return { periodo: [inp.inicio, inp.fim], agrupado_por: modo,
      grupos: Object.entries(g).slice(0, 200).map(([k, ds]) => ({ grupo: k, ...resumoGrupo(ds) })) };
  }
  if (nome === "comparar_periodos") {
    const [a, b] = await Promise.all([carregarDiasIA(inp.a_inicio, inp.a_fim), carregarDiasIA(inp.b_inicio, inp.b_fim)]);
    const ra = resumoGrupo(filtrarDiaSemana(a, inp.dia_semana)), rb = resumoGrupo(filtrarDiaSemana(b, inp.dia_semana));
    const variacao = {};
    Object.keys(ra).forEach((k) => {
      if (typeof ra[k] === "number" && ra[k] && typeof rb[k] === "number") variacao[k] = `${r1((rb[k] / ra[k] - 1) * 100)}%`;
    });
    return { A: { periodo: [inp.a_inicio, inp.a_fim], ...ra }, B: { periodo: [inp.b_inicio, inp.b_fim], ...rb }, variacao_B_sobre_A: variacao };
  }
  if (nome === "ranking_produtos") {
    const somar = (dias) => {
      const m = {};
      dias.forEach((x) => (x.produtos || []).forEach((p) => {
        const a = m[p.nome] || (m[p.nome] = { produto: p.nome, quantidade: 0, faturamento: 0 });
        a.quantidade += p.qtd; a.faturamento += p.total;
      }));
      return m;
    };
    const dias = await carregarDiasIA(inp.inicio, inp.fim, true);
    const atual = somar(dias);
    const totalFat = Object.values(atual).reduce((s, x) => s + x.faturamento, 0);
    let ref = null;
    if (inp.ref_inicio && inp.ref_fim) ref = somar(await carregarDiasIA(inp.ref_inicio, inp.ref_fim, true));
    let lista = Object.values(atual).map((x) => {
      const o = { produto: x.produto, quantidade: r0(x.quantidade), faturamento: r0(x.faturamento),
        participacao: `${r1(x.faturamento / (totalFat || 1) * 100)}%` };
      if (ref) {
        const rq = ref[x.produto] ? ref[x.produto].quantidade : 0;
        o.quantidade_ref = r0(rq);
        o.variacao_qtd = rq ? `${r1((x.quantidade / rq - 1) * 100)}%` : "novo";
        o._delta = x.quantidade - rq;
      }
      return o;
    });
    if (inp.busca) lista = lista.filter((x) => x.produto.includes(String(inp.busca).toUpperCase()));
    const ordem = inp.ordem || "faturamento";
    lista.sort((a, b) => ordem === "quantidade" ? b.quantidade - a.quantidade
      : ordem === "crescimento" ? (b._delta || 0) - (a._delta || 0) : b.faturamento - a.faturamento);
    const n = lim(inp.limite, 15);
    const out = lista.slice(0, n).map(({ _delta, ...x }) => x);
    if (ordem === "crescimento") {   // maiores quedas, sem repetir quem já está na lista
      const resto = lista.slice(n);
      out.push(...resto.slice(-Math.min(5, resto.length)).reverse().map(({ _delta, ...x }) => ({ ...x, obs: "maiores quedas" })));
    }
    return { periodo: [inp.inicio, inp.fim], dias: dias.length, faturamento_total: r0(totalFat), produtos: out };
  }
  if (nome === "analise_vendedores") {
    let dias = filtrarDiaSemana(await carregarDiasIA(inp.inicio, inp.fim), inp.dia_semana).filter((x) => x.vendedores > 0);
    if (inp.sem_feriados !== false) dias = dias.filter((x) => !x.feriado);
    const g = {};
    dias.forEach((x) => (g[x.vendedores] = g[x.vendedores] || []).push(x));
    return { periodo: [inp.inicio, inp.fim], dia_semana: inp.dia_semana || "todos",
      observacao: "Dias cheios costumam receber mais vendedores: diferença de faturamento entre grupos não prova causa. Olhe clientes_por_vendedor pra ver saturação.",
      por_quantidade_de_vendedores: Object.keys(g).map(Number).sort((a, b) => a - b).map((k) => ({
        vendedores: k, ...resumoGrupo(g[k]),
        exemplos: g[k].slice(-3).map((x) => `${x.data} R$${r0(x.total)}`) })) };
  }
  if (nome === "desempenho_vendedores") {
    const dias = filtrarDiaSemana(await carregarDiasIA(inp.inicio, inp.fim), inp.dia_semana);
    const m = {};
    dias.forEach((x) => x.vendedoresDet.forEach((v) => {
      const a = m[v.nome] || (m[v.nome] = { vendedor: v.nome, dias: 0, faturamento: 0, itens: 0, fatDiaCasa: 0 });
      a.dias++; a.faturamento += v.total; a.itens += v.qtd; a.fatDiaCasa += x.total;
    }));
    return { periodo: [inp.inicio, inp.fim], dias_abertos: dias.length,
      vendedores: Object.values(m).sort((a, b) => b.faturamento - a.faturamento).map((a) => ({
        vendedor: a.vendedor, dias_trabalhados: a.dias, faturamento_total: r0(a.faturamento),
        faturamento_medio_dia: r0(a.faturamento / a.dias), itens_medio_dia: r1(a.itens / a.dias),
        faturamento_medio_da_casa_nos_dias_dele: r0(a.fatDiaCasa / a.dias) })) };
  }
  if (nome === "comparar_tipos_de_dia") {
    const ini = inp.inicio || "2024-06-01", fim = inp.fim || dAdd(hojeCuiaba(), -1);
    const dias = filtrarDiaSemana(await carregarDiasIA(ini, fim), inp.dia_semana).filter((x) => !x.feriado);
    const n = dias.length;
    const chave = {
      vespera: (x) => (x.vespera ? "antes de feriado" : "normal"),
      fase_mes: (x) => `dias ${x.fase}`,
      chuva: (x) => (!x.clima ? "sem dado de clima" : x.clima.chuvaAlmoco ? "com chuva no almoço" : "sem chuva no almoço"),
      tendencia: (x, i) => (i >= n - 3 ? "últimas 3" : i >= n - 8 ? "4ª a 8ª mais recentes" : i >= n - 16 ? "9ª a 16ª" : null),
      ano: (x) => x.data.slice(0, 4),
    }[inp.criterio];
    if (!chave) throw new Error("criterio inválido");
    const g = {};
    dias.forEach((x, i) => { const k = chave(x, i); if (k) (g[k] = g[k] || []).push(x); });
    return { criterio: inp.criterio, dia_semana: inp.dia_semana || "todos", periodo: [ini, fim],
      observacao: "Feriados excluídos. Grupos com poucos dias (menos de 4) são fracos pra concluir.",
      grupos: Object.entries(g).map(([k, ds]) => ({ grupo: k, ...resumoGrupo(ds),
        exemplos: ds.slice(-4).map((x) => `${x.data} R$${r0(x.total)}${x.vespera ? " (" + x.vespera + ")" : ""}`) })) };
  }
  if (nome === "dias_detalhe") {
    const dias = filtrarDiaSemana(await carregarDiasIA(inp.inicio, inp.fim), inp.dia_semana).slice(-120);
    return { dias: dias.map((x) => ({ data: x.data, dia_semana: x.diaSemana, feriado: x.feriado,
      vespera_de_feriado: x.vespera, fase_mes: x.fase,
      faturamento: r0(x.total), clientes: x.clientes, vendedores: x.vendedores,
      temp_max: x.clima ? x.clima.tMax : null, chuva_almoco: x.clima ? x.clima.chuvaAlmoco : null })) };
  }
  if (nome === "previsao_dia") {
    if (!DIA_ISO.test(inp.dia || "")) throw new Error("dia deve ser AAAA-MM-DD");
    const r = await montarPrevisao(inp.dia, true, {});   // sem nova busca de eventos (não gasta)
    const s = await db.collection("primus_previsoes").doc(inp.dia).get();
    const ia = s.exists ? s.data().ia : null;
    return { previsao: r.texto.replace(/<[^>]+>/g, ""), eventos_encontrados_de_manha: ia ? ia.eventos : "ainda não buscados pra esse dia",
      faixa_oficial_das_7h: s.exists && s.data().faixa ? s.data().faixa : null,
      realizado: s.exists && s.data().realizado ? s.data().realizado : "ainda não fechou / não lançado" };
  }
  throw new Error(`ferramenta desconhecida: ${nome}`);
}

// ---------- conversa ----------
function promptSistemaIA(nome, ehDono) {
  const hoje = hojeCuiaba();
  const quem = ehDono ? "Você está conversando com o Jhonathan, o dono." : `Você está conversando com ${nome || "alguém da gestão"}, da gestão da Primus (o dono, Jhonathan, liberou o acesso).`;
  return `Você é a Pri, a inteligência artificial da Primus: analista de dados e parceira de decisão da gestão da Primus Peixaria (restaurante de peixes no São Gonçalo Beira Rio, Cuiabá-MT; só almoço, 11h–15h, quarta a domingo e feriados; estacionamento próprio).
${quem}
Hoje é ${DIAS_SEMANA_LONGO[dDow(hoje)]}, ${hoje}. O histórico de vendas vai de junho/2024 até ontem.

COMO TRABALHAR
- Planeje antes: peça de uma vez, na mesma rodada, todas as consultas que precisar (várias ferramentas juntas). Use no máximo umas 5 consultas por pergunta e depois responda com o que tiver.
- Pra explicar por que um dia vendeu diferente do previsto, use previsao_dia (traz a faixa das 7h e o realizado) e comparar_tipos_de_dia (vespera, fase_mes, chuva, tendencia) no mesmo dia da semana.
- Antes de afirmar qualquer número, consulte as ferramentas. Nunca invente nem estime número que não veio delas. Se o dado não existe no banco (custos, escala futura, opinião dos clientes), diga que não tem.
- Você é parceira de debate, não puxa-saco: dê sua opinião clara, concorde quando os dados apoiam e discorde quando não apoiam, explicando o porquê.
- Cuidado com conclusão fácil: correlação não é causa. Ex.: dias com mais vendedores vendem mais porque já se escala mais gente nos dias cheios. Compare sempre o mesmo dia da semana, separe feriados e chuva, e olhe clientes por vendedor pra ver saturação.
- Quando os dados não decidem, proponha um teste prático (ex.: +1 vendedor em 3 domingos parecidos e comparar com os anteriores).
- Diga o tamanho da amostra quando ela for pequena.

COMO A PREVISÃO DAS 7H É FEITA (pra você explicar acertos e erros)
- Referências: média dos últimos 8 dias iguais (mesmo dia da semana, sem feriado), mesma posição no mês e mesma data nos anos anteriores.
- Dias parecidos: candidatos do mesmo dia da semana (ou outros feriados, se o dia é feriado). Pontuação: chuva no almoço diferente pesa 3, véspera de feriado diferente pesa 3, cada 3°C de diferença pesa 1, fase do mês diferente (1-5, 6-10, 11-20, 21-31) pesa 1, e cada ano de idade pesa 1,5 (dias recentes valem mais).
- Faixa provável: do percentil 25 ao 75 dos 8 dias mais parecidos — ou seja, por construção, metade dos dias cai fora da faixa. Em véspera de feriado com efeito medido, os dias normais da faixa são ajustados por esse efeito.
- Efeito chuva: mesmo tipo de dia no último ano, com x sem chuva no almoço. Tendência: últimos 3 x média de referência (só aparece se passar de 10%).
- Eventos e a leitura do dia vêm de uma busca na web feita às 7h.
- O que a previsão NÃO vê: reservas, escala real do dia, problemas de operação, obras/trânsito não noticiados, tempo fechado sem chuva. Quando o realizado fugir muito, considere isso e pergunte.

DEFINIÇÕES
- Clientes = estimativa (quantidade de cada prato × pessoas que ele serve; bebidas e sobremesas contam 0).
- Vendedores = garçons com venda no dia (sem o caixa).
- Faturamento = total do relatório do Gestor Food do dia.

FORMATO (Telegram, texto puro, sem markdown, sem tabelas)
- Respostas curtas e diretas, de dono pra dono. Use quebras de linha e "•" pra tópicos. Valores como R$ 12.345. Emojis com moderação.
- Termine com sua recomendação ou uma pergunta que faça a conversa avançar.`;
}

async function chamarClaudeIA(apiKey, messages, sistema, semFerramenta = false) {
  const tools = FERRAMENTAS_IA.map((t, i) => (i === FERRAMENTAS_IA.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t));
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(120000),
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO_IA, max_tokens: 2000, system: sistema, tools, messages,
      ...(semFerramenta ? { tool_choice: { type: "none" } } : {}) }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`API do Claude ${r.status}: ${(j.error && j.error.message) || "erro"}`);
  return j;
}

async function responderIA(chat, pergunta, token, apiKey, sistema) {
  const ref = db.collection("primus_ia_conversa").doc(chat);
  const s = await ref.get();
  const historico = (s.exists && s.data().mensagens) || [];
  const messages = [...historico.map((m) => ({ role: m.role, content: m.texto })), { role: "user", content: pergunta }];
  const uso = { entrada: 0, saida: 0, cache: 0, cacheEscrita: 0, ferramentas: 0 };
  let resposta = null;

  for (let volta = 0; volta < IA_MAX_VOLTAS && resposta === null; volta++) {
    await tgApi(token, "sendChatAction", { chat_id: chat, action: "typing" });
    const ultima = volta === IA_MAX_VOLTAS - 1;   // última rodada: responde com o que já tem
    const j = await chamarClaudeIA(apiKey, messages, sistema, ultima);
    uso.entrada += (j.usage && j.usage.input_tokens) || 0;
    uso.saida += (j.usage && j.usage.output_tokens) || 0;
    uso.cache += (j.usage && j.usage.cache_read_input_tokens) || 0;
    uso.cacheEscrita += (j.usage && j.usage.cache_creation_input_tokens) || 0;
    const usos = (j.content || []).filter((b) => b.type === "tool_use");
    if (j.stop_reason === "tool_use" && usos.length) {
      messages.push({ role: "assistant", content: j.content });
      const resultados = [];
      for (const u of usos) {
        uso.ferramentas++;
        let conteudo, erro = false;
        try {
          conteudo = JSON.stringify(await executarFerramentaIA(u.name, u.input || {}));
        } catch (e) {
          conteudo = `Erro: ${e.message}`; erro = true;
        }
        console.log(`[IA] ${u.name} ${JSON.stringify(u.input)} -> ${conteudo.length} chars${erro ? " (erro)" : ""}`);
        resultados.push({ type: "tool_result", tool_use_id: u.id, content: conteudo.slice(0, 60000), is_error: erro });
      }
      messages.push({ role: "user", content: resultados });
      continue;
    }
    resposta = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }
  if (!resposta) resposta = "Não consegui fechar a análise dessa vez. Tenta de novo ou divide a pergunta em partes?";

  // guarda só o texto (pergunta e resposta) — as consultas são refeitas quando precisar
  const novo = [...historico, { role: "user", texto: pergunta }, { role: "assistant", texto: resposta }].slice(-IA_MAX_HISTORICO);
  await ref.set({ mensagens: novo, atualizadoEm: new Date().toISOString() });
  const { FieldValue } = require("firebase-admin/firestore");
  await db.collection("primus_ia_uso").doc(hojeCuiaba()).set({
    perguntas: FieldValue.increment(1), entrada: FieldValue.increment(uso.entrada), saida: FieldValue.increment(uso.saida),
    cache: FieldValue.increment(uso.cache), cacheEscrita: FieldValue.increment(uso.cacheEscrita),
    ferramentas: FieldValue.increment(uso.ferramentas) }, { merge: true });
  return resposta;
}

async function enviarTextoLongo(token, chat, texto) {
  for (let i = 0; i < texto.length; i += 3800) {
    await tgApi(token, "sendMessage", { chat_id: chat, text: texto.slice(i, i + 3800) });
  }
}

// Quem pode usar a Pri: o dono (TELEGRAM_CHAT_ID) + primus_config/ia.autorizados { chatId: nome }.
// O dono libera/bloqueia pelo próprio bot: /liberar <id> [nome] · /bloquear <id> · /acessos
const REF_IA_CONFIG = () => db.collection("primus_config").doc("ia");
async function autorizadosIA() {
  const s = await REF_IA_CONFIG().get();
  return (s.exists && s.data().autorizados) || {};
}

async function tratarUpdateIA(upd, token, chatDono, apiKey) {
  const msg = upd.message;
  if (!msg || !msg.chat) return;
  const chat = String(msg.chat.id);
  const texto = (msg.text || "").trim();
  const nome = (msg.from && msg.from.first_name) || "";
  const ehDono = chat === String(chatDono);

  if (ehDono) {
    const mLib = texto.match(/^\/liberar(?:@\w+)?\s+(-?\d{5,20})(?:\s+(.+))?$/i);
    if (mLib) {
      await REF_IA_CONFIG().set({ autorizados: { [mLib[1]]: (mLib[2] || "").trim() || "sem nome" } }, { merge: true });
      await tgApi(token, "sendMessage", { chat_id: chat, text: `✅ Acesso liberado pro chat ${mLib[1]}${mLib[2] ? ` (${mLib[2].trim()})` : ""}. Peça pra ${mLib[2] ? mLib[2].trim() : "a pessoa"} mandar /start.` });
      return;
    }
    const mBlo = texto.match(/^\/bloquear(?:@\w+)?\s+(-?\d{5,20})$/i);
    if (mBlo) {
      const lista = await autorizadosIA();
      delete lista[mBlo[1]];
      await REF_IA_CONFIG().set({ autorizados: lista });
      await db.collection("primus_ia_conversa").doc(mBlo[1]).delete().catch(() => {});
      await tgApi(token, "sendMessage", { chat_id: chat, text: `🚫 Acesso removido do chat ${mBlo[1]} (e a conversa dele apagada).` });
      return;
    }
    const mCus = texto.match(/^\/custos(?:@\w+)?\s*(\d{1,2}\/\d{4})?$/i);
    if (mCus) {
      await tgApi(token, "sendChatAction", { chat_id: chat, action: "typing" });
      let ini, fim;
      if (mCus[1]) {
        const [m, a] = mCus[1].split("/").map(Number);
        ini = `${a}-${String(m).padStart(2, "0")}-01`;
        fim = dAdd(`${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
      }
      await tgApi(token, "sendMessage", { chat_id: chat, text: await textoCustos(ini, fim) });
      return;
    }
    if (/^\/acessos(@\w+)?$/i.test(texto)) {
      const lista = await autorizadosIA();
      const linhas = Object.entries(lista).map(([id, n]) => `• ${n} — ${id}`);
      await tgApi(token, "sendMessage", { chat_id: chat, text: "🔑 Quem usa a Pri:\n• você (dono)\n" + (linhas.join("\n") || "(ninguém mais)") +
        "\n\nPra liberar: /liberar <número> <nome>\nPra tirar: /bloquear <número>" });
      return;
    }
  } else {
    const lista = await autorizadosIA();
    if (!(chat in lista)) {
      await tgApi(token, "sendMessage", { chat_id: chat,
        text: `🔒 Oi${nome ? ", " + nome : ""}! A Pri é de uso da gestão da Primus.\nSeu número: ${chat}\nMande esse número pro Jhonathan liberar o acesso.` });
      console.log(`[IA] chat nao autorizado: ${chat} (${nome})`);
      return;
    }
  }

  if (!texto) {
    await tgApi(token, "sendMessage", { chat_id: chat, text: "Por enquanto eu só entendo texto. 🙂" });
    return;
  }
  if (/^\/(start|ajuda)(@\w+)?$/i.test(texto)) {
    await tgApi(token, "setMyCommands", { commands: [
      { command: "nova", description: "Começar uma conversa nova (esquece o contexto)" },
      { command: "ajuda", description: "Como usar" }] });
    if (ehDono) await tgApi(token, "setMyCommands", { scope: { type: "chat", chat_id: Number(chat) }, commands: [
      { command: "nova", description: "Começar uma conversa nova (esquece o contexto)" },
      { command: "acessos", description: "Quem pode usar a Pri" },
      { command: "custos", description: "Quanto a I.A. gastou no mês (ou /custos 10/2026)" },
      { command: "ajuda", description: "Como usar" }] });
    await tgApi(token, "sendMessage", { chat_id: chat, text:
      "🧠 Oi, eu sou a Pri, a inteligência artificial da Primus!\n\nSou sua analista. Tenho acesso (só leitura) às vendas desde jun/2024: faturamento, clientes, vendedores, produtos, clima e previsões.\n\n" +
      "Pergunte ou debata comigo, por exemplo:\n• Como foi novembro x novembro do ano passado?\n• Qual prato mais cresceu nos últimos 3 meses?\n• Vale chamar mais um vendedor no domingo?\n\n/nova começa uma conversa do zero." });
    return;
  }
  if (/^\/nova(@\w+)?$/i.test(texto)) {
    await db.collection("primus_ia_conversa").doc(chat).delete().catch(() => {});
    await tgApi(token, "sendMessage", { chat_id: chat, text: "🧹 Conversa nova. Pode perguntar." });
    return;
  }
  let resposta;
  try {
    resposta = await responderIA(chat, texto, token, apiKey, promptSistemaIA(nome, ehDono));
  } catch (e) {
    console.error("[IA] erro:", e);
    resposta = `❌ Deu erro na análise: ${String(e.message || e).slice(0, 200)}`;
  }
  await enviarTextoLongo(token, chat, resposta);
}

exports.telegramIA = onRequest(
  { region: REGIAO, timeoutSeconds: 300, memory: "512MiB",
    secrets: [TELEGRAM_IA_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, ANTHROPIC_API_KEY] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(200).send("ok"); return; }
    if (req.get("X-Telegram-Bot-Api-Secret-Token") !== TELEGRAM_WEBHOOK_SECRET.value()) {
      res.status(403).send("forbidden"); return;
    }
    const updId = req.body && req.body.update_id;
    if (updId && await jaProcessado(`tgia_${updId}`)) { res.status(200).send("ok"); return; }
    try {
      await tratarUpdateIA(req.body || {}, TELEGRAM_IA_TOKEN.value(), TELEGRAM_CHAT_ID.value(), ANTHROPIC_API_KEY.value());
    } catch (e) {
      console.error("[IA webhook] erro:", e);
    }
    res.status(200).send("ok");
  }
);
// ===== GOOGLE MEU NEGÓCIO (avaliações) — módulo separado: functions/avaliacoes.js =====
// Bot Google Meu Negócio: checarAvaliacoes (todo dia às 10h) + webhook telegramGmn.
Object.assign(exports, require("./avaliacoes")({ REGIAO, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, ANTHROPIC_API_KEY }));

// ===== PREVISÃO × REALIZADO =====
// Quando as vendas de um dia recente chegam, compara com a faixa prevista e avisa no
// Primus Previsão. Não roda pra venda parcial (/vendas hoje antes das 16h) nem pro lote.
async function conferirRealizado(dia, vendasDia, token, chatPadrao) {
  if (!token) return;
  const hoje = hojeCuiaba();
  if (dia < dAdd(hoje, -2)) return;
  const horaCuiaba = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Cuiaba", hour: "2-digit", hour12: false }).format(new Date()));
  if (dia === hoje && horaCuiaba < 16) return;   // ainda no meio do expediente
  const total = Number((vendasDia.totais && vendasDia.totais.total) || 0);
  if (total <= 0) return;
  const ref = db.collection("primus_previsoes").doc(dia);
  const s = await ref.get();
  const prev = s.exists ? s.data() : null;
  if (!prev || !prev.faixa) return;
  const ant = prev.realizado && prev.realizado.total;
  if (ant && Math.abs(total - ant) / ant < 0.02) return;   // já avisado com esse valor

  const { min, max } = prev.faixa;
  let veredito;
  if (total < min) veredito = `⚠️ <b>${Math.round((1 - total / min) * 100)}% abaixo do piso</b>`;
  else if (total > max) veredito = `🚀 <b>${Math.round((total / max - 1) * 100)}% acima do teto</b>`;
  else veredito = "✅ <b>Dentro da faixa</b>";
  await ref.set({ realizado: { total, em: new Date().toISOString(),
    resultado: total < min ? "abaixo" : total > max ? "acima" : "dentro" } }, { merge: true });

  // placar dos últimos 30 dias com previsão oficial
  const snap = await db.collection("primus_previsoes").where(FieldPath.documentId(), ">=", dAdd(hoje, -30)).get();
  const placar = { dentro: 0, abaixo: 0, acima: 0 };
  snap.forEach((d) => { const r = d.data().realizado; if (r && placar[r.resultado] !== undefined) placar[r.resultado]++; });
  const n = placar.dentro + placar.abaixo + placar.acima;

  const texto = `🎯 <b>Previsão × realizado — ${DIAS_SEMANA_LONGO[dDow(dia)]}, ${dBR(dia)}</b>\n` +
    `Vendemos <b>${brl(total)}</b> · faixa prevista ${brl(min)} a ${brl(max)}\n${veredito}` +
    (n >= 3 ? `\n<i>Últimos 30 dias: ${placar.dentro} dentro · ${placar.abaixo} abaixo · ${placar.acima} acima (${n} dias)</i>` : "") +
    (ant ? "\n<i>(valor atualizado)</i>" : "");
  await enviarTelegram(token, chatPadrao, texto);
}

// ===== CUSTOS DA I.A. (estimativa pelos tokens registrados) =====
// Preços do Claude Sonnet 5.5 em US$ por milhão de tokens; busca na web por unidade.
// Se a Anthropic mudar o preço, atualizar aqui. Valor oficial: Console → Gastos e uso.
const PRECO_IA = { entrada: 2, saida: 10, cacheLeitura: 0.20, cacheEscrita: 2.50, busca: 0.01 };
const usd = (v) => "US$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reais = (v) => "R$ " + (v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function cotacaoDolar() {
  try {
    const j = await buscarJson("https://economia.awesomeapi.com.br/json/last/USD-BRL");
    const v = Number(j && j.USDBRL && j.USDBRL.bid);
    return v > 0 ? v : null;
  } catch (_) { return null; }
}

async function somarCustos(ini, fim) {
  const porId = (col) => db.collection(col).where(FieldPath.documentId(), ">=", ini).where(FieldPath.documentId(), "<=", fim).get();
  const [sPri, sPrev, sGmn] = await Promise.all([porId("primus_ia_uso"), porId("primus_previsoes"), porId("primus_gmn_uso")]);
  const pri = { perguntas: 0, usd: 0 }, prev = { dias: 0, buscas: 0, usd: 0 }, gmn = { chamadas: 0, usd: 0 };
  sGmn.forEach((d) => {
    const u = d.data() || {};
    gmn.chamadas += u.chamadas || 0;
    gmn.usd += ((u.entrada || 0) * PRECO_IA.entrada + (u.saida || 0) * PRECO_IA.saida) / 1e6;
  });
  sPri.forEach((d) => {
    const u = d.data() || {};
    pri.perguntas += u.perguntas || 0;
    pri.usd += ((u.entrada || 0) * PRECO_IA.entrada + (u.saida || 0) * PRECO_IA.saida +
      (u.cache || 0) * PRECO_IA.cacheLeitura + (u.cacheEscrita || 0) * PRECO_IA.cacheEscrita) / 1e6;
  });
  sPrev.forEach((d) => {
    const u = (d.data() || {}).uso;
    if (!u) return;
    prev.dias++;
    prev.buscas += u.buscas || 0;
    prev.usd += ((u.entrada || 0) * PRECO_IA.entrada + (u.saida || 0) * PRECO_IA.saida) / 1e6 + (u.buscas || 0) * PRECO_IA.busca;
  });
  return { pri, prev, gmn, total: pri.usd + prev.usd + gmn.usd };
}

// Texto do /custos e do resumo de segunda. Sem período: mês atual até hoje, com projeção.
async function textoCustos(ini, fim) {
  const hoje = hojeCuiaba();
  const mesAtual = !ini;
  if (mesAtual) { ini = hoje.slice(0, 8) + "01"; fim = hoje; }
  const [c, dolar] = await Promise.all([somarCustos(ini, fim), cotacaoDolar()]);
  const emReais = (v) => (dolar ? ` (≈ ${reais(v * dolar)})` : "");
  const nomeMes = MESES_PT[Number(ini.slice(5, 7)) - 1];
  const linhas = [
    `💰 Custos da I.A. — ${nomeMes}/${ini.slice(0, 4)}${mesAtual ? ` (até ${dBR(hoje)})` : ""}`,
    "",
    `🧠 Pri: ${c.pri.perguntas} pergunta(s) · ${usd(c.pri.usd)}`,
    `🌤 Previsão: ${c.prev.dias} dia(s) · ${c.prev.buscas} busca(s) na web · ${usd(c.prev.usd)}`,
    `⭐ Avaliações do Google: ${c.gmn.chamadas} sugestão(ões) de resposta · ${usd(c.gmn.usd)}`,
    `Total: ${usd(c.total)}${emReais(c.total)}`,
  ];
  if (mesAtual) {
    const diasPassados = Number(hoje.slice(8, 10));
    const diasMes = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0)).getUTCDate();
    const proj = c.total / diasPassados * diasMes;
    const cHoje = await somarCustos(hoje, hoje);
    linhas.push(`📈 Projeção do mês: ${usd(proj)}${emReais(proj)}`, `Hoje: ${usd(cHoje.total)}`);
  }
  linhas.push("", `Estimativa pelos tokens registrados${dolar ? ` · dólar a ${reais(dolar)}` : ""}. Avaliações contam a partir de 19/11. Valor oficial: Console da Anthropic → Gastos e uso.`);
  return linhas.join("\n");
}

// Resumo automático: toda segunda às 9h, na conversa do dono com a Pri.
exports.resumoCustosIA = onSchedule(
  { schedule: "0 9 * * 1", timeZone: "America/Cuiaba", region: REGIAO, secrets: [TELEGRAM_IA_TOKEN, TELEGRAM_CHAT_ID] },
  async () => {
    try {
      const hoje = hojeCuiaba();
      const semana = await somarCustos(dAdd(hoje, -7), dAdd(hoje, -1));
      const texto = `📊 Semana passada: ${usd(semana.total)} (Pri ${usd(semana.pri.usd)} · previsão ${usd(semana.prev.usd)} · avaliações ${usd(semana.gmn.usd)})\n\n` + await textoCustos();
      await tgApi(TELEGRAM_IA_TOKEN.value(), "sendMessage", { chat_id: TELEGRAM_CHAT_ID.value(), text: texto });
    } catch (e) {
      console.error("[custos] erro no resumo semanal:", e);
    }
  }
);
