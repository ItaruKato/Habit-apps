'use strict';

/* =========================================================
 * HaBiTa — iPhone 向け習慣トラッカー PWA
 * データはすべて端末内 (localStorage) に保存されます。
 * ========================================================= */

const STORAGE_KEY = 'habit-tracker:v1';
const INSTALL_DISMISSED_KEY = 'habit-tracker:install-dismissed';
const APP_VERSION = '1.1.0';

const COLORS = ['#34c759', '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#ff3b30', '#ff9500', '#ffcc00', '#a2845e'];
const EMOJIS = ['💧', '🏃', '🚶', '📚', '🧘', '💪', '🛏️', '🌅', '🥗', '🍎', '✍️', '🧠', '🎸', '🎨', '🧹', '💊', '🦷', '📵', '💰', '🌱', '☕', '🚭', '🙏', '🎯'];
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const SUGGESTIONS = [
  { name: '水を飲む', emoji: '💧', color: '#30b0c7', target: 8 },
  { name: '読書', emoji: '📚', color: '#ff9500', target: 1 },
  { name: '散歩', emoji: '🚶', color: '#34c759', target: 1 },
  { name: '瞑想', emoji: '🧘', color: '#5856d6', target: 1 },
  { name: '筋トレ', emoji: '💪', color: '#ff3b30', target: 1 },
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
  sheet: null,          // { type: 'detail' | 'edit', id, month, draft }
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.habits)) return { version: 1, habits: s.habits.map(normalizeHabit).filter(Boolean) };
    }
  } catch (e) { /* 破損データは無視 */ }
  return { version: 1, habits: [] };
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
  };
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

function habitItem(h, k) {
  const n = countOn(h, k);
  const done = n >= h.target;
  const p = Math.min(1, n / h.target);
  const streak = currentStreak(h);
  const meta = [
    `<span>${freqLabel(h.days)}</span>`,
    h.target > 1 ? `<span>目標 ${h.target}回</span>` : '',
    streak > 0 ? `<span class="streak-hot">🔥 ${streak}日連続</span>` : '',
  ].join('');
  const checkInner = h.target > 1 && !done ? `${n}/${h.target}` : CHECK_SVG;
  return `<li class="habit card ${done ? 'done' : ''}" style="--c:${h.color};--p:${p}" data-habit="${h.id}">
    <div class="fill"></div>
    <button class="habit-main" data-action="detail" data-id="${h.id}" aria-label="${esc(h.name)} の詳細">
      <span class="emoji">${esc(h.emoji)}</span>
      <span class="habit-text">
        <div class="habit-name">${esc(h.name)}</div>
        <div class="habit-meta">${meta}</div>
      </span>
    </button>
    ${h.target > 1 && n > 0 ? `<button class="minus" data-action="minus" data-id="${h.id}" aria-label="1回減らす">−</button>` : ''}
    <button class="check" data-action="toggle" data-id="${h.id}"
      aria-label="${esc(h.name)} を${done ? '未完了に戻す' : h.target > 1 ? '1回記録' : '完了にする'}" aria-pressed="${done}">${checkInner}</button>
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
    <div class="actions">
      <div class="card group"><button class="row danger-btn" data-action="delete" data-id="${h.id}">この習慣を削除</button></div>
    </div>`;
}

function openEdit(id, preset) {
  const h = id ? findHabit(id) : null;
  const draft = h
    ? { name: h.name, emoji: h.emoji, color: h.color, days: [...h.days], target: h.target }
    : { name: '', emoji: EMOJIS[0], color: COLORS[0], days: [0, 1, 2, 3, 4, 5, 6], target: 1, ...preset };
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
    </form>`;
  openSheet();
  if (!h) setTimeout(() => $('#f-name')?.focus(), 350);
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

  if (s.id) {
    const h = findHabit(s.id);
    Object.assign(h, { name: d.name, emoji: d.emoji, color: d.color, days: d.days, target: d.target });
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
  const wasAllDone = allDueDone(k);
  setCount(h, k, prev >= h.target ? 0 : prev + 1);
  save();
  render();
  pop(id);
  if (prev >= h.target && h.target > 1) {
    toast(`「${h.name}」をリセットしました`, '元に戻す', () => { setCount(h, k, prev); save(); render(); });
  } else if (!wasAllDone && allDueDone(k) && k === ui.today) {
    celebrate();
  }
}

function minusHabit(id) {
  const h = findHabit(id);
  if (!h) return;
  setCount(h, ui.selected, countOn(h, ui.selected) - 1);
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
  state.habits.push(normalizeHabit({ ...s, id: uid(), days: [0, 1, 2, 3, 4, 5, 6], createdAt: todayKey(), log: {} }));
  save();
  render();
  toast(`「${s.name}」を追加しました`);
}

async function exportData() {
  const data = JSON.stringify({ app: 'habit-tracker', version: 1, exportedAt: new Date().toISOString(), habits: state.habits }, null, 2);
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
      if (!habits.length) throw new Error('empty');
      if (!confirm(`${habits.length}件の習慣を復元します。\n現在のデータは置き換えられます。よろしいですか？`)) return;
      state = { version: 1, habits };
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
  state = { version: 1, habits: [] };
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
    case 'toggle': tapHabit(id); break;
    case 'minus': minusHabit(id); break;
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
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'import-file' && e.target.files[0]) {
    importData(e.target.files[0]);
    e.target.value = '';
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
    if (sheet.scrollTop > 0 || e.target.closest('input')) { y0 = null; return; }
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
