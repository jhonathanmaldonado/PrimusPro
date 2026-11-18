// ===== GOOGLE MEU NEGÓCIO — respostas às avaliações pelo Telegram =====
// Bot próprio (Google Meu Negócio / @primus_gmn_bot). Fluxo:
//   1) checarAvaliacoes (todo dia às 10h de Cuiabá) lê as avaliações SEM resposta
//      no Google Business Profile;
//   2) o Claude escreve uma sugestão de resposta no padrão "— Equipe Primus";
//   3) chega no Telegram do dono com ✅ Publicar · ✏️ Editar · 🔄 Outra · ⏭️ Pular;
//   4) Publicar grava a resposta no Google (PUT .../reviews/{id}/reply).
// Estado de cada avaliação em primus_avaliacoes/{id16} (id16 = sha1 do reviewId,
// porque o callback_data do Telegram tem limite de 64 bytes).
// Só o dono (secret TELEGRAM_CHAT_ID) usa este bot: a resposta é pública.

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

// Credenciais do Google (cliente OAuth "Primus Avaliações") e token do bot.
const GMN_CLIENT_ID = defineSecret("GMN_CLIENT_ID");
const GMN_CLIENT_SECRET = defineSecret("GMN_CLIENT_SECRET");
const GMN_REFRESH_TOKEN = defineSecret("GMN_REFRESH_TOKEN");
const TELEGRAM_GMN_TOKEN = defineSecret("TELEGRAM_GMN_TOKEN");

// Perfil da Primus no Google (descobertos pelo OAuth Playground em 18/11/2026).
const CONTA = "accounts/103962172510751015819";
const LOCAL = "locations/10683815948923209758";
const BASE_REVIEWS = `https://mybusiness.googleapis.com/v4/${CONTA}/${LOCAL}/reviews`;

const MODELO = "claude-sonnet-5-5";
const MAX_POR_RODADA = 15;         // no máx. 15 avaliações novas por checagem
const ESTRELAS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
// Botões fixos embaixo da conversa (teclado do bot).
const BOTAO_CHECAR = "🔎 Checar";
const BOTAO_PENDENTES = "📬 Pendentes";
const TECLADO_GMN = { keyboard: [[{ text: BOTAO_CHECAR }, { text: BOTAO_PENDENTES }]], resize_keyboard: true, is_persistent: true };

