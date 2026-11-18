// Funções compartilhadas entre a tela do participante e a do apresentador.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, get, set, update, push, remove, serverTimestamp, onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export { onValue, get, set, update, push, remove, serverTimestamp, onDisconnect };

export const configOk = !!(firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("COLE"));

let db = null, auth = null;
if (configOk) {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);
}

/** Login anônimo: cada navegador ganha um ID próprio (1 voto por pessoa). */
export async function signIn() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
}

export const r = (path) => ref(db, path);

// Relógio sincronizado com o servidor (para o cronômetro do quiz)
let offset = 0;
export function startClock() {
  onValue(r(".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
}
export const serverNow = () => Date.now() + offset;

export const TYPES = {
  choice:    { label: "Múltipla escolha",     icon: "📊" },
  wordcloud: { label: "Nuvem de palavras",    icon: "☁️" },
  open:      { label: "Resposta aberta",      icon: "💬" },
  scale:     { label: "Escala / nota",        icon: "🎚️" },
  quiz:      { label: "Quiz com ranking",     icon: "🏆" },
  qa:        { label: "Perguntas da plateia", icon: "🙋" },
};

export const COLORS = ["#7c6cff", "#22c3a6", "#ff6b9a", "#ffc24b", "#3aa0ff", "#ff8a5b", "#4fd1e8", "#b48cff"];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v.filter((x) => x != null) : Object.values(v);
}

/** Link que a plateia abre (index.html na mesma pasta). */
export function participantUrl(code) {
  const u = new URL("./", location.href);
  u.search = "?c=" + code;
  u.hash = "";
  return u.toString();
}
export function joinDisplay() {
  const u = new URL("./", location.href);
  return (u.host + u.pathname).replace(/\/$/, "");
}

/** Pontos do quiz: 1000 se acertar na hora, caindo até 500 no fim do tempo. */
export function quizPoints(resp, startedAt, timeSec, correct) {
  if (!resp || correct == null || startedAt == null) return 0;
  if (Number(resp.v) !== Number(correct)) return 0;
  const elapsed = Math.max(0, (Number(resp.t) - Number(startedAt)) / 1000);
  const frac = Math.min(1, elapsed / (timeSec || 20));
  return Math.round(1000 - 500 * frac);
}

export function describeAnswer(q, v) {
  const opts = toArray(q.options);
  if (q.type === "choice" || q.type === "quiz") return (Array.isArray(v) ? v : [v]).map((i) => opts[i] ?? "?").join(", ");
  if (q.type === "scale") return `${v} de ${q.max || 5}`;
  if (q.type === "wordcloud") return toArray(v).join(", ");
  return String(v ?? "");
}

export function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
}

export const CONFIG_MSG = `<div class="card center"><div class="big-icon">⚙️</div><h2>Falta configurar o Firebase</h2>
<p class="muted">Preencha o arquivo <code>js/firebase-config.js</code> com os dados do seu projeto. O passo a passo está no README.</p></div>`;
