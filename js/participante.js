// Tela do participante (celular da plateia)
import {
  configOk, signIn, r, get, set, push, onValue, onDisconnect, serverTimestamp,
  startClock, serverNow, esc, toArray, quizPoints, describeAnswer, toast, COLORS, CONFIG_MSG,
} from "./common.js";

const app = document.getElementById("app");
const roomTitleEl = document.getElementById("roomTitle");

let code = (new URLSearchParams(location.search).get("c") || "").replace(/\D/g, "");
let user = null, name = "";
let state = {}, question, mine, qaItems = {};
let watchedQid = null, qUnsubs = [], editing = false, lastKey = "", timerInt = null;
let selection = [];

if (!configOk) app.innerHTML = CONFIG_MSG;
else if (code) join();
else showJoin();

// ---------- Entrada ----------
function showJoin(err = "") {
  app.innerHTML = `
  <div class="card center">
    <h1>Participar</h1>
    <p class="muted">Digite o código que aparece na tela</p>
    <form id="joinForm" class="stack">
      <input id="codeInput" class="input big code-input" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="00000" value="${esc(code)}">
      <button class="btn primary big">Entrar</button>
    </form>
    ${err ? `<p class="error">${esc(err)}</p>` : ""}
  </div>`;
  const input = document.getElementById("codeInput");
  input.focus();
  document.getElementById("joinForm").onsubmit = (e) => {
    e.preventDefault();
    code = input.value.replace(/\D/g, "");
    if (code) join();
  };
}

async function join() {
  app.innerHTML = `<div class="card center"><div class="spinner"></div></div>`;
  try {
    user = user || (await signIn());
    const snap = await get(r(`rooms/${code}/owner`));
    if (!snap.exists()) return showJoin("Sala não encontrada. Confira o código.");
  } catch (e) {
    console.error(e);
    return showJoin("Não foi possível conectar. Verifique sua internet e tente de novo.");
  }
  history.replaceState(null, "", `?c=${code}`);
  const saved = localStorage.getItem("votaai-name");
  if (saved === null) askName();
  else enter(saved);
}

function askName() {
  app.innerHTML = `
  <div class="card center">
    <div class="big-icon">👋</div>
    <h1>Como você se chama?</h1>
    <p class="muted">Seu nome aparece no ranking dos quizzes.</p>
    <form id="nameForm" class="stack">
      <input id="nameInput" class="input" maxlength="30" placeholder="Seu nome ou apelido" autocomplete="nickname">
      <button class="btn primary big">Continuar</button>
      <button type="button" id="anon" class="btn ghost">Entrar sem nome</button>
    </form>
  </div>`;
  const input = document.getElementById("nameInput");
  input.focus();
  document.getElementById("nameForm").onsubmit = (e) => {
    e.preventDefault();
    const n = input.value.trim().slice(0, 30);
    localStorage.setItem("votaai-name", n);
    enter(n);
  };
  document.getElementById("anon").onclick = () => { localStorage.setItem("votaai-name", ""); enter(""); };
}

function enter(n) {
  name = n;
  app.innerHTML = `<div class="card center"><div class="spinner"></div></div>`;
  const pref = r(`rooms/${code}/participants/${user.uid}`);
  // presença: marca online e, se cair a conexão, offline
  onValue(r(".info/connected"), (s) => {
    if (s.val() !== true) return;
    onDisconnect(pref).update({ on: false }).then(() => set(pref, { n: name, on: true, t: serverTimestamp() }));
  });
  startClock();
  onValue(r(`rooms/${code}/title`), (s) => {
    const t = s.val() || "";
    roomTitleEl.textContent = t;
    document.title = t ? `${t} · Participar` : "Participar";
  });
  onValue(r(`rooms/${code}/state`), (s) => {
    state = s.val() || {};
    watchQuestion();
    render();
  });
}