module.exports = function avaliacoes({ REGIAO, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, ANTHROPIC_API_KEY }) {
  const db = getFirestore();
  const COL = () => db.collection("primus_avaliacoes");
  const REF_ESTADO = () => db.collection("primus_config").doc("gmn");

  // ---------- utilidades ----------
  const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const idCurto = (reviewId) => crypto.createHash("sha1").update(String(reviewId)).digest("hex").slice(0, 16);
  const dataBR = (iso) => {
    const d = new Date(iso || Date.now());
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "2-digit", year: "2-digit" }).format(d);
  };
  // O Google devolve o texto com a tradução junto. Fica só o original.
  //   avaliação em PT:    "texto\n\n(Translated by Google)\nEnglish..."
  //   avaliação em outra: "(Translated by Google) ...\n\n(Original)\ntexto"
  function textoOriginal(c) {
    const s = String(c || "");
    const i = s.indexOf("(Original)");
    if (i >= 0) return s.slice(i + "(Original)".length).trim();
    const j = s.indexOf("(Translated by Google)");
    return (j >= 0 ? s.slice(0, j) : s).trim();
  }
  const comAssinatura = (t) => (/equipe primus\s*$/i.test(String(t).trim()) ? String(t).trim() : `${String(t).trim()} — Equipe Primus`);

  async function tg(token, metodo, params) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) console.error(`[gmn tg ${metodo}] falha:`, r.status, JSON.stringify(j).slice(0, 300));
      return j;
    } catch (e) {
      console.error(`[gmn tg ${metodo}] erro de rede:`, e);
      return {};
    }
  }

  // Entrega repetida do Telegram (mesmo update_id) é ignorada.
  async function jaProcessado(chave) {
    const ref = db.collection("primus_push_dedup").doc(chave);
    try {
      return await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return true;
        tx.set(ref, { em: new Date().toISOString() });
        return false;
      });
    } catch (e) {
      console.error("[gmn dedup] erro:", e);
      return false;
    }
  }

  // ---------- Google Business Profile ----------
  let _token = null;
  async function tokenGoogle() {
    if (_token && _token.exp > Date.now() + 60000) return _token.valor;
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GMN_CLIENT_ID.value(), client_secret: GMN_CLIENT_SECRET.value(),
        refresh_token: GMN_REFRESH_TOKEN.value(), grant_type: "refresh_token",
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`Google OAuth ${r.status}: ${j.error || ""} ${j.error_description || ""}`.trim());
    _token = { valor: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return _token.valor;
  }

  async function google(metodo, url, corpo) {
    const r = await fetch(url, {
      method: metodo,
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${await tokenGoogle()}`, "Content-Type": "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Google ${r.status}: ${(j.error && j.error.message) || "erro"}`);
    return j;
  }

  // As 100 avaliações mais recentes; devolve só as que estão sem resposta.
  async function listarSemResposta(paginas = 2) {
    const out = [];
    let pageToken = "";
    for (let p = 0; p < paginas; p++) {
      const j = await google("GET", `${BASE_REVIEWS}?pageSize=50&orderBy=updateTime%20desc` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""));
      (j.reviews || []).forEach((r) => { if (!r.reviewReply) out.push(r); });
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
    return out;
  }

  // ---------- sugestão de resposta (Claude) ----------
  const PROMPT_BASE =
`Você escreve as respostas do restaurante Primus Peixaria às avaliações do Google. A resposta é pública e assinada pela casa.

SOBRE A CASA (use só o que combinar com o que o cliente falou; nunca invente nada além disso):
- Peixaria à beira do Rio Cuiabá, no São Gonçalo Beira Rio, em Cuiabá-MT. Almoço de quarta a domingo e feriados, das 11h às 15h. Estacionamento próprio.
- Cardápio 100% sem glúten (seguro pra celíacos), sorvetes artesanais, deck à beira do rio, sombra da tamarineira, espaço kids com monitora.
- Clássicos: bolinho de peixe, pastel de peixe, peixada cuiabana, pintado, ventrecha, pacu com farofa de banana.

REGRAS:
- Português do Brasil, tom caloroso e natural, de gente da casa. Nada de clichê de robô nem exagero.
- Comece pelo primeiro nome da pessoa, só se parecer nome de gente. Se for empresa, e-mail ou apelido estranho, comece sem nome.
- Comente algo específico do que a pessoa escreveu (prato, ocasião, detalhe). Se citou um garçom ou funcionário pelo nome, diga que o elogio foi repassado a ele.
- Só nota, sem texto: uma frase curta de agradecimento e convite pra voltar.
- 4 estrelas sem texto: agradeça e convide a contar o que faltou pra nota máxima.
- 1 a 3 estrelas, ou qualquer reclamação: peça desculpas com sinceridade, sem discutir e sem culpar o cliente; não prometa mudanças concretas nem afirme fatos que você não sabe; convide a falar com a gente pelo WhatsApp.
- Não cite doenças, nomes de crianças nem dados pessoais além do primeiro nome, mesmo que a pessoa tenha citado. Pode falar do cardápio sem glúten.
- No máximo 3 frases (até uns 350 caracteres). Sem hashtags, sem links.
- Termine sempre com " — Equipe Primus".
- Responda SÓ com o texto da resposta, sem aspas e sem explicação.

EXEMPLOS DO TOM:
- (5★, "O melhor peixe de Cuiabá") → Mariana, que elogio! Ser lembrada como o melhor peixe de Cuiabá é tudo o que a gente busca todo dia na cozinha. Muito obrigado, e volte sempre! — Equipe Primus
- (5★, elogiou o garçom Luiz) → Alan, obrigado por destacar o Luiz! Explicar bem o cardápio faz toda a diferença, e o elogio já chegou até ele. Volte sempre! — Equipe Primus
- (5★, só nota) → Pedro, obrigado pela nota máxima! Foi um prazer receber você. Volte sempre! — Equipe Primus
- (2★, prato veio só porção kids sem avisar) → Flora, pedimos desculpas. Ao sugerir o prato, deveríamos ter explicado que era uma porção kids. Esperamos ter a chance de te receber melhor da próxima vez. — Equipe Primus`;

  async function claudeTexto(apiKey, prompt) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(60000),
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODELO, max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`API do Claude ${r.status}: ${(j.error && j.error.message) || "erro"}`);
    return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }

  function rascunhoPadrao(av) {
    const nome = /^[A-Za-zÀ-ÿ]{3,}$/.test(String(av.nome).split(" ")[0]) ? `${String(av.nome).split(" ")[0]}, ` : "";
    if (av.estrelas <= 3) return comAssinatura(`${nome}sentimos muito que a sua experiência não tenha sido boa. Gostaríamos de entender o que aconteceu: se puder, fale com a gente pelo WhatsApp.`);
    if (av.estrelas === 4 && !av.comentario) return comAssinatura(`${nome}obrigado pelas 4 estrelas! Se tiver alguma sugestão pra próxima visita ser nota máxima, conta pra gente.`);
    return comAssinatura(`${nome}muito obrigado pela avaliação! Foi um prazer receber você. Volte sempre!`);
  }

  async function gerarRascunho(av, apiKey, anterior) {
    if (!apiKey) return rascunhoPadrao(av);
    const prompt = `${PROMPT_BASE}

AVALIAÇÃO:
Nome: ${av.nome}
Estrelas: ${av.estrelas}
Texto: ${av.comentario || "(só deu a nota, sem texto)"}` +
      (anterior ? `\n\nJá foi sugerida esta resposta e o dono quer OUTRA, com outras palavras:\n${anterior}` : "");
    try {
      const t = (await claudeTexto(apiKey, prompt)).replace(/^["“]|["”]$/g, "").trim();
      return t ? comAssinatura(t).slice(0, 1500) : rascunhoPadrao(av);
    } catch (e) {
      console.error("[gmn] Claude falhou, usa resposta padrão:", e.message);
      return rascunhoPadrao(av);
    }
  }

  // ---------- cartão no Telegram ----------
  function cartao(av, rodape) {
    const estrelas = "⭐".repeat(av.estrelas || 0) + (av.estrelas && av.estrelas <= 3 ? " 🔴" : "");
    const texto = av.comentario
      ? `«${escHtml(av.comentario.length > 1500 ? av.comentario.slice(0, 1500) + "…" : av.comentario)}»`
      : "<i>(só deu a nota, sem texto)</i>";
    return `${estrelas}  <b>${escHtml(av.nome)}</b> · ${av.data}\n${texto}\n\n` +
      `✍️ <b>Resposta:</b>\n${escHtml(av.rascunho)}` + (rodape ? `\n\n${rodape}` : "");
  }
  const botoes = (id) => ({ inline_keyboard: [
    [{ text: "✅ Publicar", callback_data: `gp:${id}` }, { text: "✏️ Editar", callback_data: `ge:${id}` }],
    [{ text: "🔄 Outra sugestão", callback_data: `gr:${id}` }, { text: "⏭️ Pular", callback_data: `gs:${id}` }],
  ] });

  async function editarCartao(token, av, id, rodape, comBotoes) {
    const params = { chat_id: av.chat, message_id: av.msgId, parse_mode: "HTML", text: cartao(av, rodape) };
    params.reply_markup = comBotoes ? botoes(id) : { inline_keyboard: [] };
    if (av.msgId) await tg(token, "editMessageText", params);
  }

  // ---------- checagem de avaliações novas ----------
  async function reservar(rev) {
    const id = idCurto(rev.reviewId);
    const ref = COL().doc(id);
    const livre = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (s.exists) {
        const d = s.data() || {};
        // "gerando" travado há mais de 30 min (função caiu no meio): tenta de novo.
        const travado = d.estado === "gerando" && d.criadoEm && d.criadoEm.toMillis && Date.now() - d.criadoEm.toMillis() > 30 * 60000;
        if (!travado) return false;
      }
      tx.set(ref, { reviewId: rev.reviewId, estado: "gerando", criadoEm: FieldValue.serverTimestamp() });
      return true;
    });
    return livre ? { id, ref } : null;
  }

  async function checarNovas(token, chatDono, apiKey) {
    const lista = await listarSemResposta();
    let novas = 0;
    for (const rev of lista) {
      if (novas >= MAX_POR_RODADA) break;
      const r = await reservar(rev);
      if (!r) continue; // já mandada, pulada ou publicada
      const av = {
        nome: (rev.reviewer && rev.reviewer.displayName) || "Cliente",
        estrelas: ESTRELAS[rev.starRating] || 0,
        comentario: textoOriginal(rev.comment),
        data: dataBR(rev.createTime),
        chat: String(chatDono),
      };
      av.rascunho = await gerarRascunho(av, apiKey);
      const j = await tg(token, "sendMessage", { chat_id: av.chat, parse_mode: "HTML", text: cartao(av), reply_markup: botoes(r.id) });
      av.msgId = (j.result && j.result.message_id) || null;
      await r.ref.set({ ...av, estado: "pendente" }, { merge: true });
      novas++;
    }
    return { novas, semResposta: lista.length };
  }

  // ---------- ações dos botões ----------
  async function publicar(token, id, av) {
    // Confere no Google antes: se alguém já respondeu pelo painel, não sobrescreve.
    const atual = await google("GET", `${BASE_REVIEWS}/${encodeURIComponent(av.reviewId)}`);
    if (atual.reviewReply) {
      await COL().doc(id).set({ estado: "respondida_fora" }, { merge: true });
      await editarCartao(token, av, id, "ℹ️ <i>Essa já tinha resposta no Google — nada publicado.</i>", false);
      return "Já estava respondida";
    }
    await google("PUT", `${BASE_REVIEWS}/${encodeURIComponent(av.reviewId)}/reply`, { comment: av.rascunho });
    await COL().doc(id).set({ estado: "publicada", publicadaEm: FieldValue.serverTimestamp() }, { merge: true });
    await editarCartao(token, av, id, "✅ <b>Publicada no Google</b>", false);
    return "Publicada ✅";
  }

  async function tratarClique(cb, token, apiKey) {
    const [acao, id] = String(cb.data || "").split(":");
    const ref = COL().doc(id || "-");
    const s = await ref.get();
    if (!s.exists) {
      await tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Avaliação não encontrada." });
      return;
    }
    const av = s.data();
    av.chat = av.chat || String(cb.message.chat.id);
    av.msgId = cb.message.message_id;
    if (av.estado === "publicada" && acao !== "gu") {
      await tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Essa já foi publicada." });
      return;
    }

    if (acao === "gp") {
      await tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Publicando..." });
      try {
        await publicar(token, id, av);
      } catch (e) {
        console.error("[gmn publicar] erro:", e);
        await tg(token, "sendMessage", { chat_id: av.chat, parse_mode: "HTML",
          text: `❌ Não consegui publicar a resposta pra <b>${escHtml(av.nome)}</b>:\n<code>${escHtml(String(e.message || e).slice(0, 300))}</code>` });
      }
      return;
    }

    if (acao === "ge") {
      await tg(token, "answerCallbackQuery", { callback_query_id: cb.id });
      await REF_ESTADO().set({ editando: { id, ate: Date.now() + 60 * 60000 } }, { merge: true });
      await tg(token, "sendMessage", { chat_id: av.chat, parse_mode: "HTML",
        reply_markup: { force_reply: true, input_field_placeholder: "Texto da resposta" },
        text: `✏️ Mande o texto da resposta pra <b>${escHtml(av.nome)}</b>.\n` +
          "<i>Dica: toque e segure na sugestão acima pra copiar e ajustar. Se não terminar com \"— Equipe Primus\", eu coloco.</i>" });
      return;
    }

    if (acao === "gr") {
      await tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Escrevendo outra..." });
      av.rascunho = await gerarRascunho(av, apiKey, av.rascunho);
      await ref.set({ rascunho: av.rascunho, msgId: av.msgId }, { merge: true });
      await editarCartao(token, av, id, "", true);
      return;
    }

    if (acao === "gs") {
      await tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Pulada" });
      await ref.set({ estado: "pulada" }, { merge: true });
      const params = { chat_id: av.chat, message_id: av.msgId, parse_mode: "HTML",
        text: cartao(av, "⏭️ <i>Pulada — não vai ser respondida.</i>"),
        reply_markup: { inline_keyboard: [[{ text: "↩️ Desfazer", callback_data: `gu:${id}` }]] } };
      await tg(token, "editMessageText", params);
      return;
    }

    if (acao === "gu") {
      await tg(token, "answerCallbackQuery", { callback_query_id: cb.id });
      if (av.estado !== "pulada") return;
      await ref.set({ estado: "pendente" }, { merge: true });
      await editarCartao(token, av, id, "", true);
      return;
    }

    await tg(token, "answerCallbackQuery", { callback_query_id: cb.id });
  }

  // Texto digitado depois de ✏️ Editar: vira a nova resposta (com conferência antes de publicar).
  async function receberEdicao(token, chat, texto) {
    const est = (await REF_ESTADO().get()).data() || {};
    const ed = est.editando;
    if (!ed || !ed.id || ed.ate < Date.now()) return false;
    const ref = COL().doc(ed.id);
    const s = await ref.get();
    if (!s.exists) return false;
    const av = s.data();
    const anterior = av.msgId;
    av.chat = chat;
    av.rascunho = comAssinatura(texto).slice(0, 4000);
    av.estado = "pendente";
    await REF_ESTADO().set({ editando: FieldValue.delete() }, { merge: true });
    // O cartão velho fica sem botões e um novo, com o texto editado, desce pro fim da conversa.
    if (anterior) await tg(token, "editMessageReplyMarkup", { chat_id: chat, message_id: anterior, reply_markup: { inline_keyboard: [] } });
    const j = await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML",
      text: cartao(av, "✏️ <i>Texto editado — confira e toque em ✅ Publicar.</i>"), reply_markup: botoes(ed.id) });
    av.msgId = (j.result && j.result.message_id) || null;
    await ref.set({ rascunho: av.rascunho, estado: "pendente", msgId: av.msgId, chat }, { merge: true });
    return true;
  }

  async function reenviarPendentes(token, chat) {
    const snap = await COL().where("estado", "==", "pendente").limit(10).get();
    if (snap.empty) {
      await tg(token, "sendMessage", { chat_id: chat, text: "✅ Nenhuma avaliação esperando resposta.", reply_markup: TECLADO_GMN });
      return;
    }
    for (const d of snap.docs) {
      const av = d.data();
      if (av.msgId) await tg(token, "editMessageReplyMarkup", { chat_id: chat, message_id: av.msgId, reply_markup: { inline_keyboard: [] } });
      av.chat = chat;
      const j = await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: cartao(av), reply_markup: botoes(d.id) });
      await d.ref.set({ msgId: (j.result && j.result.message_id) || null, chat }, { merge: true });
    }
  }

  // ---------- webhook do bot ----------
  async function tratarUpdate(upd, token, chatDono, apiKey) {
    const cb = upd.callback_query;
    const msg = upd.message;
    const chat = String((cb ? cb.message && cb.message.chat && cb.message.chat.id : msg && msg.chat && msg.chat.id) || "");
    if (!chat) return;
    const texto = ((msg && msg.text) || "").trim();

    if (/^\/meuid(@\w+)?$/i.test(texto)) {
      await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: `🆔 Seu chat id: <code>${chat}</code>` });
      return;
    }
    if (chat !== String(chatDono)) {
      if (cb) await tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Você não está autorizado." });
      else await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: `🔒 Este bot é só do dono.\n🆔 Seu chat id: <code>${chat}</code>` });
      console.log(`[gmn] chat nao autorizado: ${chat}`);
      return;
    }

    if (cb) { await tratarClique(cb, token, apiKey); return; }

    if (texto === BOTAO_CHECAR || /^\/checar(@\w+)?$/i.test(texto)) {
      await tg(token, "sendMessage", { chat_id: chat, text: "🔎 Conferindo as avaliações no Google...", reply_markup: TECLADO_GMN });
      try {
        const r = await checarNovas(token, chat, apiKey);
        if (!r.novas) await tg(token, "sendMessage", { chat_id: chat, text: "✅ Nenhuma avaliação nova sem resposta.", reply_markup: TECLADO_GMN });
      } catch (e) {
        console.error("[gmn checar] erro:", e);
        await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", text: `❌ Erro ao ler o Google:\n<code>${escHtml(String(e.message || e).slice(0, 300))}</code>` });
      }
      return;
    }
    if (texto === BOTAO_PENDENTES || /^\/pendentes(@\w+)?$/i.test(texto)) { await reenviarPendentes(token, chat); return; }

    if (texto && !texto.startsWith("/") && await receberEdicao(token, chat, texto)) return;

    // /start ou qualquer outra coisa: explica
    await tg(token, "setMyCommands", { commands: [
      { command: "checar", description: "Conferir avaliações novas agora" },
      { command: "pendentes", description: "Reenviar as que estão esperando resposta" },
      { command: "meuid", description: "Mostra o seu chat id" }] });
    await tg(token, "sendMessage", { chat_id: chat, parse_mode: "HTML", reply_markup: TECLADO_GMN,
      text: "⭐ <b>Google Meu Negócio</b>\nTodo dia às 10h eu confiro as avaliações do Google. " +
        "Quando chegar uma sem resposta, mando aqui com uma sugestão:\n" +
        "✅ <b>Publicar</b> — responde no Google\n✏️ <b>Editar</b> — você manda o texto\n" +
        "🔄 <b>Outra sugestão</b> — escrevo de outro jeito\n⏭️ <b>Pular</b> — não responde\n\n" +
        "Use os botões <b>🔎 Checar</b> e <b>📬 Pendentes</b> aqui embaixo (ou /checar · /pendentes)." });
  }

  const SEGREDOS = [GMN_CLIENT_ID, GMN_CLIENT_SECRET, GMN_REFRESH_TOKEN, TELEGRAM_GMN_TOKEN, TELEGRAM_CHAT_ID, ANTHROPIC_API_KEY];
  const chaveClaude = () => { try { return ANTHROPIC_API_KEY.value(); } catch (_) { return ""; } };

  const checarAvaliacoes = onSchedule(
    { schedule: "0 10 * * *", timeZone: "America/Cuiaba", region: REGIAO, timeoutSeconds: 300, secrets: SEGREDOS },
    async () => {
      try {
        const r = await checarNovas(TELEGRAM_GMN_TOKEN.value(), TELEGRAM_CHAT_ID.value(), chaveClaude());
        console.log(`[gmn] checagem: ${r.novas} nova(s) enviada(s) · ${r.semResposta} sem resposta no Google`);
      } catch (e) {
        console.error("[gmn] checagem falhou:", e);
      }
    }
  );

  const telegramGmn = onRequest(
    { region: REGIAO, timeoutSeconds: 120, secrets: [...SEGREDOS, TELEGRAM_WEBHOOK_SECRET] },
    async (req, res) => {
      if (req.method !== "POST") { res.status(200).send("ok"); return; }
      if (req.get("X-Telegram-Bot-Api-Secret-Token") !== TELEGRAM_WEBHOOK_SECRET.value()) {
        res.status(403).send("forbidden"); return;
      }
      const updId = req.body && req.body.update_id;
      if (updId && await jaProcessado(`gmn_${updId}`)) { res.status(200).send("ok"); return; }
      try {
        await tratarUpdate(req.body || {}, TELEGRAM_GMN_TOKEN.value(), TELEGRAM_CHAT_ID.value(), chaveClaude());
      } catch (e) {
        console.error("[gmn webhook] erro:", e);
      }
      res.status(200).send("ok"); // sempre 200: senão o Telegram fica reenviando
    }
  );

  return { checarAvaliacoes, telegramGmn };
};
