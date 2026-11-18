// Painel do apresentador: criar sala, montar perguntas e apresentar no telão
import {
  configOk, signIn, r, get, set, update, push, onValue, serverTimestamp, startClock, serverNow,
  esc, toArray, quizPoints, describeAnswer, toast, COLORS, TYPES, participantUrl, joinDisplay, CONFIG_MSG,
} from "./common.js";

const app = document.getElementById("app");
let user = null, code = "", room = null, mode = "home";
let selectedQid = null, draft = null, saveTimer = null;
let renderQueued = false, lastContentKey = "", timerInt = null, closingQuiz = false, idleTimer = null;

const DEFAULTS = {
  choice:    { title: "Nova pergunta", options: ["Opção 1", "Opção 2", "Opção 3"], multi: false },
  wordcloud: { title: "Em uma palavra, como você está hoje?", maxWords: 3 },
  open:      { title: "Deixe sua mensagem" },
  scale:     { title: "De 1 a 5, quanto você concorda?", max: 5, minLabel: "Discordo", maxLabel: "Concordo" },
  quiz:      { title: "Pergunta do quiz", options: ["Resposta A", "Resposta B", "Resposta C", "Resposta D"], time: 20 },
  qa:        { title: "Mande sua pergunta para o palestrante" },
};
const EDITABLE = ["title", "options", "multi", "time", "maxWords", "max", "minLabel", "maxLabel"];

init();