function watchQuestion() {
  const qid = state.view === "question" ? state.qid || null : null;
  if (qid === watchedQid) return;
  qUnsubs.forEach((u) => u());
  qUnsubs = [];
  watchedQid = qid;
  question = undefined; mine = undefined; qaItems = {}; editing = false; selection = [];
  if (!qid) return;
  qUnsubs.push(onValue(r(`rooms/${code}/questions/${qid}`), (s) => { question = s.val(); render(); }));
  qUnsubs.push(onValue(r(`rooms/${code}/responses/${qid}/${user.uid}`), (s) => { mine = s.val(); render(); }));
  qUnsubs.push(onValue(r(`rooms/${code}/qa/${qid}`), (s) => { qaItems = s.val() || {}; renderQaList(); }));
}

// ---------- Renderização ----------
function screenKey() {
  return JSON.stringify([
    state.view, state.qid, !!state.open, state.correct ?? null, state.startedAt ?? null,
    question === undefined ? "u" : question, mine === undefined ? "u" : !!mine, editing,
  ]);
}

function render() {
  const key = screenKey();
  if (key === lastKey) return;
  lastKey = key;
  clearInterval(timerInt);
  timerInt = null;
  app.innerHTML = buildScreen();
  bindScreen();
}

function msgCard(icon, title, text = "") {
  return `<div class="card center"><div class="big-icon">${icon}</div><h2>${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ""}</div>`;
}

function buildScreen() {
  if (state.view === "leaderboard") return msgCard("🏆", "Ranking no telão!", "Olhe para a tela para ver quem está na frente.");
  if (state.view !== "question" || !state.qid)
    return msgCard("🎉", name ? `Você está dentro, ${name}!` : "Você está dentro!", "Aguarde: as perguntas aparecem aqui automaticamente.");
  if (question === undefined || mine === undefined) return `<div class="card center"><div class="spinner"></div></div>`;
  if (!question) return msgCard("⏳", "Aguarde…");

  const q = question;
  if (q.type === "qa") return qaScreen(q);
  if (q.type === "quiz") return quizScreen(q);
  if (mine && !editing) {
    return `<div class="card center">
      <div class="big-icon">✅</div><h2>Resposta enviada!</h2>
      <p class="muted">${esc(q.title)}</p>
      <p class="answer-echo">${esc(describeAnswer(q, mine.v))}</p>
      ${state.open ? `<button class="btn ghost" data-act="edit">Alterar resposta</button>` : `<p class="muted">Votação encerrada.</p>`}
    </div>`;
  }
  if (!state.open) return msgCard("🔒", "Votação encerrada", "Aguarde a próxima pergunta.");
  return formScreen(q);
}

function formScreen(q) {
  const head = `<h2 class="q-title">${esc(q.title)}</h2>`;
  const send = `<button class="btn primary big" data-act="send" disabled>Enviar</button>`;
  if (q.type === "choice") {
    const opts = toArray(q.options);
    return `<div class="card">${head}
      ${q.multi ? `<p class="muted small">Pode escolher mais de uma</p>` : ""}
      <div class="options">${opts.map((o, i) => `
        <button class="option" data-i="${i}" style="--c:${COLORS[i % COLORS.length]}"><span class="dot"></span><span>${esc(o)}</span></button>`).join("")}
      </div>${send}</div>`;
  }
  if (q.type === "scale") {
    const max = Number(q.max) || 5;
    const btns = Array.from({ length: max }, (_, k) => `<button class="scale-btn" data-i="${k + 1}">${k + 1}</button>`).join("");
    return `<div class="card">${head}
      <div class="scale-row" style="--n:${max}">${btns}</div>
      <div class="scale-labels"><span>${esc(q.minLabel || "")}</span><span>${esc(q.maxLabel || "")}</span></div>
      ${send}</div>`;
  }
  if (q.type === "wordcloud") {
    const n = Number(q.maxWords) || 3;
    const inputs = Array.from({ length: n }, (_, k) => `<input class="input word" maxlength="25" placeholder="${n > 1 ? `Palavra ${k + 1}` : "Sua palavra"}">`).join("");
    return `<div class="card">${head}<div class="stack">${inputs}</div>${send}</div>`;
  }
  // open
  return `<div class="card">${head}
    <textarea class="input" id="openText" maxlength="280" rows="4" placeholder="Escreva aqui…"></textarea>
    <div class="counter"><span id="cnt">0</span>/280</div>${send}</div>`;
}

