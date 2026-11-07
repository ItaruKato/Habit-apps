'use strict';

/* =========================================================
 * HaBiTa — iPhone 向け習慣トラッカー PWA
 * データはすべて端末内 (localStorage) に保存されます。
 * ========================================================= */

const STORAGE_KEY = 'habit-tracker:v1';
const INSTALL_DISMISSED_KEY = 'habit-tracker:install-dismissed';
const APP_VERSION = '1.3.0';

const COLORS = ['#34c759', '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#ff3b30', '#ff9500', '#ffcc00', '#a2845e'];
const EMOJIS = ['💧', '🏃', '🚶', '📚', '🧘', '💪', '🛏️', '🌅', '🥗', '🍎', '✍️', '🧠', '🎸', '🎨', '🧹', '💊', '🦷', '📵', '💰', '🌱', '☕', '🚭', '🙏', '🎯'];
const WD = ['日', '月', '火', '水', '木', '金', '土'];
/** 記録項目の種類 */
const FIELD_TYPES = {
  number: '数値',
  duration: '時間（分）',
  text: 'テキスト',
  check: 'チェック',
};
/** 記録項目のテンプレート */
const TEMPLATES = {
  run: {
    label: '🏃 ランニング', name: 'ランニング', emoji: '🏃', color: '#ff3b30', useTimer: true,
    fields: [{ name: '距離', type: 'number', unit: 'km' }, { name: '時間', type: 'duration' }, { name: 'ストレッチ', type: 'check' }],
  },
  read: {
    label: '📚 読書', name: '読書', emoji: '📚', color: '#ff9500', useTimer: true,
    fields: [{ name: '本の名前', type: 'text' }, { name: 'ページ数', type: 'number', unit: 'ページ' }, { name: '時間', type: 'duration' }],
  },
  workout: {
    label: '💪 筋トレ', name: '筋トレ', emoji: '💪', color: '#af52de', useTimer: false,
    fields: [{ name: '種目', type: 'text' }, { name: '回数', type: 'number', unit: '回' }, { name: 'セット', type: 'number', unit: 'セット' }],
  },
};
/** 日記の気分（5段階） */
const MOODS = [
  { v: 5, e: '😄', label: '最高' },
  { v: 4, e: '🙂', label: '良い' },
  { v: 3, e: '😐', label: 'ふつう' },
  { v: 2, e: '😕', label: 'いまいち' },
  { v: 1, e: '😢', label: 'つらい' },
];
const moodOf = (v) => MOODS.find((m) => m.v === v);

const fieldsFromTemplate = (key) => (TEMPLATES[key]?.fields || []).map((f) => ({ id: uid(), unit: '', ...f }));

const SUGGESTIONS = [
  { name: 'ランニング', emoji: '🏃', color: '#ff3b30', target: 1, template: 'run' },
  { name: '読書', emoji: '📚', color: '#ff9500', target: 1, template: 'read' },
  { name: '水を飲む', emoji: '💧', color: '#30b0c7', target: 8 },
  { name: '散歩', emoji: '🚶', color: '#34c759', target: 1 },
  { name: '瞑想', emoji: '🧘', color: '#5856d6', target: 1 },
  { name: '筋トレ', emoji: '💪', color: '#af52de', target: 1, template: 'workout' },
  { name: '早起き', emoji: '🌅', color: '#ffcc00', target: 1 },
];

/* ---------- 日付ユーティリティ ---------- */
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const todayKey = () => keyOf(new Date());
const fmtDate = (d) => `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
const fmtTime = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** "HH:MM" と日付キーから時刻(ms)を作る */
const timeOn = (k, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = parseKey(k); d.setHours(h, m, 0, 0); return d.getTime(); };
function fmtMin(m) {
  m = Math.round(m);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}`;
}
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
const fmtNum = (v) => String(Math.round(v * 100) / 100);

/* ---------- 汎用 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

/* ---------- 状態 ---------- */
let state = load();
const ui = {
  tab: 'today',
  selected: todayKey(),
  today: todayKey(),
  sheet: null,          // { type: 'detail' | 'edit' | 'entry', ... }
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1), // カレンダータブの表示月
  calSel: todayKey(),   // カレンダータブで選択中の日
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.habits)) return { version: 1, habits: s.habits.map(normalizeHabit).filter(Boolean), diary: normalizeDiary(s.diary) };
    }
  } catch (e) { /* 破損データは無視 */ }
  return { version: 1, habits: [], diary: {} };
}

/** 日記: { 'YYYY-MM-DD': { mood: 1〜5, note: '一言' } } */
function normalizeDiary(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') continue;
    const mood = Number.isInteger(v.mood) && v.mood >= 1 && v.mood <= 5 ? v.mood : undefined;
    const note = typeof v.note === 'string' ? v.note.slice(0, 100) : '';
    if (mood || note) out[k] = { ...(mood ? { mood } : {}), ...(note ? { note } : {}) };
  }
  return out;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('保存に失敗しました。ストレージの空き容量を確認してください。');
  }
}

function normalizeHabit(h) {
  if (!h || typeof h !== 'object' || typeof h.name !== 'string') return null;
  const days = Array.isArray(h.days) ? h.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  const log = {};
  if (h.log && typeof h.log === 'object') {
    for (const [k, v] of Object.entries(h.log)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number(v) > 0) log[k] = Math.floor(Number(v));
    }
  }
  return {
    id: typeof h.id === 'string' && h.id ? h.id : uid(),
    name: h.name.slice(0, 40),
    emoji: typeof h.emoji === 'string' && h.emoji ? h.emoji : '✅',
    color: typeof h.color === 'string' && /^#[0-9a-f]{6}$/i.test(h.color) ? h.color : COLORS[0],
    days: days.length ? [...new Set(days)].sort() : [0, 1, 2, 3, 4, 5, 6],
    target: Math.min(99, Math.max(1, Math.floor(Number(h.target) || 1))),
    createdAt: typeof h.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.createdAt) ? h.createdAt : todayKey(),
    log,
    fields: normalizeFields(h.fields),
    useTimer: h.useTimer === true,
    timer: h.timer && Number(h.timer.start) > 0 ? { start: Number(h.timer.start) } : null,
    entries: normalizeEntries(h.entries),
  };
}

function normalizeFields(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && typeof f === 'object' && FIELD_TYPES[f.type])
    .slice(0, 8)
    .map((f) => ({
      id: typeof f.id === 'string' && f.id ? f.id : uid(),
      name: String(f.name || FIELD_TYPES[f.type]).slice(0, 20),
      type: f.type,
      unit: f.type === 'number' ? String(f.unit || '').slice(0, 10) : '',
    }));
}

function normalizeEntries(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, arr] of Object.entries(obj)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(arr)) continue;
    const list = arr.filter((e) => e && typeof e === 'object').map((e) => {
      const values = {};
      if (e.values && typeof e.values === 'object') {
        for (const [fid, v] of Object.entries(e.values)) {
          if (typeof v === 'number' && Number.isFinite(v)) values[fid] = v;
          else if (typeof v === 'string' && v) values[fid] = v.slice(0, 100);
          else if (v === true) values[fid] = true;
        }
      }
      const num = (x) => (Number(x) > 0 ? Number(x) : undefined);
      return { id: typeof e.id === 'string' && e.id ? e.id : uid(), at: num(e.at), start: num(e.start), end: num(e.end), values };
    });
    if (list.length) out[k] = list;
  }
  return out;
}

const findHabit = (id) => state.habits.find((h) => h.id === id);

/* ---------- 習慣ロジック ---------- */
const countOn = (h, k) => h.log[k] || 0;
const isDone = (h, k) => countOn(h, k) >= h.target;
const isScheduled = (h, date) => h.days.includes(date.getDay());

function startKey(h) {
  let s = h.createdAt;
  for (const k in h.log) if (k < s) s = k;
  return s;
}

