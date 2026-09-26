// ===== CLOUD FUNCTIONS — PRIMUS (notificações push) =====
// Dispara uma notificação para os gestores quando uma contagem é salva.
// Lê os tokens de primus_push_tokens e envia via FCM.

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
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

// ===== GATILHO: contagem criada =====
exports.notificarContagem = onDocumentCreated(
  { document: "primus_contagens/{id}", region: REGIAO, secrets: [TELEGRAM_TOKEN, TELEGRAM_CHAT_ID] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const c = snap.data() || {};

    // Correções/edições do gestor NÃO notificam (não são contagens novas).
    if (c.origem === "correcao") {
      console.log("[notificarContagem] doc é correção — não notifica");
      return;
    }

    // Ignora entregas repetidas do mesmo evento (at-least-once do Gen2).
    if (await jaProcessado(event.id)) {
      console.log("[notificarContagem] evento repetido, ignorando:", event.id);
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

    // INÍCIO do dia: manda no Telegram a virada D-1 (final anterior × início de hoje).
    if (c.tipo === "ini") {
      try {
        await enviarDiferencasD1(c, TELEGRAM_TOKEN.value(), TELEGRAM_CHAT_ID.value());
      } catch (e) {
        console.error("[D-1 telegram] erro:", e);
      }
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