function quizScreen(q) {
  const opts = toArray(q.options);
  const revealed = !state.open && state.correct != null;
  if (revealed) {
    const c = Number(state.correct);
    if (mine) {
      const pts = quizPoints(mine, state.startedAt, q.time, c);
      return pts > 0
        ? `<div class="card center result ok"><div class="big-icon">🎉</div><h2>Acertou!</h2><p class="points">+${pts} pontos</p></div>`
        : `<div class="card center result bad"><div class="big-icon">😕</div><h2>Não foi dessa vez</h2><p class="muted">Resposta certa: <b>${esc(opts[c])}</b></p></div>`;
    }
    return msgCard("⌛", "Você não respondeu a tempo", `Resposta certa: ${opts[c] ?? ""}`);
  }
  if (!state.open) {
    if (state.startedAt == null) return msgCard("🏁", "Prepare-se!", "O quiz vai começar. Quanto mais rápido acertar, mais pontos.");
    return msgCard(mine ? "⏳" : "⌛", mine ? "Resposta registrada" : "Tempo esgotado", "Aguarde o resultado…");
  }
  const timer = `<div class="timer"><div class="timer-fill"></div></div><p class="timer-text"></p>`;
  if (mine) {
    return `<div class="card center"><div class="big-icon">⚡</div><h2>Resposta registrada!</h2>
      <p class="muted">Você escolheu: <b>${esc(opts[mine.v])}</b></p>${timer}</div>`;
  }
  return `<div class="card"><h2 class="q-title">${esc(q.title)}</h2>${timer}
    <div class="options quiz">${opts.map((o, i) => `
      <button class="qopt" data-i="${i}" style="--c:${COLORS[i % COLORS.length]}">${esc(o)}</button>`).join("")}
    </div></div>`;
}

function qaScreen(q) {
  const form = state.open
    ? `<form id="qaForm" class="stack">
        <textarea id="qaText" class="input" maxlength="300" rows="3" placeholder="Escreva sua pergunta…"></textarea>
        <button class="btn primary">Enviar pergunta</button>
      </form>`
    : `<p class="muted">O envio de perguntas foi encerrado, mas você ainda pode votar.</p>`;
  return `<div class="card"><h2 class="q-title">${esc(q.title)}</h2>${form}</div>
    <h3 class="list-title">Perguntas · vote nas que você quer ver respondidas</h3>
    <div id="qaList" class="qa-list"></div>`;
}

function renderQaList() {
  const el = document.getElementById("qaList");
  if (!el || !user) return;
  const items = Object.entries(qaItems)
    .map(([id, it]) => ({ id, ...it, count: Object.keys(it.votes || {}).length, voted: !!(it.votes && it.votes[user.uid]) }))
    .sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.count - a.count || (a.t || 0) - (b.t || 0));
  el.innerHTML = items.length
    ? items.map((it) => `
      <div class="qa-item ${it.done ? "done" : ""}">
        <div class="qa-text">${esc(it.text)}<div class="qa-meta">${esc(it.n || "Anônimo")}${it.done ? " · respondida ✓" : ""}</div></div>
        <button class="vote ${it.voted ? "on" : ""}" data-id="${it.id}">👍 <b>${it.count}</b></button>
      </div>`).join("")
    : `<p class="muted center">Nenhuma pergunta ainda. Seja a primeira pessoa!</p>`;
}