/** その日にやる予定の習慣か（開始日以降 かつ 曜日が該当） */
const dueOn = (h, date) => isScheduled(h, date) && keyOf(date) >= startKey(h);

function setCount(h, k, n) {
  if (n > 0) h.log[k] = n; else delete h.log[k];
}

/* ---------- 記録の詳細（項目・時刻ログ） ---------- */
const hasFields = (h) => h.fields.length > 0;
const entriesOn = (h, k) => h.entries[k] || [];
function addEntry(h, k, e) { (h.entries[k] ||= []).push(e); }
function removeEntry(h, k, id) {
  const rest = entriesOn(h, k).filter((e) => e.id !== id);
  if (rest.length) h.entries[k] = rest; else delete h.entries[k];
}
/** 並べ替え用の時刻（時刻がない記録はその日の正午扱い） */
const entryTime = (k, e) => e.end || e.at || e.start || parseKey(k).getTime() + 12 * 3600e3;

function summarizeEntry(h, e) {
  const parts = [];
  for (const f of h.fields) {
    const v = e.values[f.id];
    if (v === undefined) continue;
    if (f.type === 'number') parts.push(`${fmtNum(v)}${f.unit}`);
    else if (f.type === 'duration') parts.push(fmtMin(v));
    else if (f.type === 'text') parts.push(`「${v}」`);
    else if (f.type === 'check' && v === true) parts.push(`✓${f.name}`);
  }
  return parts.join(' · ');
}

function entryTimeLabel(e) {
  if (e.start && e.end) return `${fmtTime(e.start)}〜${fmtTime(e.end)}`;
  if (e.start) return `${fmtTime(e.start)}〜`;
  if (e.end || e.at) return fmtTime(e.end || e.at);
  return '';
}

/** 数値・時間・チェック項目の合計（fromKey 以降） */
function fieldTotal(h, f, fromKey = '') {
  let sum = 0, n = 0;
  for (const [k, arr] of Object.entries(h.entries)) {
    if (k < fromKey) continue;
    for (const e of arr) {
      const v = e.values[f.id];
      if (f.type === 'check') { if (v === true) n++; }
      else if (typeof v === 'number') { sum += v; n++; }
    }
  }
  return { sum, n };
}

/** テキスト項目の過去の入力（新しい順・重複なし） */
function textHistory(h, f, limit = 20) {
  const all = [];
  for (const [k, arr] of Object.entries(h.entries)) for (const e of arr) {
    if (typeof e.values[f.id] === 'string') all.push([entryTime(k, e), e.values[f.id]]);
  }
  all.sort((a, b) => b[0] - a[0]);
  return [...new Set(all.map((x) => x[1]))].slice(0, limit);
}

function totalsLine(h) {
  const monthKey = keyOf(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  return h.fields
    .filter((f) => f.type === 'number' || f.type === 'duration')
    .map((f) => {
      const { sum, n } = fieldTotal(h, f, monthKey);
      if (!n) return '';
      return `${esc(f.name)} <b>${f.type === 'duration' ? fmtMin(sum) : fmtNum(sum) + esc(f.unit)}</b>`;
    })
    .filter(Boolean).join('　');
}

function currentStreak(h) {
  const start = parseKey(startKey(h));
  let d = startOfToday();
  // 今日まだ未完了でも、連続記録は途切れていない扱い
  if (!isDone(h, keyOf(d))) d = addDays(d, -1);
  let streak = 0;
  for (let i = 0; i < 4000 && d >= start; i++, d = addDays(d, -1)) {
    if (!isScheduled(h, d)) continue;
    if (isDone(h, keyOf(d))) streak++; else break;
  }
  return streak;
}

function bestStreak(h) {
  const end = startOfToday();
  let best = 0, run = 0;
  for (let d = parseKey(startKey(h)); d <= end; d = addDays(d, 1)) {
    if (!isScheduled(h, d)) continue;
    const k = keyOf(d);
    if (isDone(h, k)) { run++; if (run > best) best = run; }
    else if (k !== ui.today) run = 0;
  }
  return best;
}

/** 直近 n 日間の達成率（今日は完了済みのときだけ分母に含める） */
function completionRate(h, n = 30) {
  const today = startOfToday();
  const sk = startKey(h);
  let due = 0, done = 0;
  for (let i = 0; i < n; i++) {
    const d = addDays(today, -i);
    const k = keyOf(d);
    if (k < sk) break;
    if (!isScheduled(h, d)) continue;
    const ok = isDone(h, k);
    if (i === 0 && !ok) continue;
    due++; if (ok) done++;
  }
  return due ? Math.round((done / due) * 100) : null;
}

function totalDone(h) {
  return Object.keys(h.log).filter((k) => isDone(h, k)).length;
}

function dayProgress(date) {
  const k = keyOf(date);
  const due = state.habits.filter((h) => dueOn(h, date));
  const done = due.filter((h) => isDone(h, k)).length;
  return { due: due.length, done };
}

function freqLabel(days) {
  const s = [...days].sort().join('');
  if (s === '0123456') return '毎日';
  if (s === '12345') return '平日';
  if (s === '06') return '週末';
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD[d]).join('・');
}