async function init() {
  if (!configOk) { app.innerHTML = `<div class="wrap">${CONFIG_MSG}</div>`; return; }
  app.innerHTML = `<div class="wrap center"><div class="spinner"></div></div>`;
  try {
    user = await signIn();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="wrap"><div class="card center"><div class="big-icon">🔐</div><h2>Login anônimo desativado</h2>
      <p class="muted">No Firebase, vá em Authentication → Método de login e ative o provedor <b>Anônimo</b>.</p></div></div>`;
    return;
  }
  startClock();
  const c = (new URLSearchParams(location.search).get("c") || "").replace(/\D/g, "");
  if (c) openRoom(c);
  else showHome();
}

// ---------- Salas ----------
function myRooms() {
  try { return JSON.parse(localStorage.getItem("votaai-rooms") || "[]"); } catch { return []; }
}
function saveMyRoom(c, title) {
  const list = myRooms();
  if (list[0] && list[0].code === c && list[0].title === title) return;
  localStorage.setItem("votaai-rooms", JSON.stringify([{ code: c, title }, ...list.filter((x) => x.code !== c)].slice(0, 30)));
}

function showHome(err = "") {
  mode = "home";
  history.replaceState(null, "", location.pathname);
  const rooms = myRooms();
  app.innerHTML = `<div class="wrap">
    <div class="home-brand"><div class="brand-logos"><img class="milplan" src="img/milplan-branco.png" alt="Milplan Engenharia"><span class="sep-v"></span><img class="workshop" src="img/workshop.png" alt="Workshop SMS"></div></div>
    <header class="home-head">
      <h1>Painel do apresentador</h1>
      <p class="muted">Crie uma sala, monte as perguntas e projete. A plateia entra pelo celular, sem instalar nada.</p>
    </header>
    ${err ? `<p class="error">${esc(err)}</p>` : ""}
    <form id="newRoom" class="panel row">
      <input name="title" class="input" placeholder="Nome do evento (ex.: Encontro anual 2026)" maxlength="80" required>
      <button class="btn primary">+ Criar sala</button>
    </form>
    <h2 class="section-title">Minhas salas</h2>
    <div class="room-list">${rooms.length
      ? rooms.map((x) => `<a class="room-card" href="?c=${x.code}"><b>${esc(x.title || "Sem título")}</b><span class="code-pill">${x.code}</span></a>`).join("")
      : `<p class="muted">Nenhuma sala criada neste navegador ainda.</p>`}</div>
    <p class="muted small note">As salas ficam ligadas a este navegador. Crie e apresente sempre no mesmo computador.</p>
  </div>`;
  document.getElementById("newRoom").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try { await createRoom(e.target.title.value.trim()); }
    catch (err) { console.error(err); toast("Erro ao criar a sala. Confira as regras do banco."); btn.disabled = false; }
  };
}

async function createRoom(title) {
  for (let i = 0; i < 15; i++) {
    const c = String(Math.floor(10000 + Math.random() * 90000));
    if ((await get(r(`rooms/${c}/owner`))).exists()) continue;
    await set(r(`rooms/${c}`), { owner: user.uid, title, createdAt: serverTimestamp(), state: { view: "lobby" } });
    saveMyRoom(c, title);
    history.replaceState(null, "", `?c=${c}`);
    return openRoom(c);
  }
  throw new Error("Sem códigos livres");
}

async function openRoom(c) {
  code = c;
  let owner;
  try { owner = (await get(r(`rooms/${c}/owner`))).val(); }
  catch (e) { console.error(e); return showHome("Erro ao abrir a sala."); }
  if (!owner) return showHome(`A sala ${c} não existe.`);
  if (owner !== user.uid) return showHome(`A sala ${c} foi criada em outro navegador. Só quem criou pode editar e apresentar.`);
  mode = "edit";
  app.innerHTML = "";
  onValue(r(`rooms/${c}`), (s) => {
    room = s.val() || {};
    saveMyRoom(c, room.title || "");
    queueRender();
  });
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!room) return;
    if (mode === "edit") renderEditor();
    else if (mode === "present") renderPresent();
  });
}

const sortedQs = () =>
  Object.entries(room?.questions || {}).map(([id, q]) => ({ id, ...q })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

function countResponses(qid, type) {
  return Object.keys((type === "qa" ? room.qa : room.responses)?.[qid] || {}).length;
}

// ---------- Editor ----------
function renderEditor() {
  if (!document.getElementById("editor")) buildEditor();
  renderList();
  if (selectedQid && !room.questions?.[selectedQid]) { selectedQid = null; draft = null; renderForm(); }
  if (!selectedQid) {
    const first = sortedQs()[0];
    if (first) selectQ(first.id);
  }
}

function buildEditor() {
  app.innerHTML = `<div class="editor" id="editor">
    <header class="ed-head">
      <a class="btn ghost small" href="apresentador.html">← Salas</a>
      <img class="brand-mini" src="img/workshop-icone.png" alt="">
      <input id="roomTitle" class="title-input" maxlength="80" value="${esc(room.title || "")}" placeholder="Nome do evento">
      <span class="code-pill">Código <b>${code}</b></span>
      <div class="spacer"></div>
      <button class="btn ghost" id="copyLink">🔗 Copiar link</button>
      <button class="btn ghost" id="exportCsv">⬇ Exportar CSV</button>
      <button class="btn ghost danger" id="resetAll">↺ Zerar respostas</button>
      <button class="btn primary" id="presentBtn">▶ Apresentar</button>
    </header>
    <div class="ed-body">
      <aside class="ed-side">
        <div id="qList" class="q-list"></div>
        <div class="add-box">
          <p class="muted small">Adicionar pergunta</p>
          ${Object.entries(TYPES).map(([t, m]) => `<button class="add-btn" data-type="${t}"><span>${m.icon}</span> ${m.label}</button>`).join("")}
        </div>
      </aside>
      <section class="ed-main" id="qForm"></section>
    </div>
  </div>`;

  document.getElementById("roomTitle").onchange = (e) => update(r(`rooms/${code}`), { title: e.target.value.trim() });
  document.getElementById("copyLink").onclick = () =>
    navigator.clipboard.writeText(participantUrl(code)).then(() => toast("Link da plateia copiado!"));
  document.getElementById("exportCsv").onclick = exportCsv;
  document.getElementById("resetAll").onclick = () => {
    if (!confirm("Apagar TODAS as respostas desta sala? As perguntas continuam.")) return;
    update(r(`rooms/${code}`), { responses: null, qa: null, runs: null, state: { view: "lobby" } }).then(() => toast("Respostas apagadas."));
  };
  document.getElementById("presentBtn").onclick = () => startPresent(null);

  document.querySelectorAll(".add-btn").forEach((b) => (b.onclick = () => addQuestion(b.dataset.type)));

  document.getElementById("qList").onclick = (e) => {
    const item = e.target.closest(".q-item");
    if (!item) return;
    const id = item.dataset.id;
    if (e.target.closest("[data-move]")) return moveQ(id, Number(e.target.closest("[data-move]").dataset.move));
    if (e.target.closest("[data-del]")) return deleteQ(id);
    flushSave();
    selectQ(id);
  };
  renderForm();
}

function renderList() {
  const el = document.getElementById("qList");
  if (!el) return;
  const qs = sortedQs();
  el.innerHTML = qs.length
    ? qs.map((q, i) => `
      <div class="q-item ${q.id === selectedQid ? "active" : ""}" data-id="${q.id}">
        <span class="q-num">${i + 1}</span>
        <span class="q-icon">${TYPES[q.type]?.icon || ""}</span>
        <span class="q-name">${esc(q.title || "(sem título)")}</span>
        <span class="q-count" title="respostas">${countResponses(q.id, q.type)}</span>
        <span class="q-tools">
          <button data-move="-1" title="Subir">↑</button><button data-move="1" title="Descer">↓</button><button data-del title="Excluir">🗑</button>
        </span>
      </div>`).join("")
    : `<p class="muted empty-list">Nenhuma pergunta ainda.<br>Adicione abaixo 👇</p>`;
}

function selectQ(id, data) {
  selectedQid = id;
  const q = data || room.questions?.[id];
  draft = q ? JSON.parse(JSON.stringify(q)) : null;
  if (draft && (draft.type === "choice" || draft.type === "quiz")) draft.options = toArray(draft.options);
  renderForm();
  renderList();
}

async function addQuestion(type) {
  flushSave();
  const qs = sortedQs();
  const order = qs.length ? Math.max(...qs.map((q) => q.order || 0)) + 1 : 1;
  const key = push(r(`rooms/${code}/questions`)).key;
  const data = { type, order, ...JSON.parse(JSON.stringify(DEFAULTS[type])) };
  const upd = { [`questions/${key}`]: data };
  if (type === "quiz") upd[`answers/${key}`] = 0;
  await update(r(`rooms/${code}`), upd);
  selectQ(key, data);
  document.getElementById("qTitle")?.select();
}

function moveQ(id, dir) {
  const qs = sortedQs();
  const i = qs.findIndex((q) => q.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= qs.length) return;
  [qs[i], qs[j]] = [qs[j], qs[i]];
  const upd = {};
  qs.forEach((q, k) => (upd[`questions/${q.id}/order`] = k + 1));
  update(r(`rooms/${code}`), upd);
}

function deleteQ(id) {
  if (!confirm("Excluir esta pergunta e as respostas dela?")) return;
  if (id === selectedQid) { clearTimeout(saveTimer); saveTimer = null; selectedQid = null; draft = null; renderForm(); }
  const upd = { [`questions/${id}`]: null, [`answers/${id}`]: null, [`responses/${id}`]: null, [`qa/${id}`]: null, [`runs/${id}`]: null };
  if (room.state?.qid === id) upd.state = { view: "lobby" };
  update(r(`rooms/${code}`), upd);
}

let pendingSave = null;
function save(immediate = false) {
  const qid = selectedQid;
  const data = {};
  EDITABLE.forEach((k) => { if (draft[k] !== undefined) data[k] = draft[k]; });
  pendingSave = () => update(r(`rooms/${code}/questions/${qid}`), data);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, immediate ? 0 : 350);
}
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (pendingSave) { const f = pendingSave; pendingSave = null; f(); }
}

function renderForm() {
  const el = document.getElementById("qForm");
  if (!el) return;
  if (!draft) { el.innerHTML = `<div class="empty">Selecione uma pergunta ou adicione uma nova.</div>`; return; }
  const t = draft.type;
  let extra = "";
  if (t === "choice" || t === "quiz") {
    const correct = Number(room.answers?.[selectedQid] ?? 0);
    extra += `<label class="lbl">Opções ${t === "quiz" ? `<span class="muted small">(marque a correta)</span>` : ""}</label>
      <div class="opt-edit">${draft.options.map((o, i) => `
        <div class="opt-row">
          ${t === "quiz"
            ? `<input type="radio" name="correct" value="${i}" ${correct === i ? "checked" : ""} title="Resposta correta">`
            : `<span class="swatch" style="background:${COLORS[i % COLORS.length]}"></span>`}
          <input class="input" data-opt="${i}" value="${esc(o)}" maxlength="80">
          <button class="icon-btn" data-delopt="${i}" ${draft.options.length <= 2 ? "disabled" : ""} title="Remover">✕</button>
        </div>`).join("")}
      </div>
      ${draft.options.length < 8 ? `<button class="btn ghost small" id="addOpt">+ Opção</button>` : ""}`;
    if (t === "choice") extra += `<label class="check"><input type="checkbox" id="multi" ${draft.multi ? "checked" : ""}> Permitir escolher mais de uma opção</label>`;
    if (t === "quiz") extra += `<label class="lbl">Tempo para responder (segundos)</label>
      <input type="number" class="input short" id="time" min="5" max="120" value="${draft.time || 20}">`;
  }
  if (t === "wordcloud") {
    extra += `<label class="lbl">Palavras por pessoa</label>
      <select class="input short" id="maxWords">${[1, 2, 3, 4, 5].map((n) => `<option ${(draft.maxWords || 3) === n ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  }
  if (t === "scale") {
    extra += `<label class="lbl">Escala de 1 até</label>
      <select class="input short" id="max">${[3, 5, 7, 10].map((n) => `<option ${(draft.max || 5) === n ? "selected" : ""}>${n}</option>`).join("")}</select>
      <div class="two">
        <div><label class="lbl">Rótulo do 1</label><input class="input" id="minLabel" maxlength="30" value="${esc(draft.minLabel || "")}"></div>
        <div><label class="lbl">Rótulo do máximo</label><input class="input" id="maxLabel" maxlength="30" value="${esc(draft.maxLabel || "")}"></div>
      </div>`;
  }
  const hints = {
    choice: "Os resultados aparecem como colunas que crescem ao vivo.",
    wordcloud: "As palavras mais enviadas ficam maiores no centro.",
    open: "Cada pessoa envia um texto (até 280 caracteres). Aparecem como cartões na tela.",
    scale: "Mostra a média e a distribuição das notas.",
    quiz: "Acertar rende de 500 a 1000 pontos: quanto mais rápido, mais pontos. Use o botão 🏆 Ranking durante a apresentação.",
    qa: "A plateia envia perguntas e vota nas dos outros. As mais votadas sobem. No telão, você marca as respondidas.",
  };
  el.innerHTML = `<div class="panel form">
    <div class="type-tag">${TYPES[t].icon} ${TYPES[t].label}</div>
    <label class="lbl">Pergunta</label>
    <textarea class="input q-title-input" id="qTitle" rows="2" maxlength="200">${esc(draft.title || "")}</textarea>
    ${extra}
    <p class="hint">💡 ${hints[t]}</p>
    <div class="form-foot"><button class="btn primary" id="presentThis">▶ Apresentar a partir desta</button></div>
  </div>`;

  const $ = (id) => document.getElementById(id);
  $("qTitle").oninput = (e) => { draft.title = e.target.value; save(); };
  el.querySelectorAll("[data-opt]").forEach((inp) => (inp.oninput = () => { draft.options[Number(inp.dataset.opt)] = inp.value; save(); }));
  el.querySelectorAll("[data-delopt]").forEach((b) => (b.onclick = () => {
    const i = Number(b.dataset.delopt);
    draft.options.splice(i, 1);
    if (t === "quiz") {
      const c = Number(room.answers?.[selectedQid] ?? 0);
      const nc = c === i ? 0 : c > i ? c - 1 : c;
      if (nc !== c) set(r(`rooms/${code}/answers/${selectedQid}`), nc);
    }
    save(true);
    renderForm();
  }));
  if ($("addOpt")) $("addOpt").onclick = () => { draft.options.push(`Opção ${draft.options.length + 1}`); save(true); renderForm(); };
  el.querySelectorAll('input[name="correct"]').forEach((rd) => (rd.onchange = () => set(r(`rooms/${code}/answers/${selectedQid}`), Number(rd.value))));
  if ($("multi")) $("multi").onchange = (e) => { draft.multi = e.target.checked; save(true); };
  if ($("time")) $("time").oninput = (e) => { draft.time = Math.min(120, Math.max(5, Number(e.target.value) || 20)); save(); };
  if ($("maxWords")) $("maxWords").onchange = (e) => { draft.maxWords = Number(e.target.value); save(true); };
  if ($("max")) $("max").onchange = (e) => { draft.max = Number(e.target.value); save(true); };
  if ($("minLabel")) $("minLabel").oninput = (e) => { draft.minLabel = e.target.value; save(); };
  if ($("maxLabel")) $("maxLabel").oninput = (e) => { draft.maxLabel = e.target.value; save(); };
  $("presentThis").onclick = () => startPresent(selectedQid);
}

function exportCsv() {
  const rows = [["Pergunta", "Tipo", "Participante", "Resposta", "Pontos (quiz)", "Votos (perguntas da plateia)"]];
  for (const q of sortedQs()) {
    if (q.type === "qa") {
      for (const it of Object.values(room.qa?.[q.id] || {}))
        rows.push([q.title, TYPES.qa.label, it.n || "Anônimo", it.text, "", Object.keys(it.votes || {}).length]);
      continue;
    }
    for (const [uid, resp] of Object.entries(room.responses?.[q.id] || {})) {
      const nm = room.participants?.[uid]?.n || resp.n || "Anônimo";
      const pts = q.type === "quiz" ? quizPoints(resp, room.runs?.[q.id], q.time, room.answers?.[q.id]) : "";
      rows.push([q.title, TYPES[q.type]?.label || q.type, nm, describeAnswer(q, resp.v), pts, ""]);
    }
  }
  const csv = "﻿" + rows.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `respostas-${code}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Apresentação ----------
function startPresent(qid) {
  flushSave();
  mode = "present";
  app.innerHTML = "";
  lastContentKey = "";
  clearInterval(timerInt);
  timerInt = setInterval(quizTick, 200);
  if (qid) goTo(qid);
  renderPresent();
}

function exitPresent() {
  mode = "edit";
  clearInterval(timerInt);
  if (document.fullscreenElement) document.exitFullscreen();
  app.innerHTML = "";
  renderEditor();
}

function setState(st) { return set(r(`rooms/${code}/state`), st); }

function goTo(qid) {
  const q = room.questions?.[qid];
  if (!q) return;
  const showResults = room.state?.showResults !== false;
  if (q.type === "quiz") {
    const run = room.runs?.[qid] ?? null;
    setState({ view: "question", qid, open: false, showResults, startedAt: run, correct: run != null ? Number(room.answers?.[qid] ?? 0) : null });
  } else {
    setState({ view: "question", qid, open: true, showResults });
  }
}
const goLobby = () => setState({ view: "lobby", showResults: room.state?.showResults !== false });
const showLeaderboard = () => update(r(`rooms/${code}/state`), { view: "leaderboard", open: false });

const showSummary = () => update(r(`rooms/${code}/state`), { view: "summary", open: false });
const hasQuiz = () => sortedQs().some((q) => q.type === "quiz");

// Sequência: entrada → perguntas → ranking (se houver quiz) → resumo final
function navigate(dir) {
  const qs = sortedQs();
  const st = room.state || {};
  const idx = st.qid ? qs.findIndex((q) => q.id === st.qid) : -1;
  if (st.view === "summary") {
    if (dir > 0) return;
    if (hasQuiz()) return update(r(`rooms/${code}/state`), { view: "leaderboard", qid: qs.at(-1)?.id ?? null, open: false });
    return qs.length ? goTo(qs.at(-1).id) : goLobby();
  }
  if (st.view === "lobby" || idx === -1) {
    if (dir > 0) qs.length ? goTo(qs[0].id) : showSummary();
    return;
  }
  if (st.view === "leaderboard") {
    if (dir < 0) goTo(qs[idx].id);
    else if (qs[idx + 1]) goTo(qs[idx + 1].id);
    else showSummary();
    return;
  }
  const ni = idx + dir;
  if (ni < 0) goLobby();
  else if (ni < qs.length) goTo(qs[ni].id);
  else if (hasQuiz()) showLeaderboard();
  else showSummary();
}

function startQuiz() {
  const qid = room.state?.qid;
  if (room.runs?.[qid] != null && countResponses(qid, "quiz") && !confirm("Refazer apaga as respostas desta pergunta. Continuar?")) return;
  closingQuiz = false;
  update(r(`rooms/${code}`), {
    [`responses/${qid}`]: null,
    [`runs/${qid}`]: serverTimestamp(),
    "state/open": true,
    "state/startedAt": serverTimestamp(),
    "state/correct": null,
  });
}

function closeQuiz() {
  if (closingQuiz) return;
  closingQuiz = true;
  const qid = room.state?.qid;
  update(r(`rooms/${code}/state`), { open: false, correct: Number(room.answers?.[qid] ?? 0) }).finally(() => (closingQuiz = false));
}

function quizTick() {
  if (mode !== "present" || !room) return;
  const st = room.state || {};
  const q = st.view === "question" ? room.questions?.[st.qid] : null;
  if (!q || q.type !== "quiz") return;
  const fill = document.getElementById("pTimerFill");
  const txt = document.getElementById("pTimerText");
  if (!st.open || st.startedAt == null) {
    if (fill) fill.style.width = st.startedAt == null ? "100%" : "0%";
    if (txt) txt.textContent = st.startedAt == null ? "Clique em ▶ Iniciar quiz" : "Tempo esgotado";
    return;
  }
  const total = (Number(q.time) || 20) * 1000;
  const left = Math.max(0, Number(st.startedAt) + total - serverNow());
  if (fill) { fill.style.width = (left / total) * 100 + "%"; fill.classList.toggle("low", left < 5000); }
  if (txt) txt.textContent = `${Math.ceil(left / 1000)}s`;
  // encerra sozinho quando o tempo acaba ou quando todos os online já responderam
  const online = Object.values(room.participants || {}).filter((p) => p.on).length;
  const answered = countResponses(st.qid, "quiz");
  if (left <= 0 || (online > 0 && answered >= online)) closeQuiz();
}

function renderPresent() {
  if (!document.getElementById("stage")) buildStage();
  const online = Object.values(room.participants || {}).filter((p) => p.on).length;
  document.getElementById("pCount").textContent = `👥 ${online}`;
  renderContent();
  renderControls();
}

function makeQr(el, size) {
  if (!el || !window.QRCode) return;
  el.innerHTML = "";
  new window.QRCode(el, { text: participantUrl(code), width: size, height: size, colorDark: "#0e0f1a", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
}

function buildStage() {
  app.innerHTML = `<div class="stage" id="stage">
    <div class="topbar">
      <div class="brand-logos"><img class="milplan" src="img/milplan-branco.png" alt="Milplan Engenharia"><span class="sep-v"></span><img class="workshop" src="img/workshop.png" alt="Workshop SMS"></div>
      <div class="top-right"><span class="code-box">Código <b class="code-hl">${code}</b></span><span id="pCount" class="pcount">👥 0</span><div id="miniQr" class="mini-qr"></div></div>
    </div>
    <main id="content" class="content"></main>
    <div class="controls" id="controls"></div>
  </div>`;
  makeQr(document.getElementById("miniQr"), 76);
  const stage = document.getElementById("stage");
  stage.onmousemove = () => {
    stage.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stage.classList.add("idle"), 2500);
  };
  document.getElementById("controls").onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const st = room.state || {};
    ({
      prev: () => navigate(-1),
      next: () => navigate(1),
      lobby: goLobby,
      leaderboard: showLeaderboard,
      summary: showSummary,
      toggleOpen: () => update(r(`rooms/${code}/state`), { open: !st.open }),
      toggleResults: () => update(r(`rooms/${code}/state`), { showResults: st.showResults === false }),
      startQuiz,
      closeQuiz,
      fullscreen: toggleFullscreen,
      exit: exitPresent,
    })[b.dataset.act]?.();
  };
  document.getElementById("content").onclick = (e) => {
    const done = e.target.closest("[data-qa-done]");
    const del = e.target.closest("[data-qa-del]");
    const qid = room.state?.qid;
    if (done) { const it = room.qa?.[qid]?.[done.dataset.qaDone]; update(r(`rooms/${code}/qa/${qid}/${done.dataset.qaDone}`), { done: !it?.done }); }
    if (del && confirm("Remover esta pergunta da plateia?")) set(r(`rooms/${code}/qa/${qid}/${del.dataset.qaDel}`), null);
  };
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

document.addEventListener("keydown", (e) => {
  if (mode !== "present" || e.target.matches("input, textarea, select")) return;
  const k = e.key;
  if (k === "ArrowRight" || k === "PageDown" || k === " ") { e.preventDefault(); navigate(1); }
  else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); navigate(-1); }
  else if (k === "f" || k === "F") toggleFullscreen();
  else if (k === "q" || k === "Q") goLobby();
  else if (k === "r" || k === "R") update(r(`rooms/${code}/state`), { showResults: room.state?.showResults === false });
});

function renderControls() {
  const st = room.state || {};
  const q = st.view === "question" ? room.questions?.[st.qid] : null;
  const qs = sortedQs();
  const idx = qs.findIndex((x) => x.id === st.qid);
  let mid = "";
  if (q && q.type === "quiz") {
    if (st.open) mid = `<button data-act="closeQuiz" class="btn warn">⏹ Encerrar agora</button>`;
    else if (st.startedAt == null) mid = `<button data-act="startQuiz" class="btn primary">▶ Iniciar quiz</button>`;
    else mid = `<button data-act="startQuiz" class="btn ghost">↺ Refazer</button>`;
  } else if (q) {
    mid = `<button data-act="toggleOpen" class="btn ghost">${st.open ? "🔒 Encerrar votação" : "🔓 Reabrir votação"}</button>`;
    if (q.type !== "qa") mid += `<button data-act="toggleResults" class="btn ghost">${st.showResults === false ? "👁 Mostrar resultados" : "🙈 Ocultar resultados"}</button>`;
  }
  const pos = st.view === "leaderboard" ? "Ranking" : st.view === "summary" ? "Resumo" : st.view !== "question" ? "Início" : `${idx + 1} / ${qs.length}`;
  document.getElementById("controls").innerHTML = `
    <button data-act="prev" class="btn ghost" title="Anterior (←)">←</button>
    <span class="pos">${pos}</span>
    <button data-act="next" class="btn ghost" title="Próxima (→)">→</button>
    <span class="sep"></span>${mid}<span class="sep"></span>
    <button data-act="lobby" class="btn ghost" title="Tela de entrada (Q)">📱 QR code</button>
    <button data-act="leaderboard" class="btn ghost">🏆 Ranking</button>
    <button data-act="summary" class="btn ghost">📈 Resumo</button>
    <button data-act="fullscreen" class="btn ghost" title="Tela cheia (F)">⛶</button>
    <button data-act="exit" class="btn ghost">✕ Editar</button>`;
}

// ----- conteúdo do telão -----
function contentKey() {
  const st = room.state || {};
  const q = st.view === "question" ? room.questions?.[st.qid] : null;
  return JSON.stringify([
    st.view, st.qid, q?.type, q?.title, q ? toArray(q.options) : 0, q?.max, q?.minLabel, q?.maxLabel,
    st.showResults !== false, q?.type === "quiz" ? [!!st.open, st.startedAt != null, st.correct ?? null] : 0,
  ]);
}

function renderContent() {
  const el = document.getElementById("content");
  const key = contentKey();
  if (key !== lastContentKey) {
    lastContentKey = key;
    el.innerHTML = skeleton();
    makeQr(document.getElementById("bigQr"), 340);
  }
  fill();
}

function skeleton() {
  const st = room.state || {};
  if (st.view === "leaderboard") return `<div class="lb"><h1>🏆 Ranking</h1><ol id="lbList" class="lb-list"></ol></div>`;
  if (st.view === "summary") return `<div class="dash" id="dash"></div>`;
  const q = st.view === "question" ? room.questions?.[st.qid] : null;
  if (!q) {
    return `<div class="lobby">
      <div class="lobby-qr" id="bigQr"></div>
      <div class="lobby-text">
        <img class="lobby-brand" src="img/workshop.png" alt="Workshop SMS · A vida é nosso maior valor">
        <p class="lead">Aponte a câmera do celular para o QR code<br>e participe com o código</p>
        <div class="lobby-code">${code}</div>
        <div id="lobbyNames" class="names"></div>
      </div>
    </div>`;
  }
  const hidden = st.showResults === false && q.type !== "qa" && q.type !== "quiz";
  const timer = q.type === "quiz" ? `<div class="ptimer"><div class="ptimer-fill" id="pTimerFill"></div><span id="pTimerText"></span></div>` : "";
  return `<div class="qview type-${q.type}">
    <h1 class="qtitle">${esc(q.title)}</h1>${timer}
    <div class="viz">${hidden ? `<div class="hidden-res">🙈<br>Resultados ocultos<small>As respostas continuam chegando</small></div>` : vizSkeleton(q, st)}</div>
    <div class="qfoot"><span id="respCount"></span></div>
  </div>`;
}

function colsSkeleton(labels, correctIdx = null) {
  return `<div class="cols" style="--n:${labels.length}">${labels.map((l, i) => `
    <div class="col ${correctIdx === i ? "correct" : ""} ${correctIdx != null && correctIdx !== i ? "dim" : ""}">
      <div class="col-val"><span data-val="${i}">0</span><small data-pct="${i}"></small></div>
      <div class="col-track"><div class="col-bar" data-bar="${i}" style="background:${COLORS[i % COLORS.length]}"></div></div>
      <div class="col-label">${correctIdx === i ? "✓ " : ""}${esc(l)}</div>
    </div>`).join("")}</div>`;
}

function vizSkeleton(q, st) {
  const opts = toArray(q.options);
  switch (q.type) {
    case "choice": return colsSkeleton(opts);
    case "quiz":
      if (st.open || st.startedAt == null) {
        return `<div class="quiz-tiles">${opts.map((o, i) => `<div class="tile" style="--c:${COLORS[i % COLORS.length]}">${esc(o)}</div>`).join("")}</div>`;
      }
      return colsSkeleton(opts, Number(st.correct ?? room.answers?.[st.qid] ?? 0));
    case "scale": {
      const max = Number(q.max) || 5;
      return `<div class="scale-wrap">
        <div class="avg"><span id="avgVal">–</span><small>média (1 a ${max})</small></div>
        <div class="scale-cols">${colsSkeleton(Array.from({ length: max }, (_, k) => String(k + 1)))}
          <div class="scale-labels big"><span>${esc(q.minLabel || "")}</span><span>${esc(q.maxLabel || "")}</span></div>
        </div>
      </div>`;
    }
    case "wordcloud": return `<div class="cloud" id="cloud"></div>`;
    case "open": return `<div class="cards" id="cards"></div>`;
    case "qa": return `<div class="qa-board" id="qaBoard"></div>`;
  }
  return "";
}

function hashColor(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function fill() {
  const st = room.state || {};
  if (st.view === "leaderboard") return fillLeaderboard();
  if (st.view === "summary") return fillSummary();
  const q = st.view === "question" ? room.questions?.[st.qid] : null;
  if (!q) {
    const el = document.getElementById("lobbyNames");
    if (el) {
      const ps = Object.values(room.participants || {}).filter((p) => p.on);
      el.innerHTML = `<div class="online">${ps.length} ${ps.length === 1 ? "pessoa conectada" : "pessoas conectadas"}</div>` +
        ps.filter((p) => p.n).slice(-40).map((p) => `<span class="chip">${esc(p.n)}</span>`).join("");
    }
    return;
  }
  const resps = Object.values(room.responses?.[st.qid] || {});
  const rc = document.getElementById("respCount");
  if (q.type === "qa") {
    const items = Object.entries(room.qa?.[st.qid] || {});
    if (rc) rc.textContent = `${items.length} ${items.length === 1 ? "pergunta" : "perguntas"}`;
    return fillQa(items);
  }
  if (rc) rc.textContent = `${resps.length} ${resps.length === 1 ? "resposta" : "respostas"}${st.open || q.type === "quiz" ? "" : " · votação encerrada"}`;
  if (st.showResults === false && q.type !== "quiz") return;

  if (q.type === "choice" || q.type === "quiz" || q.type === "scale") {
    const n = q.type === "scale" ? Number(q.max) || 5 : toArray(q.options).length;
    const counts = Array(n).fill(0);
    let sum = 0;
    for (const rsp of resps) {
      if (q.type === "scale") { const v = Number(rsp.v); if (v >= 1 && v <= n) { counts[v - 1]++; sum += v; } }
      else (Array.isArray(rsp.v) ? rsp.v : [rsp.v]).forEach((i) => { if (counts[i] != null) counts[i]++; });
    }
    const max = Math.max(1, ...counts);
    counts.forEach((c, i) => {
      const bar = document.querySelector(`[data-bar="${i}"]`);
      if (bar) bar.style.height = `${(c / max) * 100}%`;
      const val = document.querySelector(`[data-val="${i}"]`);
      if (val) val.textContent = c;
      const pct = document.querySelector(`[data-pct="${i}"]`);
      if (pct) pct.textContent = resps.length ? ` ${Math.round((c / resps.length) * 100)}%` : "";
    });
    const avg = document.getElementById("avgVal");
    if (avg) avg.textContent = resps.length ? (sum / resps.length).toFixed(1).replace(".", ",") : "–";
    return;
  }
  if (q.type === "wordcloud") {
    const freq = new Map();
    for (const rsp of resps) {
      for (const w of toArray(rsp.v)) {
        const k = String(w).trim().toLowerCase().replace(/\s+/g, " ");
        if (k) freq.set(k, (freq.get(k) || 0) + 1);
      }
    }
    const items = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
    const max = items[0]?.[1] || 1;
    const arranged = [];
    items.forEach((it, i) => (i % 2 ? arranged.push(it) : arranged.unshift(it)));
    const el = document.getElementById("cloud");
    if (el) {
      el.innerHTML = arranged.length
        ? arranged.map(([w, c]) => `<span class="word-item" style="font-size:${1.1 + Math.pow(c / max, 0.75) * 4.6}rem;color:${hashColor(w)}" title="${c}">${esc(w)}</span>`).join("")
        : `<p class="waiting">Aguardando palavras…</p>`;
    }
    return;
  }
  if (q.type === "open") {
    const el = document.getElementById("cards");
    const sorted = [...resps].sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 60);
    if (el) {
      el.innerHTML = sorted.length
        ? sorted.map((rsp, i) => `<div class="card-msg" style="--c:${COLORS[i % COLORS.length]}"><p>${esc(rsp.v)}</p>${rsp.n ? `<span>${esc(rsp.n)}</span>` : ""}</div>`).join("")
        : `<p class="waiting">Aguardando respostas…</p>`;
    }
  }
}

function fillQa(entries) {
  const el = document.getElementById("qaBoard");
  if (!el) return;
  const items = entries
    .map(([id, it]) => ({ id, ...it, count: Object.keys(it.votes || {}).length }))
    .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.count - a.count || (a.t || 0) - (b.t || 0));
  el.innerHTML = items.length
    ? items.map((it) => `
      <div class="qa-row ${it.done ? "done" : ""}">
        <div class="qa-votes">👍<b>${it.count}</b></div>
        <div class="qa-body"><p>${esc(it.text)}</p><span>${esc(it.n || "Anônimo")}</span></div>
        <div class="qa-actions">
          <button class="btn ghost small" data-qa-done="${it.id}">${it.done ? "↩ Reabrir" : "✓ Respondida"}</button>
          <button class="btn ghost small" data-qa-del="${it.id}" title="Remover">🗑</button>
        </div>
      </div>`).join("")
    : `<p class="waiting">Aguardando perguntas da plateia…</p>`;
}

function computeLeaderboard() {
  const scores = {};
  const st = room.state || {};
  for (const [qid, q] of Object.entries(room.questions || {})) {
    if (q.type !== "quiz") continue;
    const start = room.runs?.[qid];
    const correct = room.answers?.[qid];
    if (start == null || correct == null || (st.qid === qid && st.open)) continue;
    for (const [uid, resp] of Object.entries(room.responses?.[qid] || {})) {
      const s = (scores[uid] ||= { pts: 0, hits: 0, n: "" });
      const p = quizPoints(resp, start, q.time, correct);
      s.pts += p;
      if (p > 0) s.hits++;
      s.n = room.participants?.[uid]?.n || resp.n || s.n;
    }
  }
  return Object.values(scores).sort((a, b) => b.pts - a.pts);
}

function fillLeaderboard() {
  const el = document.getElementById("lbList");
  if (!el) return;
  const list = computeLeaderboard().slice(0, 10);
  const medals = ["🥇", "🥈", "🥉"];
  el.innerHTML = list.length
    ? list.map((s, i) => `<li class="${i < 3 ? "top" : ""}"><span class="rank">${medals[i] || i + 1}</span><span class="lb-name">${esc(s.n || "Anônimo")}</span><span class="lb-hits">${s.hits} ✓</span><span class="lb-pts">${s.pts}</span></li>`).join("")
    : `<p class="waiting">Nenhum quiz respondido ainda.</p>`;
}

// ----- resumo final (dashboard) -----
function tally(q, resps) {
  const n = q.type === "scale" ? Number(q.max) || 5 : toArray(q.options).length;
  const counts = Array(n).fill(0);
  let sum = 0;
  for (const rsp of resps) {
    if (q.type === "scale") { const v = Number(rsp.v); if (v >= 1 && v <= n) { counts[v - 1]++; sum += v; } }
    else (Array.isArray(rsp.v) ? rsp.v : [rsp.v]).forEach((i) => { if (counts[i] != null) counts[i]++; });
  }
  return { counts, sum };
}

function wordFreq(resps) {
  const freq = new Map();
  for (const rsp of resps) for (const w of toArray(rsp.v)) {
    const k = String(w).trim().toLowerCase().replace(/\s+/g, " ");
    if (k) freq.set(k, (freq.get(k) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]);
}

function hbars(labels, counts, total, correct = null) {
  const max = Math.max(1, ...counts);
  return `<div class="hbars">${labels.map((l, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    return `<div class="hbar ${correct === i ? "correct" : ""} ${correct != null && correct !== i ? "dim" : ""}">
      <div class="hbar-top"><span>${correct === i ? "✓ " : ""}${esc(l)}</span><b>${pct}%</b></div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${(counts[i] / max) * 100}%;background:${COLORS[i % COLORS.length]}"></div></div>
    </div>`;
  }).join("")}</div>`;
}

function dashCard(q, i) {
  const resps = Object.values(room.responses?.[q.id] || {});
  let n = resps.length, unit = n === 1 ? "resposta" : "respostas", body = "", wide = false;
  const empty = `<p class="muted dempty">Sem respostas</p>`;
  if (q.type === "choice") {
    const { counts } = tally(q, resps);
    body = n ? hbars(toArray(q.options), counts, n) : empty;
  } else if (q.type === "quiz") {
    const { counts } = tally(q, resps);
    const c = room.runs?.[q.id] != null ? Number(room.answers?.[q.id] ?? 0) : null;
    const hits = c == null ? 0 : counts[c] || 0;
    body = n ? `<div class="dstat"><b>${Math.round((hits / n) * 100)}%</b> acertaram</div>${hbars(toArray(q.options), counts, n, c)}` : empty;
  } else if (q.type === "scale") {
    const { counts, sum } = tally(q, resps);
    const max = Math.max(1, ...counts);
    body = n ? `<div class="dscale">
        <div class="davg"><b>${(sum / n).toFixed(1).replace(".", ",")}</b><span>média de 1 a ${counts.length}</span></div>
        <div class="mini-cols">${counts.map((c, k) => `<div class="mcol"><div class="mcol-track"><div class="mcol-bar" style="height:${(c / max) * 100}%;background:${COLORS[k % COLORS.length]}"></div></div><span>${k + 1}</span></div>`).join("")}</div>
      </div>` : empty;
  } else if (q.type === "wordcloud") {
    const words = wordFreq(resps).slice(0, 18);
    const top = words[0]?.[1] || 1;
    wide = true;
    body = words.length ? `<div class="mini-cloud">${words.map(([w, c]) => `<span style="font-size:${0.9 + Math.pow(c / top, 0.75) * 1.9}rem;color:${hashColor(w)}">${esc(w)}</span>`).join("")}</div>` : empty;
  } else if (q.type === "open") {
    const last = [...resps].sort((a, b) => (b.t || 0) - (a.t || 0));
    wide = true;
    body = n ? `<div class="dquotes">${last.slice(0, 4).map((rsp, k) => `<blockquote style="--c:${COLORS[k % COLORS.length]}">${esc(rsp.v)}${rsp.n ? `<cite>${esc(rsp.n)}</cite>` : ""}</blockquote>`).join("")}</div>
      ${n > 4 ? `<p class="muted small">+ ${n - 4} respostas no CSV</p>` : ""}` : empty;
  } else if (q.type === "qa") {
    const items = Object.values(room.qa?.[q.id] || {}).map((it) => ({ ...it, v: Object.keys(it.votes || {}).length })).sort((a, b) => b.v - a.v);
    n = items.length; unit = n === 1 ? "pergunta" : "perguntas";
    body = n ? `<ol class="dqa">${items.slice(0, 4).map((it) => `<li><span class="dvotes">👍 ${it.v}</span>${esc(it.text)}${it.done ? ` <span class="muted">✓</span>` : ""}</li>`).join("")}</ol>` : empty;
  }
  return `<div class="dcard ${wide ? "wide" : ""}">
    <div class="dcard-head"><span class="q-num">${i + 1}</span><h3>${esc(q.title)}</h3><span class="dcount">${n} ${unit}</span></div>
    ${body}
  </div>`;
}

function fillSummary() {
  const el = document.getElementById("dash");
  if (!el) return;
  const qs = sortedQs();
  const people = Object.keys(room.participants || {}).length;
  const total = qs.reduce((a, q) => a + countResponses(q.id, q.type), 0);
  let hits = 0, tries = 0;
  qs.filter((q) => q.type === "quiz" && room.runs?.[q.id] != null).forEach((q) => {
    const c = Number(room.answers?.[q.id] ?? 0);
    Object.values(room.responses?.[q.id] || {}).forEach((rsp) => { tries++; if (Number(rsp.v) === c) hits++; });
  });
  const engaged = people && qs.length ? Math.round((qs.filter((q) => q.type !== "qa").reduce((a, q) => a + countResponses(q.id, q.type), 0) / (people * Math.max(1, qs.filter((q) => q.type !== "qa").length))) * 100) : 0;
  const kpis = [
    [people, "participantes"],
    [total, "respostas"],
    [qs.length, "perguntas"],
    [`${Math.min(100, engaged)}%`, "de participação média"],
  ];
  if (tries) kpis.push([`${Math.round((hits / tries) * 100)}%`, "de acertos no quiz"]);
  const scrollTop = el.scrollTop;
  el.innerHTML = `
    <div class="dash-head">
      <h1>Resumo · ${esc(room.title || "")}</h1>
      <div class="kpis">${kpis.map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    </div>
    <div class="dash-grid">${qs.map(dashCard).join("") || `<p class="waiting">Nenhuma pergunta.</p>`}</div>`;
  el.scrollTop = scrollTop;
}