// ---------- Interações ----------
function bindScreen() {
  const sendBtn = app.querySelector('[data-act="send"]');

  app.querySelectorAll(".option, .scale-btn").forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.i);
      if (question.type === "choice" && question.multi) {
        selection = selection.includes(i) ? selection.filter((x) => x !== i) : [...selection, i];
        b.classList.toggle("selected");
      } else {
        selection = [i];
        b.parentElement.querySelectorAll(".selected").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
      }
      sendBtn.disabled = selection.length === 0;
    };
  });

  app.querySelectorAll(".word").forEach((inp) => {
    inp.oninput = () => { sendBtn.disabled = ![...app.querySelectorAll(".word")].some((x) => x.value.trim()); };
  });
  const openText = document.getElementById("openText");
  if (openText) {
    openText.oninput = () => {
      document.getElementById("cnt").textContent = openText.value.length;
      sendBtn.disabled = !openText.value.trim();
    };
  }
  if (sendBtn) sendBtn.onclick = submit;

  const edit = app.querySelector('[data-act="edit"]');
  if (edit) edit.onclick = () => { editing = true; selection = []; render(); };

  app.querySelectorAll(".qopt").forEach((b) => { b.onclick = () => submitQuiz(Number(b.dataset.i), b); });

  const qaForm = document.getElementById("qaForm");
  if (qaForm) qaForm.onsubmit = submitQa;
  renderQaList();

  if (question && question.type === "quiz" && state.open) {
    timerInt = setInterval(tick, 200);
    tick();
  }
}

app.addEventListener("click", (e) => {
  const v = e.target.closest(".vote");
  if (!v) return;
  const it = qaItems[v.dataset.id];
  const voted = !!(it && it.votes && it.votes[user.uid]);
  set(r(`rooms/${code}/qa/${state.qid}/${v.dataset.id}/votes/${user.uid}`), voted ? null : true)
    .catch(() => toast("Não foi possível votar."));
});

async function submit() {
  const q = question;
  const sendBtn = app.querySelector('[data-act="send"]');
  let v;
  if (q.type === "choice") v = q.multi ? [...selection].sort((a, b) => a - b) : selection[0];
  else if (q.type === "scale") v = selection[0];
  else if (q.type === "wordcloud") v = [...app.querySelectorAll(".word")].map((x) => x.value.trim().slice(0, 25)).filter(Boolean);
  else v = (document.getElementById("openText").value || "").trim().slice(0, 280);
  if (v == null || (Array.isArray(v) && !v.length) || v === "") return;

  sendBtn.disabled = true;
  try {
    await set(r(`rooms/${code}/responses/${state.qid}/${user.uid}`), { v, t: serverTimestamp(), n: name });
    editing = false;
    selection = [];
    render();
  } catch (e) {
    console.error(e);
    toast("Não deu para enviar: a votação pode ter sido encerrada.");
    sendBtn.disabled = false;
  }
}

async function submitQuiz(i, btn) {
  app.querySelectorAll(".qopt").forEach((b) => (b.disabled = true));
  btn.classList.add("selected");
  try {
    await set(r(`rooms/${code}/responses/${state.qid}/${user.uid}`), { v: i, t: serverTimestamp(), n: name });
  } catch (e) {
    console.error(e);
    toast("Tempo esgotado!");
  }
}

async function submitQa(e) {
  e.preventDefault();
  const ta = document.getElementById("qaText");
  const text = ta.value.trim().slice(0, 300);
  if (!text) return;
  try {
    await push(r(`rooms/${code}/qa/${state.qid}`), { text, n: name, uid: user.uid, t: serverTimestamp() });
    ta.value = "";
    toast("Pergunta enviada!");
  } catch (err) {
    console.error(err);
    toast("Não foi possível enviar a pergunta.");
  }
}

function tick() {
  const fill = app.querySelector(".timer-fill");
  if (!fill || !question || state.startedAt == null) return;
  const total = (Number(question.time) || 20) * 1000;
  const left = Math.max(0, Number(state.startedAt) + total - serverNow());
  fill.style.width = (left / total) * 100 + "%";
  fill.classList.toggle("low", left < 5000);
  const t = app.querySelector(".timer-text");
  if (t) t.textContent = left > 0 ? `${Math.ceil(left / 1000)}s` : "Tempo esgotado";
  if (left <= 0) app.querySelectorAll(".qopt").forEach((b) => (b.disabled = true));
}