/* ---------- 描画パーツ ---------- */
function ring(p, size, stroke, color = 'var(--accent)') {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, p)));
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="bar" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" style="stroke:${color};${p <= 0 ? 'opacity:0' : ''}"/>
  </svg>`;
}

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';

function habitItem(h, k) {
  const n = countOn(h, k);
  const done = n >= h.target;
  const p = Math.min(1, n / h.target);
  const streak = currentStreak(h);
  const running = !!h.timer;
  const meta = [
    running ? `<span class="timer-live" data-timer-start="${h.timer.start}">⏱ ${fmtElapsed(Date.now() - h.timer.start)}</span>` : '',
    running ? '' : `<span>${freqLabel(h.days)}</span>`,
    h.target > 1 ? `<span>目標 ${h.target}回</span>` : '',
    streak > 0 ? `<span class="streak-hot">🔥 ${streak}日連続</span>` : '',
  ].join('');
  const list = entriesOn(h, k);
  const last = list.length ? list[list.length - 1] : null;
  let sub = '';
  if (last) {
    const sum = summarizeEntry(h, last), t = entryTimeLabel(last);
    sub = sum ? [t, sum].filter(Boolean).join(' ') : t && !last.start ? `${t} に実行` : t;
  }
  const checkInner = h.target > 1 && !done ? `${n}/${h.target}` : CHECK_SVG;
  const showTimer = h.useTimer && (k === ui.today || running);
  return `<li class="habit card ${done ? 'done' : ''} ${running ? 'running' : ''}" style="--c:${h.color};--p:${p}" data-habit="${h.id}">
    <div class="fill"></div>
    <button class="habit-main" data-action="detail" data-id="${h.id}" aria-label="${esc(h.name)} の詳細">
      <span class="emoji">${esc(h.emoji)}</span>
      <span class="habit-text">
        <div class="habit-name">${esc(h.name)}</div>
        <div class="habit-meta">${meta}</div>
        ${sub ? `<div class="habit-sub">${esc(sub)}</div>` : ''}
      </span>
    </button>
    ${h.target > 1 && n > 0 && !running ? `<button class="minus" data-action="minus" data-id="${h.id}" data-key="${k}" aria-label="1回減らす">−</button>` : ''}
    ${showTimer ? `<button class="timer-btn ${running ? 'on' : ''}" data-action="${running ? 'timer-stop' : 'timer-start'}" data-id="${h.id}"
      aria-label="${esc(h.name)} の${running ? 'タイマーを止めて記録' : 'タイマーをスタート'}">${running ? STOP_SVG : PLAY_SVG}</button>` : ''}
    <button class="check" data-action="toggle" data-id="${h.id}" data-key="${k}"
      aria-label="${esc(h.name)} を${done ? '未完了に戻す' : hasFields(h) ? '記録する' : h.target > 1 ? '1回記録' : '完了にする'}" aria-pressed="${done}">${checkInner}</button>
  </li>`;
}

/* ---------- 画面: 今日 ---------- */
function renderToday() {
  const today = startOfToday();
  const sel = parseKey(ui.selected);
  const isToday = ui.selected === ui.today;

  const banner = !isStandalone() && !localStorage.getItem(INSTALL_DISMISSED_KEY)
    ? `<div class="install-banner card">
        <span style="font-size:24px">📲</span>
        <p><b>ホーム画面に追加</b>するとアプリのように使えます。Safari の共有ボタン <b>⎙</b> →「ホーム画面に追加」</p>
        <button class="x" data-action="dismiss-install" aria-label="閉じる">×</button>
      </div>`
    : '';

  let week = '';
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const k = keyOf(d);
    const { due, done } = dayProgress(d);
    const cls = ['day', d.getDay() === 0 ? 'sun' : '', d.getDay() === 6 ? 'sat' : '', k === ui.selected ? 'selected' : '', k === ui.today ? 'is-today' : ''].join(' ');
    week += `<button class="${cls}" data-action="select-day" data-key="${k}" aria-label="${fmtDate(d)}">
      <span class="wd">${k === ui.today ? '今日' : WD[d.getDay()]}</span>
      <span class="ring-sm">${ring(due ? done / due : 0, 34, 3.5)}<span>${d.getDate()}</span></span>
    </button>`;
  }

  if (!state.habits.length) {
    return `
      ${header(fmtDate(today), '今日', true)}
      ${banner}
      <div class="empty">
        <div class="big-emoji">🌱</div>
        <h2 style="font-size:20px;color:var(--text);margin:12px 0 0">小さな習慣から始めよう</h2>
        <p>続けたいことを追加して、毎日チェックしましょう。</p>
        <button class="primary" data-action="add">${PLUS_SVG.replace('<svg', '<svg style="width:20px;height:20px;stroke:#fff;stroke-width:2.6;fill:none;stroke-linecap:round"')}習慣を追加</button>
        <h2 style="margin-top:32px">ワンタップで追加</h2>
        <div class="chips">
          ${SUGGESTIONS.map((s, i) => `<button class="chip" data-action="quick-add" data-index="${i}">${s.emoji} ${esc(s.name)}</button>`).join('')}
        </div>
      </div>`;
  }

  const due = state.habits.filter((h) => dueOn(h, sel));
  const rest = state.habits.filter((h) => !dueOn(h, sel));
  const done = due.filter((h) => isDone(h, ui.selected)).length;
  const p = due.length ? done / due.length : 0;

  let msg;
  if (!due.length) msg = 'この日の予定はありません';
  else if (done === due.length) msg = isToday ? '今日の習慣はすべて完了！🎉' : 'すべて完了しています 🎉';
  else if (done === 0) msg = isToday ? 'さあ、始めましょう' : 'まだ記録がありません';
  else msg = `あと ${due.length - done} 個`;

  return `
    ${header(isToday ? fmtDate(today) : `${fmtDate(sel)} の記録`, isToday ? '今日' : `${sel.getMonth() + 1}/${sel.getDate()}`, true,
      isToday ? '' : '<button class="link-btn" data-action="go-today">今日に戻る</button>')}
    ${banner}
    <div class="week card">${week}</div>
    <div class="summary card">
      <div class="ring-lg">${ring(p, 72, 8)}<span>${Math.round(p * 100)}%</span></div>
      <div>
        <p class="big">${msg}</p>
        <p class="small">${due.length ? `${done} / ${due.length} 完了` : 'ゆっくり休みましょう'}</p>
      </div>
    </div>
    ${diaryCard(ui.selected)}
    ${due.length ? `<h2>${isToday ? '今日やること' : 'この日の習慣'}</h2><ul class="list">${due.map((h) => habitItem(h, ui.selected)).join('')}</ul>` : ''}
    ${rest.length ? `<h2>予定なしの日</h2><ul class="list rest">${rest.map((h) => habitItem(h, ui.selected)).join('')}</ul>` : ''}
  `;
}

function header(eyebrow, title, withAdd, extra = '') {
  return `<header class="top">
    <div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div>
    <div style="display:flex;align-items:center;gap:8px">${extra}
      ${withAdd ? `<button class="icon-btn" data-action="add" aria-label="習慣を追加">${PLUS_SVG}</button>` : ''}
    </div>
  </header>`;
}

/* ---------- 日記（気分と一言） ---------- */
function diaryCard(k) {
  if (k > ui.today) return '';
  const d = state.diary[k] || {};
  const isToday = k === ui.today;
  return `<div class="diary card">
    <p class="diary-q">${isToday ? '今日の気分は？' : 'この日の気分'}</p>
    <div class="mood-row" role="radiogroup" aria-label="気分">
      ${MOODS.map((m) => `<button class="mood ${d.mood === m.v ? 'sel' : ''}" data-action="mood" data-key="${k}" data-mood="${m.v}"
        role="radio" aria-checked="${d.mood === m.v}" aria-label="${m.label}"><span>${m.e}</span><small>${m.label}</small></button>`).join('')}
    </div>
    <input class="in diary-note" data-key="${k}" maxlength="100" value="${esc(d.note || '')}"
      placeholder="${isToday ? '今日の一言（なくてもOK）' : '一言（なくてもOK）'}" enterkeyhint="done" autocomplete="off" aria-label="一言日記">
  </div>`;
}

function setMood(k, v) {
  const cur = state.diary[k] || {};
  const next = { ...cur };
  if (cur.mood === v) delete next.mood; else next.mood = v; // 同じ顔をもう一度タップで解除
  if (next.mood || next.note) state.diary[k] = next; else delete state.diary[k];
  save();
  render();
}

let noteTimer;
function setNote(k, text) {
  const cur = state.diary[k] || {};
  const next = { ...cur, note: text.slice(0, 100) };
  if (!next.note) delete next.note;
  if (next.mood || next.note) state.diary[k] = next; else delete state.diary[k];
  clearTimeout(noteTimer);
  noteTimer = setTimeout(save, 400);
}

/* ---------- 画面: カレンダー ---------- */
function renderCalendar() {
  const m = ui.calMonth;
  const today = startOfToday();
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const isCurrentMonth = m.getFullYear() === today.getFullYear() && m.getMonth() === today.getMonth();

  let cells = WD.map((w, i) => `<span class="wdh ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('');
  for (let i = 0; i < first.getDay(); i++) cells += '<span></span>';
  const moodCount = {};
  let diaryDays = 0, perfectDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(m.getFullYear(), m.getMonth(), day);
    const k = keyOf(d);
    const future = d > today;
    const { due, done } = dayProgress(d);
    const ratio = due ? done / due : 0;
    const diary = state.diary[k];
    if (diary) diaryDays++;
    if (diary && diary.mood) moodCount[diary.mood] = (moodCount[diary.mood] || 0) + 1;
    if (!future && due && done === due) perfectDays++;
    const cls = ['mday', k === ui.calSel ? 'sel' : '', k === ui.today ? 'today' : '', future ? 'fut' : '', due && done === due ? 'all' : ''].join(' ');
    const mood = diary && diary.mood ? moodOf(diary.mood).e : '';
    cells += `<button class="${cls}" style="--r:${(ratio * 100).toFixed(0)}%" data-action="mcal-day" data-key="${k}" ${future ? 'disabled' : ''}
      aria-label="${fmtDate(d)} ${due ? `${done}/${due}完了` : ''} ${mood ? moodOf(diary.mood).label : ''}">
      <b>${day}</b><span class="mood-mini">${mood || (diary && diary.note ? '✎' : '')}</span>
      ${due && !future ? `<i class="bar"><i style="width:${(ratio * 100).toFixed(0)}%"></i></i>` : ''}
    </button>`;
  }

  const moodSummary = MOODS.filter((x) => moodCount[x.v]).map((x) => `<span>${x.e} <b>${moodCount[x.v]}</b></span>`).join('');
  const sel = ui.calSel <= ui.today ? ui.calSel : ui.today;
  return `${header('日々の記録と日記', 'カレンダー', false, isCurrentMonth && ui.calSel === ui.today ? '' : '<button class="link-btn" data-action="mcal-today">今日</button>')}
    <div class="card mcal">
      <div class="cal-head">
        <button data-action="mcal-prev" aria-label="前の月">‹</button>
        <b>${m.getFullYear()}年${m.getMonth() + 1}月</b>
        <button data-action="mcal-next" aria-label="次の月" ${isCurrentMonth ? 'disabled' : ''}>›</button>
      </div>
      <div class="mcal-grid">${cells}</div>
      <div class="mcal-foot">
        <span>全部達成 <b>${perfectDays}</b>日</span>
        <span>日記 <b>${diaryDays}</b>日</span>
        ${moodSummary ? `<span class="moods">${moodSummary}</span>` : ''}
      </div>
    </div>
    ${renderDay(sel)}`;
}

/** カレンダーで選んだ日の日記と習慣 */
function renderDay(k) {
  const d = parseKey(k);
  const due = state.habits.filter((h) => dueOn(h, d));
  const others = state.habits.filter((h) => !dueOn(h, d) && (countOn(h, k) > 0 || entriesOn(h, k).length));
  const done = due.filter((h) => isDone(h, k)).length;
  return `<h2 class="day-title">${d.getFullYear()}年${fmtDate(d)}${k === ui.today ? '（今日）' : ''}</h2>
    ${diaryCard(k)}
    ${due.length ? `<h2>習慣 ${done} / ${due.length} 完了</h2><ul class="list">${due.map((h) => habitItem(h, k)).join('')}</ul>` : ''}
    ${others.length ? `<h2>予定外に実行</h2><ul class="list">${others.map((h) => habitItem(h, k)).join('')}</ul>` : ''}
    ${!due.length && !others.length ? `<p class="note" style="text-align:center;margin-top:16px">${state.habits.length ? 'この日の予定はありません' : '習慣を追加すると、ここに記録が表示されます'}</p>` : ''}`;
}

/* ---------- 画面: 記録 ---------- */
function heatmap(h, weeks = 18) {
  const today = startOfToday();
  const start = addDays(today, -today.getDay() - (weeks - 1) * 7);
  const sk = startKey(h);
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const k = keyOf(d);
    let cls = '';
    if (d > today) cls = 'fut';
    else {
      const n = countOn(h, k);
      if (n >= h.target) cls = 'on';
      else if (n > 0) cls = 'part';
      else if (isScheduled(h, d) && k >= sk) cls = 'sch';
    }
    cells += `<i class="${cls}" title="${k}"></i>`;
  }
  return `<div class="heat" aria-hidden="true">${cells}</div>`;
}

function renderStats() {
  if (!state.habits.length) {
    return `${header('これまでの積み重ね', '記録', false)}
      <div class="empty"><div class="big-emoji">📊</div><p>習慣を追加すると、ここに記録が表示されます。</p>
      <button class="primary" data-action="add">習慣を追加</button></div>`;
  }
  const { due, done } = dayProgress(startOfToday());
  const best = Math.max(0, ...state.habits.map(bestStreak));
  const cards = state.habits.map((h) => {
    const rate = completionRate(h);
    return `<li><button class="stat-card card" style="--c:${h.color}" data-action="detail" data-id="${h.id}">
      <div class="stat-head">
        <span class="emoji" style="--c:${h.color}">${esc(h.emoji)}</span>
        <span class="habit-name">${esc(h.name)}</span>
        <span class="chev">›</span>
      </div>
      ${heatmap(h)}
      <div class="mini-stats">
        <span>連続 <b>${currentStreak(h)}</b>日</span>
        <span>最高 <b>${bestStreak(h)}</b>日</span>
        <span>30日達成率 <b>${rate === null ? '—' : rate + '%'}</b></span>
      </div>
      ${totalsLine(h) ? `<div class="mini-stats">今月　${totalsLine(h)}</div>` : ''}
    </button></li>`;
  }).join('');
  return `${header('これまでの積み重ね', '記録', false)}
    <div class="overview">
      <div class="stat card"><b>${state.habits.length}</b><small>習慣</small></div>
      <div class="stat card"><b>${done}/${due}</b><small>今日の達成</small></div>
      <div class="stat card"><b>${best}</b><small>最高連続(日)</small></div>
    </div>
    <h2>習慣ごとの記録（直近18週）</h2>
    <ul class="list">${cards}</ul>`;
}

/* ---------- 画面: 設定 ---------- */
function renderSettings() {
  const totalLogs = state.habits.reduce((s, h) => s + totalDone(h), 0);
  return `${header('アプリについて', '設定', false)}
    ${isStandalone() ? '' : `
    <h2>iPhone のホーム画面に追加する</h2>
    <div class="card">
      <ol class="steps">
        <li>Safari でこのページを開く</li>
        <li>画面下の共有ボタン <b>⎙</b> をタップ</li>
        <li>「<b>ホーム画面に追加</b>」を選ぶ</li>
        <li>ホーム画面のアイコンから起動（オフラインでも動きます）</li>
      </ol>
    </div>`}
    <h2>データ</h2>
    <div class="card group">
      <div class="row"><span>習慣の数</span><span class="val">${state.habits.length}</span></div>
      <div class="row"><span>達成した記録の合計</span><span class="val">${totalLogs}回</span></div>
      <div class="row"><span>日記を書いた日</span><span class="val">${Object.keys(state.diary).length}日</span></div>
      <button class="row" data-action="export"><span>バックアップを書き出す</span><span class="val">›</span></button>
      <button class="row" data-action="import"><span>バックアップから復元</span><span class="val">›</span></button>
    </div>
    <p class="note">データはこの端末の中だけに保存され、外部には送信されません。機種変更の前にはバックアップを書き出してください。</p>
    <h2>リセット</h2>
    <div class="card group">
      <button class="row danger-btn" data-action="reset"><span>すべてのデータを削除</span></button>
    </div>
    <p class="note" style="text-align:center;margin-top:24px">HaBiTa v${APP_VERSION}</p>
    <input type="file" id="import-file" accept="application/json,.json" hidden>`;
}

/* ---------- 描画 ---------- */
function render() {
  const view = $('#view');
  if (ui.tab === 'today') view.innerHTML = renderToday();
  else if (ui.tab === 'calendar') view.innerHTML = renderCalendar();
  else if (ui.tab === 'stats') view.innerHTML = renderStats();
  else view.innerHTML = renderSettings();
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === ui.tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (ui.sheet && ui.sheet.type === 'detail') renderDetail();
}

/* ---------- シート ---------- */
function openSheet() {
  const root = $('#sheet-root');
  root.hidden = false;
  root.classList.remove('closing');
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  const root = $('#sheet-root');
  if (root.hidden) return;
  ui.sheet = null;
  root.classList.add('closing');
  setTimeout(() => {
    if (ui.sheet) return; // 閉じている間に別のシートが開かれた
    root.hidden = true;
    root.classList.remove('closing');
    $('#sheet-body').innerHTML = '';
    document.body.style.overflow = '';
  }, 220);
}

function openDetail(id) {
  const h = findHabit(id);
  if (!h) return;
  const t = startOfToday();
  ui.sheet = { type: 'detail', id, month: new Date(t.getFullYear(), t.getMonth(), 1) };
  renderDetail();
  openSheet();
}

function renderDetail() {
  const h = findHabit(ui.sheet.id);
  if (!h) { closeSheet(); return; }
  const m = ui.sheet.month;
  const today = startOfToday();
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const isCurrentMonth = m.getFullYear() === today.getFullYear() && m.getMonth() === today.getMonth();
  const sk = startKey(h);

  let cal = WD.map((w) => `<span class="wdh">${w}</span>`).join('');
  for (let i = 0; i < first.getDay(); i++) cal += '<span></span>';
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(m.getFullYear(), m.getMonth(), day);
    const k = keyOf(d);
    const n = countOn(h, k);
    const cls = [
      n >= h.target ? 'on' : n > 0 ? 'part' : (isScheduled(h, d) && k >= sk ? 'sch' : ''),
      k === ui.today ? 'today' : '',
    ].join(' ');
    const label = `${fmtDate(d)} ${n >= h.target ? '完了' : n > 0 ? `${n}/${h.target}回` : '未記録'}`;
    cal += `<button class="${cls}" data-action="cal-day" data-key="${k}" ${d > today ? 'disabled' : ''} aria-label="${label}">${day}</button>`;
  }

  const rate = completionRate(h);
  $('#sheet-body').innerHTML = `
    <div class="sheet-head">
      <button class="link-btn" data-close-sheet>閉じる</button>
      <button class="link-btn" data-action="edit" data-id="${h.id}">編集</button>
    </div>
    <div class="detail-title" style="--c:${h.color}">
      <span class="emoji">${esc(h.emoji)}</span>
      <div><h3>${esc(h.name)}</h3><p>${freqLabel(h.days)}${h.target > 1 ? ` · 1日 ${h.target}回` : ''}</p></div>
    </div>
    <div class="overview">
      <div class="stat card"><b>${currentStreak(h)}</b><small>連続(日)</small></div>
      <div class="stat card"><b>${bestStreak(h)}</b><small>最高連続(日)</small></div>
      <div class="stat card"><b>${rate === null ? '—' : rate + '%'}</b><small>30日達成率</small></div>
    </div>
    <h2>カレンダー（タップで記録を修正）</h2>
    <div class="card" style="--c:${h.color}">
      <div class="cal-head">
        <button data-action="cal-prev" aria-label="前の月">‹</button>
        <b>${m.getFullYear()}年${m.getMonth() + 1}月</b>
        <button data-action="cal-next" aria-label="次の月" ${isCurrentMonth ? 'disabled' : ''}>›</button>
      </div>
      <div class="cal">${cal}</div>
      <div class="legend">
        <span><i style="background:${h.color}"></i>完了</span>
        ${h.target > 1 ? `<span><i style="background:color-mix(in srgb, ${h.color} 40%, transparent)"></i>途中</span>` : ''}
        <span><i style="background:var(--faint)"></i>予定日</span>
      </div>
    </div>
    <p class="note">合計 ${totalDone(h)} 日達成 · ${parseKey(h.createdAt).getFullYear()}年${fmtDate(parseKey(h.createdAt))} から</p>
    ${fieldSummary(h)}
    ${entryLog(h)}
    <div class="actions">
      <div class="card group"><button class="row danger-btn" data-action="delete" data-id="${h.id}">この習慣を削除</button></div>
    </div>`;
}

function fieldSummary(h) {
  if (!hasFields(h)) return '';
  const monthKey = keyOf(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const rows = h.fields.map((f) => {
    if (f.type === 'text') {
      const hist = textHistory(h, f, 6);
      return `<div class="row sum-row"><span>${esc(f.name)}</span>
        <span class="chips-sm">${hist.length ? hist.map((v) => `<i>${esc(v)}</i>`).join('') : '<span class="val">まだ記録なし</span>'}</span></div>`;
    }
    const m = fieldTotal(h, f, monthKey), all = fieldTotal(h, f);
    const show = (t) => f.type === 'check' ? `${t.n}回` : f.type === 'duration' ? fmtMin(t.sum) : `${fmtNum(t.sum)}${esc(f.unit)}`;
    return `<div class="row sum-row"><span>${esc(f.name)}</span>
      <span class="sum-vals"><span>今月 <b>${show(m)}</b></span><span>累計 <b>${show(all)}</b></span></span></div>`;
  }).join('');
  return `<h2>記録した内容</h2><div class="card group">${rows}</div>`;
}

function entryLog(h) {
  const all = [];
  for (const [k, arr] of Object.entries(h.entries)) for (const e of arr) all.push([k, e]);
  all.sort((a, b) => entryTime(b[0], b[1]) - entryTime(a[0], a[1]));
  const limit = ui.sheet.logLimit || 15;
  const rows = all.slice(0, limit).map(([k, e]) => {
    const d = parseKey(k);
    const sum = summarizeEntry(h, e);
    return `<button class="row log-row" data-action="entry-open" data-id="${h.id}" data-key="${k}" data-entry="${e.id}">
      <span class="log-when"><b>${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})</b> ${entryTimeLabel(e) || '時刻なし'}</span>
      <span class="log-sum">${sum ? esc(sum) : ''}</span><span class="val">›</span>
    </button>`;
  }).join('');
  return `<h2>実行ログ</h2>
    <div class="card group">
      ${rows || '<div class="row"><span class="val">チェックやタイマーを使うと、実行した時刻がここに残ります</span></div>'}
      ${all.length > limit ? '<button class="row link-row" data-action="log-more">もっと見る</button>' : ''}
      <button class="row link-row" data-action="entry-new" data-id="${h.id}">＋ 今日の記録を追加</button>
    </div>`;
}

/* ---------- 記録の入力シート ---------- */
const toTimeVal = (ms) => (ms ? fmtTime(ms) : '');

function openEntry(id, k, entryId = null) {
  const h = findHabit(id);
  if (!h) return;
  const existing = entryId ? entriesOn(h, k).find((e) => e.id === entryId) : null;
  const back = ui.sheet && ui.sheet.type === 'detail' ? { ...ui.sheet } : null;
  ui.sheet = { type: 'entry', id, k, entryId: existing ? existing.id : null, back };
  const e = existing || { values: {}, end: k === ui.today ? Date.now() : undefined };

  const inputs = h.fields.map((f) => {
    const v = e.values[f.id];
    const fid = `ef-${f.id}`;
    if (f.type === 'check') {
      return `<label class="field f-line" for="${fid}"><span>${esc(f.name)}</span>
        <span class="switch"><input type="checkbox" id="${fid}" data-field="${f.id}" ${v === true ? 'checked' : ''}><i></i></span></label>`;
    }
    if (f.type === 'text') {
      const hist = textHistory(h, f);
      return `<div class="field"><label for="${fid}">${esc(f.name)}</label>
        <input id="${fid}" class="in" data-field="${f.id}" maxlength="100" value="${v !== undefined ? esc(v) : ''}" list="dl-${f.id}" autocomplete="off" placeholder="${hist[0] ? `前回: ${esc(hist[0])}` : ''}">
        <datalist id="dl-${f.id}">${hist.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>`;
    }
    const unit = f.type === 'duration' ? '分' : esc(f.unit);
    return `<div class="field f-line"><label for="${fid}">${esc(f.name)}</label>
      <span class="num-wrap"><input id="${fid}" class="in num" data-field="${f.id}" inputmode="decimal" value="${v !== undefined ? fmtNum(v) : ''}"
        ${f.type === 'duration' ? 'placeholder="自動"' : ''}><span class="unit">${unit}</span></span></div>`;
  }).join('');

  $('#sheet-body').innerHTML = `
    <form id="entry-form" novalidate>
      <div class="sheet-head">
        <button type="button" class="link-btn" data-action="entry-cancel">${existing ? '閉じる' : 'キャンセル'}</button>
        <h3>${esc(h.emoji)} ${esc(h.name)}</h3>
        <button type="submit" class="link-btn" style="font-weight:800">保存</button>
      </div>
      <p class="note" style="margin:0 4px 8px">${fmtDate(parseKey(k))} の記録</p>
      <h2>時刻</h2>
      <div class="card group">
        <div class="field f-line"><label for="ef-start">開始</label><input type="time" id="ef-start" class="in time" value="${toTimeVal(e.start)}"></div>
        <div class="field f-line"><label for="ef-end">${e.start || h.useTimer ? '終了' : '実行した時刻'}</label><input type="time" id="ef-end" class="in time" value="${toTimeVal(e.end || e.at)}"></div>
      </div>
      ${h.fields.length ? `<h2>記録する項目</h2><div class="card group">${inputs}</div>` : ''}
      ${existing ? `<div class="actions"><div class="card group"><button type="button" class="row danger-btn" data-action="entry-delete">この記録を削除</button></div></div>` : ''}
    </form>`;
  openSheet();
}

function readEntryForm(h, k) {
  const sv = $('#ef-start').value, ev = $('#ef-end').value;
  let start = sv ? timeOn(k, sv) : undefined;
  let end = ev ? timeOn(k, ev) : undefined;
  if (start && end && end < start) end += 24 * 3600e3; // 日をまたいだ場合
  const values = {};
  for (const f of h.fields) {
    const el = document.querySelector(`[data-field="${CSS.escape(f.id)}"]`);
    if (!el) continue;
    if (f.type === 'check') { if (el.checked) values[f.id] = true; }
    else if (f.type === 'text') { const t = el.value.trim(); if (t) values[f.id] = t.slice(0, 100); }
    else {
      const n = parseFloat(el.value.replace(/[，,]/g, '.').replace(/[^\d.\-]/g, ''));
      if (Number.isFinite(n)) values[f.id] = n;
      else if (f.type === 'duration' && start && end) values[f.id] = Math.round((end - start) / 60000);
    }
  }
  return { start, end, values };
}

function submitEntry() {
  const s = ui.sheet;
  const h = findHabit(s.id);
  if (!h) { closeSheet(); return; }
  const { start, end, values } = readEntryForm(h, s.k);
  const at = end || start;
  if (s.entryId) {
    const e = entriesOn(h, s.k).find((x) => x.id === s.entryId);
    if (e) Object.assign(e, { start, end, at, values });
    save();
    toast('記録を更新しました');
  } else {
    const wasAllDone = allDueDone(s.k);
    addEntry(h, s.k, { id: uid(), start, end, at, values });
    setCount(h, s.k, countOn(h, s.k) + 1);
    save();
    toast(`「${h.name}」を記録しました`);
    if (!wasAllDone && allDueDone(s.k) && s.k === ui.today) celebrate();
  }
  leaveEntry(s);
}

function deleteEntry() {
  const s = ui.sheet;
  const h = findHabit(s.id);
  const e = h && entriesOn(h, s.k).find((x) => x.id === s.entryId);
  if (!e) return;
  removeEntry(h, s.k, e.id);
  setCount(h, s.k, countOn(h, s.k) - 1);
  save();
  leaveEntry(s);
  toast('記録を削除しました', '元に戻す', () => { addEntry(h, s.k, e); setCount(h, s.k, countOn(h, s.k) + 1); save(); render(); });
}

function leaveEntry(s) {
  if (s.back) { ui.sheet = s.back; renderDetail(); }
  else closeSheet();
  render();
}

/* ---------- タイマー（スタート／ストップ） ---------- */
function startTimer(id) {
  const h = findHabit(id);
  if (!h || h.timer) return;
  h.timer = { start: Date.now() };
  save();
  render();
  toast(`「${h.name}」のタイマーをスタートしました`);
}

function stopTimer(id) {
  const h = findHabit(id);
  if (!h || !h.timer) return;
  const start = h.timer.start, end = Date.now();
  const k = keyOf(new Date(start));
  h.timer = null;
  const values = {};
  const dur = h.fields.find((f) => f.type === 'duration');
  if (dur) values[dur.id] = Math.round((end - start) / 60000);
  const entry = { id: uid(), start, end, at: end, values };
  const wasAllDone = allDueDone(k);
  addEntry(h, k, entry);
  setCount(h, k, countOn(h, k) + 1);
  save();
  render();
  if (!wasAllDone && allDueDone(k) && k === ui.today) celebrate();
  if (hasFields(h)) {
    openEntry(h.id, k, entry.id); // 距離や本の名前などを続けて入力
  } else {
    toast(`⏱ ${fmtElapsed(end - start)} を記録しました`, '取り消す', () => {
      removeEntry(h, k, entry.id); setCount(h, k, countOn(h, k) - 1); save(); render();
    });
  }
}

// 計測中の経過時間を毎秒更新
setInterval(() => {
  document.querySelectorAll('[data-timer-start]').forEach((el) => {
    el.textContent = `⏱ ${fmtElapsed(Date.now() - Number(el.dataset.timerStart))}`;
  });
}, 1000);

function openEdit(id, preset) {
  const h = id ? findHabit(id) : null;
  const draft = h
    ? { name: h.name, emoji: h.emoji, color: h.color, days: [...h.days], target: h.target, fields: h.fields.map((f) => ({ ...f })), useTimer: h.useTimer }
    : { name: '', emoji: EMOJIS[0], color: COLORS[0], days: [0, 1, 2, 3, 4, 5, 6], target: 1, fields: [], useTimer: false, ...preset };
  const fromDetail = ui.sheet && ui.sheet.type === 'detail';
  ui.sheet = { type: 'edit', id: h ? h.id : null, draft, fromDetail };

  const emojiChoices = EMOJIS.includes(draft.emoji) ? EMOJIS : [draft.emoji, ...EMOJIS];
  $('#sheet-body').innerHTML = `
    <form id="edit-form" novalidate>
      <div class="sheet-head">
        <button type="button" class="link-btn" data-action="edit-cancel">キャンセル</button>
        <h3>${h ? '習慣を編集' : '新しい習慣'}</h3>
        <button type="submit" class="link-btn" style="font-weight:800">保存</button>
      </div>
      <div class="card group">
        <div class="field">
          <label for="f-name">名前</label>
          <input id="f-name" class="text-input" maxlength="40" placeholder="例: 10分読書する" value="${esc(draft.name)}" autocomplete="off" enterkeyhint="done">
        </div>
      </div>
      <h2>アイコン</h2>
      <div class="card group"><div class="field">
        <div class="emoji-grid" id="f-emoji">
          ${emojiChoices.map((e) => `<button type="button" data-emoji="${esc(e)}" class="${e === draft.emoji ? 'sel' : ''}">${esc(e)}</button>`).join('')}
        </div>
      </div></div>
      <h2>カラー</h2>
      <div class="card group"><div class="field">
        <div class="color-row" id="f-color">
          ${COLORS.map((c) => `<button type="button" data-color="${c}" style="--sw:${c}" class="${c === draft.color ? 'sel' : ''}" aria-label="色 ${c}"></button>`).join('')}
        </div>
      </div></div>
      <h2>くり返し</h2>
      <div class="card group"><div class="field">
        <div class="wd-row" id="f-days">
          ${WD.map((w, i) => `<button type="button" data-day="${i}" class="${draft.days.includes(i) ? 'sel' : ''}" aria-pressed="${draft.days.includes(i)}">${w}</button>`).join('')}
        </div>
        <div class="presets">
          <button type="button" data-preset="0123456">毎日</button>
          <button type="button" data-preset="12345">平日</button>
          <button type="button" data-preset="06">週末</button>
        </div>
      </div></div>
      <h2>1日の目標回数</h2>
      <div class="card group"><div class="field">
        <div class="stepper">
          <button type="button" data-step="-1" aria-label="減らす">−</button>
          <output id="f-target">${draft.target}回</output>
          <button type="button" data-step="1" aria-label="増やす">＋</button>
        </div>
        <p class="note" style="margin:8px 0 0">「水を8杯飲む」のように、1日に複数回行う習慣に使います。</p>
      </div></div>
      <h2>記録する項目</h2>
      <div class="card group">
        <div class="field">
          <span class="label">テンプレートから作る</span>
          <div class="presets" style="margin-top:0;flex-wrap:wrap">
            ${Object.entries(TEMPLATES).map(([key, t]) => `<button type="button" data-tpl="${key}">${t.label}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <div id="f-fields"></div>
          <button type="button" class="link-btn" data-add-field style="padding-left:0">＋ 項目を追加</button>
        </div>
      </div>
      <p class="note">距離・時間・本の名前などを、チェックするたびに入力できます。項目がない場合はワンタップで完了します。</p>
      <h2>スタート／ストップ</h2>
      <div class="card group">
        <label class="field f-line" for="f-timer"><span>タイマーで実行時間を記録する</span>
          <span class="switch"><input type="checkbox" id="f-timer" ${draft.useTimer ? 'checked' : ''}><i></i></span></label>
      </div>
      <p class="note">今日の画面に ▶ ボタンが出ます。スタートとストップの時刻がログに残り、「時間（分）」の項目に自動で入ります。</p>
    </form>`;
  renderFieldsEditor();
  openSheet();
  if (!h) setTimeout(() => $('#f-name')?.focus(), 350);
}

function renderFieldsEditor() {
  const d = ui.sheet.draft;
  $('#f-fields').innerHTML = d.fields.length
    ? d.fields.map((f, i) => `<div class="fe-row" data-index="${i}">
        <input class="in" data-fname="${i}" value="${esc(f.name)}" maxlength="20" placeholder="項目名" aria-label="項目名">
        <select class="in" data-ftype="${i}" aria-label="種類">
          ${Object.entries(FIELD_TYPES).map(([t, label]) => `<option value="${t}" ${t === f.type ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        ${f.type === 'number' ? `<input class="in unit-in" data-funit="${i}" value="${esc(f.unit)}" maxlength="10" placeholder="単位" aria-label="単位">` : '<span></span>'}
        <button type="button" class="fe-del" data-del-field="${i}" aria-label="${esc(f.name)} を削除">×</button>
      </div>`).join('')
    : '<p class="note" style="margin:0 0 6px">まだ項目はありません</p>';
}

function handleEditClick(e) {
  const s = ui.sheet;
  if (!s || s.type !== 'edit') return false;
  const d = s.draft;
  const btn = e.target.closest('button');
  if (!btn) return false;

  if (btn.dataset.emoji) {
    d.emoji = btn.dataset.emoji;
    btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b === btn));
    return true;
  }
  if (btn.dataset.color) {
    d.color = btn.dataset.color;
    btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b === btn));
    return true;
  }
  if (btn.dataset.day !== undefined) {
    const day = Number(btn.dataset.day);
    d.days = d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day].sort();
    syncDays();
    return true;
  }
  if (btn.dataset.preset) {
    d.days = btn.dataset.preset.split('').map(Number);
    syncDays();
    return true;
  }
  if (btn.dataset.step) {
    d.target = Math.min(99, Math.max(1, d.target + Number(btn.dataset.step)));
    $('#f-target').textContent = `${d.target}回`;
    return true;
  }
  if (btn.dataset.tpl) {
    const t = TEMPLATES[btn.dataset.tpl];
    if (d.fields.length && !confirm(`今の項目を「${t.label}」のテンプレートに置き換えますか？`)) return true;
    d.fields = fieldsFromTemplate(btn.dataset.tpl);
    d.useTimer = t.useTimer;
    $('#f-timer').checked = t.useTimer;
    renderFieldsEditor();
    // 新しい習慣で、まだ名前・アイコン・色が初期値ならテンプレートに合わせる
    if (!s.id) {
      if (!$('#f-name').value.trim()) $('#f-name').value = t.name;
      if (d.emoji === EMOJIS[0]) { d.emoji = t.emoji; $('#f-emoji').querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.emoji === t.emoji)); }
      if (d.color === COLORS[0]) { d.color = t.color; $('#f-color').querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.color === t.color)); }
    }
    return true;
  }
  if (btn.dataset.addField !== undefined) {
    if (d.fields.length >= 8) { toast('項目は8個までです'); return true; }
    d.fields.push({ id: uid(), name: '', type: 'number', unit: '' });
    renderFieldsEditor();
    $(`[data-fname="${d.fields.length - 1}"]`)?.focus();
    return true;
  }
  if (btn.dataset.delField !== undefined) {
    d.fields.splice(Number(btn.dataset.delField), 1);
    renderFieldsEditor();
    return true;
  }
  return false;

  function syncDays() {
    $('#f-days').querySelectorAll('button').forEach((b) => {
      const on = d.days.includes(Number(b.dataset.day));
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', on);
    });
  }
}

function submitEdit() {
  const s = ui.sheet;
  const d = s.draft;
  d.name = $('#f-name').value.trim();
  if (!d.name) { toast('名前を入力してください'); $('#f-name').focus(); return; }
  if (!d.days.length) { toast('くり返す曜日を1つ以上選んでください'); return; }
  d.useTimer = $('#f-timer').checked;
  d.fields = normalizeFields(d.fields.map((f) => ({ ...f, name: f.name.trim() || FIELD_TYPES[f.type] })));

  if (s.id) {
    const h = findHabit(s.id);
    Object.assign(h, { name: d.name, emoji: d.emoji, color: d.color, days: d.days, target: d.target, fields: d.fields, useTimer: d.useTimer });
    if (!d.useTimer) h.timer = null;
    save();
    toast('保存しました');
  } else {
    state.habits.push(normalizeHabit({ ...d, id: uid(), createdAt: todayKey(), log: {} }));
    save();
    toast(`「${d.name}」を追加しました`);
  }
  if (s.fromDetail && s.id) { ui.sheet = { type: 'detail', id: s.id, month: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }; render(); }
  else { closeSheet(); render(); }
}

/* ---------- 操作 ---------- */
function tapHabit(id, k = ui.selected) {
  const h = findHabit(id);
  if (!h) return;
  const prev = countOn(h, k);
  const prevEntries = entriesOn(h, k).slice();

  // 未完了 かつ 記録項目がある → 入力シートを開く（保存したら1回分になる）
  if (prev < h.target && hasFields(h)) { openEntry(h.id, k); return; }

  const wasAllDone = allDueDone(k);
  if (prev >= h.target) {
    setCount(h, k, 0);
    delete h.entries[k];
  } else {
    setCount(h, k, prev + 1);
    if (k === ui.today) addEntry(h, k, { id: uid(), at: Date.now(), values: {} }); // 実行した時刻を記録
  }
  save();
  render();
  pop(id);
  const lostDetails = prevEntries.some((e) => e.start || Object.keys(e.values).length);
  if (prev >= h.target && (h.target > 1 || lostDetails)) {
    toast(`「${h.name}」を未完了に戻しました`, '元に戻す', () => {
      setCount(h, k, prev);
      if (prevEntries.length) h.entries[k] = prevEntries;
      save(); render();
    });
  } else if (!wasAllDone && allDueDone(k) && k === ui.today) {
    celebrate();
  }
}

function minusHabit(id, k = ui.selected) {
  const h = findHabit(id);
  if (!h) return;
  const n = countOn(h, k) - 1;
  setCount(h, k, n);
  const list = entriesOn(h, k);
  if (list.length > Math.max(0, n)) removeEntry(h, k, list[list.length - 1].id);
  save();
  render();
}

function allDueDone(k) {
  const { due, done } = dayProgress(parseKey(k));
  return due > 0 && due === done;
}

function pop(id) {
  const el = document.querySelector(`[data-habit="${CSS.escape(id)}"] .check`);
  if (el) { el.classList.add('pop'); }
}

function deleteHabit(id) {
  const h = findHabit(id);
  if (!h) return;
  if (!confirm(`「${h.name}」を削除しますか？\nこれまでの記録も削除されます。`)) return;
  const idx = state.habits.indexOf(h);
  state.habits.splice(idx, 1);
  save();
  closeSheet();
  render();
  toast('削除しました', '元に戻す', () => { state.habits.splice(idx, 0, h); save(); render(); });
}

function quickAdd(i) {
  const s = SUGGESTIONS[i];
  if (!s) return;
  const tpl = TEMPLATES[s.template];
  state.habits.push(normalizeHabit({
    ...s, id: uid(), days: [0, 1, 2, 3, 4, 5, 6], createdAt: todayKey(), log: {},
    fields: s.template ? fieldsFromTemplate(s.template) : [], useTimer: tpl ? tpl.useTimer : false,
  }));
  save();
  render();
  toast(`「${s.name}」を追加しました`);
}

async function exportData() {
  const data = JSON.stringify({ app: 'habit-tracker', version: 1, exportedAt: new Date().toISOString(), habits: state.habits, diary: state.diary }, null, 2);
  const name = `habita-backup-${todayKey()}.json`;
  try {
    const file = new File([data], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'HaBiTa のバックアップ' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('バックアップを書き出しました');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      const habits = (Array.isArray(obj) ? obj : obj.habits || []).map(normalizeHabit).filter(Boolean);
      if (!habits.length && !Object.keys(normalizeDiary(obj.diary)).length) throw new Error('empty');
      if (!confirm(`${habits.length}件の習慣と日記を復元します。\n現在のデータは置き換えられます。よろしいですか？`)) return;
      state = { version: 1, habits, diary: normalizeDiary(obj.diary) };
      save();
      render();
      toast('復元しました');
    } catch (e) {
      toast('ファイルを読み込めませんでした');
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm('すべての習慣と記録を削除します。\nこの操作は取り消せません。よろしいですか？')) return;
  state = { version: 1, habits: [], diary: {} };
  save();
  render();
  toast('すべてのデータを削除しました');
}

/* ---------- トースト・演出 ---------- */
let toastTimer;
function toast(text, actionLabel, onAction) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  if (actionLabel) el.querySelector('button').onclick = () => { el.hidden = true; onAction(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 4500 : 2200);
}

function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = state.habits.map((h) => h.color).concat(COLORS);
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--x', (Math.random() * 40 - 20) + 'vw');
    p.style.setProperty('--r', (Math.random() * 900 - 450) + 'deg');
    p.style.setProperty('--d', (1.2 + Math.random() * 1.2) + 's');
    p.style.animationDelay = Math.random() * 0.25 + 's';
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3000);
}

/* ---------- イベント ---------- */
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-sheet]')) { closeSheet(); return; }
  if (e.target.closest('#sheet-body') && handleEditClick(e)) return;

  const tab = e.target.closest('.tab');
  if (tab) {
    ui.tab = tab.dataset.tab;
    render();
    window.scrollTo(0, 0);
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  switch (action) {
    case 'add': openEdit(null); break;
    case 'quick-add': quickAdd(Number(el.dataset.index)); break;
    case 'toggle': tapHabit(id, el.dataset.key); break;
    case 'minus': minusHabit(id, el.dataset.key); break;
    case 'mood': setMood(el.dataset.key, Number(el.dataset.mood)); break;
    case 'mcal-prev':
    case 'mcal-next': {
      const m = ui.calMonth;
      ui.calMonth = new Date(m.getFullYear(), m.getMonth() + (action === 'mcal-prev' ? -1 : 1), 1);
      render();
      break;
    }
    case 'mcal-today': {
      const t = startOfToday();
      ui.calMonth = new Date(t.getFullYear(), t.getMonth(), 1);
      ui.calSel = ui.today;
      render();
      break;
    }
    case 'mcal-day':
      ui.calSel = el.dataset.key;
      render();
      $('.day-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); // 選んだ日の日記・記録を見せる
      break;
    case 'detail': openDetail(id); break;
    case 'select-day': ui.selected = el.dataset.key; render(); break;
    case 'go-today': ui.selected = ui.today; render(); break;
    case 'cal-prev':
    case 'cal-next': {
      const m = ui.sheet.month;
      ui.sheet.month = new Date(m.getFullYear(), m.getMonth() + (action === 'cal-prev' ? -1 : 1), 1);
      renderDetail();
      break;
    }
    case 'cal-day': {
      tapHabit(ui.sheet.id, el.dataset.key);
      break;
    }
    case 'timer-start': startTimer(id); break;
    case 'timer-stop': stopTimer(id); break;
    case 'entry-open': openEntry(id, el.dataset.key, el.dataset.entry); break;
    case 'entry-new': openEntry(id, ui.today); break;
    case 'entry-cancel': leaveEntry(ui.sheet); break;
    case 'entry-delete': deleteEntry(); break;
    case 'log-more': ui.sheet.logLimit = (ui.sheet.logLimit || 15) + 30; renderDetail(); break;
    case 'edit': openEdit(id); break;
    case 'edit-cancel':
      if (ui.sheet.fromDetail && ui.sheet.id) openDetail(ui.sheet.id); else closeSheet();
      break;
    case 'delete': deleteHabit(id); break;
    case 'export': exportData(); break;
    case 'import': $('#import-file').click(); break;
    case 'reset': resetAll(); break;
    case 'dismiss-install':
      try { localStorage.setItem(INSTALL_DISMISSED_KEY, '1'); } catch (_) { /* noop */ }
      render();
      break;
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'edit-form') { e.preventDefault(); submitEdit(); }
  if (e.target.id === 'entry-form') { e.preventDefault(); submitEntry(); }
});

// 記録項目エディタの入力を下書きに反映
document.addEventListener('input', (e) => {
  if (e.target.classList.contains('diary-note')) { setNote(e.target.dataset.key, e.target.value); return; }
  const d = ui.sheet && ui.sheet.type === 'edit' ? ui.sheet.draft : null;
  if (!d) return;
  const t = e.target;
  if (t.dataset.fname !== undefined) d.fields[Number(t.dataset.fname)].name = t.value;
  if (t.dataset.funit !== undefined) d.fields[Number(t.dataset.funit)].unit = t.value;
});

document.addEventListener('change', (e) => {
  if (e.target.classList.contains('diary-note')) { clearTimeout(noteTimer); save(); return; }
  if (e.target.id === 'import-file' && e.target.files[0]) {
    importData(e.target.files[0]);
    e.target.value = '';
  }
  const d = ui.sheet && ui.sheet.type === 'edit' ? ui.sheet.draft : null;
  if (d && e.target.dataset.ftype !== undefined) {
    const f = d.fields[Number(e.target.dataset.ftype)];
    f.type = e.target.value;
    if (f.type !== 'number') f.unit = '';
    renderFieldsEditor();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

// シートを下にスワイプして閉じる
(() => {
  const sheet = $('.sheet');
  let y0 = null, dy = 0;
  sheet.addEventListener('touchstart', (e) => {
    if (sheet.scrollTop > 0 || e.target.closest('input, select, textarea, label')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = dy ? `translateY(${dy}px)` : '';
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (y0 === null) return;
    sheet.style.transform = '';
    if (dy > 110) closeSheet();
    y0 = null;
  });
})();

// 日付が変わったら「今日」を更新（アプリを開きっぱなしにした場合など）
function checkDayChange() {
  const k = todayKey();
  if (k === ui.today) return;
  if (ui.selected === ui.today) ui.selected = k;
  if (ui.calSel === ui.today) ui.calSel = k;
  ui.today = k;
  render();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayChange(); });
setInterval(checkDayChange, 60 * 1000);

/* ---------- 起動 ---------- */
render();

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
