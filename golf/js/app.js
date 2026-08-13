// 画面制御。集計は stats.js / 助言は advice.js に分離している（要件17）。

import {
  addDays,
  daysInMonth,
  diffDays,
  formatLong,
  formatShort,
  parseISO,
  toISO,
  todayJST,
  weekday,
  WEEKDAY_LABELS,
} from './date.js';
import { MENU_STEPS, STATUS_LABELS, STATUS_MARKS, STRENGTH_NOTE, SUNDAY_DRILL, isRestWeekday, menuForWeekday } from './menu.js';
import {
  girSeries,
  movingAverage,
  practiceStats,
  rangeSessionStats,
  recentPracticeRate,
  roundStats,
  scoreSeries,
  sortByDateAsc,
  sortByDateDesc,
} from './stats.js';
import { buildAdvice, weeklyFocus } from './advice.js';
import { lineChart, scatterChart } from './chart.js';
import {
  allRounds,
  canPersist,
  dailyList,
  defaultState,
  exportJSON,
  importJSON,
  loadState,
  newId,
  rangeList,
  saveState,
} from './store.js';
import { CLUBS } from './seed.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let state = loadState();
let today = todayJST();
let calCursor = (() => {
  const { y, m } = parseISO(today);
  return { y, m };
})();
let practiceDate = today;
let sheetDate = null;
let expandedRound = null;

const VIEWS = ['home', 'calendar', 'practice', 'score', 'analysis'];

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, String(v));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

let toastTimer = null;
function toast(message, warn = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('warn', warn);
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 1900);
}

/** 保存して結果を通知する（要件12：明確な保存完了表示） */
function persist(message = '保存しました') {
  const result = saveState(state);
  if (result.ok) toast(message);
  else toast(result.error || '保存できませんでした', true);
  return result.ok;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(value, unit = '', digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const text = typeof value === 'number' ? String(Number(value.toFixed(digits))) : String(value);
  return `${text}${unit}`;
}

function ensureDaily(date) {
  if (!state.daily[date]) {
    state.daily[date] = {
      id: newId('d'),
      date,
      menuType: menuForWeekday(weekday(date)).type,
      status: null,
      minutes: menuForWeekday(weekday(date)).minutes,
      steps: [],
      memo: '',
    };
  }
  return state.daily[date];
}

// ---------------------------------------------------------------------------
// ルーティング
// ---------------------------------------------------------------------------

function currentView() {
  const hash = location.hash.replace('#', '');
  return VIEWS.includes(hash) ? hash : 'home';
}

function showView(name) {
  for (const view of VIEWS) {
    $(`#view-${view}`).hidden = view !== name;
  }
  $$('.tab').forEach((tab) => {
    if (tab.dataset.view === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  renderView(name);
}

function renderView(name) {
  if (name === 'home') renderHome();
  else if (name === 'calendar') renderCalendar();
  else if (name === 'practice') renderPractice();
  else if (name === 'score') renderScore();
  else if (name === 'analysis') renderAnalysis();
}

function renderAll() {
  renderView(currentView());
}

// ---------------------------------------------------------------------------
// ホーム
// ---------------------------------------------------------------------------

function renderHome() {
  const stats = practiceStats({ startDate: state.settings.startDate, records: dailyList(state), today });
  const started = diffDays(today, state.settings.startDate) >= 0;

  $('#home-day').textContent = started ? String(stats.projectDay).padStart(3, '0') : '—';
  $('#home-start').textContent = started
    ? `開始日 ${formatLong(state.settings.startDate)}／目標 ${state.settings.targetScore}`
    : `開始予定日 ${formatLong(state.settings.startDate)}`;
  $('#home-done').textContent = stats.doneDays;
  $('#home-missed').textContent = stats.missedDays;
  $('#home-rate').textContent = stats.achievementRate === null ? '—' : `${stats.achievementRate}%`;

  const w = weekday(today);
  const menu = menuForWeekday(w);
  $('#home-weekday').textContent = WEEKDAY_LABELS[w];
  $('#home-today-label').textContent = `今日のメニュー（${formatShort(today)}）`;
  $('#home-menu-title').textContent = menu.title;
  $('#home-menu-meta').textContent = `${menu.minutesLabel}／${menu.purpose}`;
  $('#home-menu-note').textContent = menu.type === 'strength' ? STRENGTH_NOTE : isRestWeekday(w) ? '今日は完全休養日です。達成率の分母には入りません。' : '';

  renderSteps(menu.type);
  renderStatusButtons();

  const record = state.daily[today];
  $('#home-fatigue').value = record?.fatigue ? String(record.fatigue) : '';
  $('#home-pain').value = record?.pain || 'none';
  $('#home-memo').value = record?.memo || '';

  renderHomeAdvice();
  renderLastRound();
}

function renderSteps(menuType) {
  const list = $('#home-steps');
  clear(list);
  const steps = MENU_STEPS[menuType] || [];
  const record = state.daily[today];
  const checked = record?.steps || [];

  steps.forEach((label, index) => {
    const isChecked = !!checked[index];
    const input = el('input', { type: 'checkbox', ...(isChecked ? { checked: 'checked' } : {}) });
    const row = el('label', { class: `step${isChecked ? ' checked' : ''}` }, [input, el('span', { text: label })]);
    input.addEventListener('change', () => {
      const rec = ensureDaily(today);
      rec.steps = rec.steps || [];
      rec.steps[index] = input.checked;
      const allDone = steps.every((_, i) => rec.steps[i]);
      if (allDone && rec.status !== 'done') {
        rec.status = 'done';
        rec.menuType = menuType;
        persist('すべて実施：完了として記録しました');
      } else if (!allDone && rec.steps.some(Boolean) && !rec.status) {
        rec.status = 'partial';
        persist('一部だけ実施として記録しました');
      } else {
        persist();
      }
      renderHome();
    });
    list.appendChild(el('li', {}, [row]));
  });
}

function renderStatusButtons() {
  const wrap = $('#home-status');
  clear(wrap);
  const record = state.daily[today];
  for (const status of ['done', 'partial', 'rest', 'missed']) {
    const active = record?.status === status;
    wrap.appendChild(
      el(
        'button',
        {
          class: 'status-btn',
          'data-status': status,
          'aria-pressed': active ? 'true' : 'false',
          onclick: () => setStatus(today, status),
        },
        [el('span', { class: 'mark', text: STATUS_MARKS[status] }), el('span', { text: STATUS_LABELS[status] })]
      )
    );
  }
}

function setStatus(date, status) {
  const rec = ensureDaily(date);
  rec.status = status;
  rec.menuType = menuForWeekday(weekday(date)).type;
  persist(`${formatShort(date)} を「${STATUS_LABELS[status]}」で記録しました`);
  renderAll();
  if (sheetDate) renderSheet();
}

function adviceInput() {
  const rounds = allRounds(state);
  const stats = roundStats(rounds);
  const latestRound = sortByDateAsc(rounds).at(-1) || null;
  const practiceRate = recentPracticeRate({
    startDate: state.settings.startDate,
    records: dailyList(state),
    today,
    days: 28,
  });
  return { stats, latestRound, practiceRate, rangeStats: rangeSessionStats(rangeList(state)) };
}

function adviceNode(message) {
  return el('div', { class: `advice ${message.tone}` }, [
    el('h3', { text: message.title }),
    el('p', { text: message.body }),
  ]);
}

function renderHomeAdvice() {
  const wrap = $('#home-advice');
  clear(wrap);
  wrap.appendChild(adviceNode(weeklyFocus(adviceInput())));
}

function renderLastRound() {
  const wrap = $('#home-last-round');
  clear(wrap);
  const last = sortByDateAsc(allRounds(state)).at(-1);
  if (!last) {
    wrap.appendChild(el('p', { class: 'empty', text: 'まだラウンド記録がありません' }));
    return;
  }
  wrap.appendChild(scoreCard(last, { compact: true }));
}

// ---------------------------------------------------------------------------
// 記録（カレンダー）
// ---------------------------------------------------------------------------

function statusForDate(date) {
  const record = state.daily[date];
  if (record?.status) return record.status;
  if (diffDays(date, state.settings.startDate) < 0) return null; // 開始前
  if (diffDays(date, today) > 0) return null; // 未来日は記録扱いしない
  if (isRestWeekday(weekday(date))) return 'rest';
  if (diffDays(today, date) > 0) return 'missed'; // 過去日の未記録は未実施
  return null;
}

function renderCalendar() {
  const { y, m } = calCursor;
  $('#cal-month').textContent = `${y}年${m}月`;
  const grid = $('#cal-grid');
  clear(grid);

  WEEKDAY_LABELS.forEach((label, i) => {
    grid.appendChild(
      el('div', { class: `cal-head${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`, text: label })
    );
  });

  const firstWeekday = weekday(toISO(y, m, 1));
  for (let i = 0; i < firstWeekday; i++) grid.appendChild(el('div', { class: 'cal-cell empty' }));

  const total = daysInMonth(y, m);
  for (let d = 1; d <= total; d++) {
    const date = toISO(y, m, d);
    const isFuture = diffDays(date, today) > 0;
    const beforeStart = diffDays(date, state.settings.startDate) < 0;
    const status = statusForDate(date);
    const classes = ['cal-cell'];
    if (status) classes.push(`s-${status}`);
    if (date === today) classes.push('today');
    if (beforeStart || isFuture) classes.push('outside');

    grid.appendChild(
      el(
        'button',
        {
          class: classes.join(' '),
          disabled: isFuture || beforeStart ? 'disabled' : false,
          'aria-label': `${formatLong(date)} ${status ? STATUS_LABELS[status] : '記録なし'}`,
          onclick: () => openSheet(date),
        },
        [
          el('span', { class: 'd', text: String(d) }),
          el('span', { class: 'm', text: status ? STATUS_MARKS[status] : '' }),
        ]
      )
    );
  }

  const monthStats = practiceStats({
    startDate: state.settings.startDate,
    records: dailyList(state),
    today,
    from: toISO(y, m, 1),
    to: toISO(y, m, total),
  });
  $('#cal-done').textContent = monthStats.doneDays;
  $('#cal-missed').textContent = monthStats.missedDays;
  $('#cal-rate').textContent = monthStats.achievementRate === null ? '—' : `${monthStats.achievementRate}%`;

  $('#set-start').value = state.settings.startDate;
  $('#set-target').value = state.settings.targetScore;
  $('#set-first').value = state.settings.firstStageAverage;
}

function openSheet(date) {
  sheetDate = date;
  renderSheet();
  $('#sheet').classList.add('show');
  $('#sheet-backdrop').classList.add('show');
}

function closeSheet() {
  sheetDate = null;
  $('#sheet').classList.remove('show');
  $('#sheet-backdrop').classList.remove('show');
}

function renderSheet() {
  if (!sheetDate) return;
  const menu = menuForWeekday(weekday(sheetDate));
  $('#sheet-title').textContent = `${formatLong(sheetDate)}／${menu.title}`;
  const wrap = $('#sheet-status');
  clear(wrap);
  const record = state.daily[sheetDate];
  for (const status of ['done', 'partial', 'rest', 'missed']) {
    const active = record?.status === status;
    wrap.appendChild(
      el(
        'button',
        {
          class: 'status-btn',
          'data-status': status,
          'aria-pressed': active ? 'true' : 'false',
          onclick: () => setStatus(sheetDate, status),
        },
        [el('span', { class: 'mark', text: STATUS_MARKS[status] }), el('span', { text: STATUS_LABELS[status] })]
      )
    );
  }
  $('#sheet-memo').value = record?.memo || '';
}

// ---------------------------------------------------------------------------
// 練習
// ---------------------------------------------------------------------------

const SEVEN_FIELDS = [
  { key: 'sevenIronGood', label: '合格（方向・高さOK）' },
  { key: 'sevenIronLeft', label: '左ミス' },
  { key: 'sevenIronRight', label: '右ミス' },
  { key: 'sevenIronShort', label: '距離不足' },
];

const DRIVER_FIELDS = [
  { key: 'driverPlayable', label: '次打可能' },
  { key: 'driverLeftMiss', label: '左大ミス' },
  { key: 'driverRightMiss', label: '右大ミス' },
];

const GREEN_FIELDS = [
  { key: 'virtualGreenSuccess', label: '成功（センター／安全側）' },
  { key: 'shortSideMiss', label: 'ショートサイド' },
  { key: 'carryShort', label: 'キャリー不足' },
  { key: 'decisionMiss', label: '判断ミス' },
  { key: 'executionMiss', label: '実行ミス' },
];

function emptySession(date) {
  const base = { id: newId('r'), date, swingCue: '' };
  for (const f of [...SEVEN_FIELDS, ...DRIVER_FIELDS, ...GREEN_FIELDS]) base[f.key] = 0;
  return base;
}

function currentSession() {
  return state.range[practiceDate] ? { ...emptySession(practiceDate), ...state.range[practiceDate] } : emptySession(practiceDate);
}

let sessionDraft = null;

function renderPractice() {
  $('#rng-date').value = practiceDate;
  $('#rng-date').max = today;
  if (!sessionDraft || sessionDraft.date !== practiceDate) sessionDraft = currentSession();

  const menu = menuForWeekday(weekday(practiceDate));
  $('#rng-menu-note').textContent = `${formatShort(practiceDate)} は「${menu.title}」の日です。${
    menu.type === 'range' ? '80球メニューの結果を記録します。' : '打ちっぱなしを行った日だけ記録すれば十分です。'
  }`;

  renderCounters($('#rng-seven'), SEVEN_FIELDS);
  renderCounters($('#rng-driver'), DRIVER_FIELDS);
  renderCounters($('#rng-green'), GREEN_FIELDS);
  $('#rng-cue').value = sessionDraft.swingCue || '';
  $('#rng-saved-note').textContent = state.range[practiceDate] ? 'この日の記録は保存済みです（上書きできます）' : '';

  renderSundayDrill();
  renderCarryTable();
  renderRangeSummary();
}

function renderCounters(wrap, fields) {
  clear(wrap);
  for (const field of fields) {
    const value = el('span', { class: 'counter-value', text: String(sessionDraft[field.key] ?? 0) });
    const update = (delta) => {
      const next = Math.max(0, num(sessionDraft[field.key]) + delta);
      sessionDraft[field.key] = next;
      value.textContent = String(next);
    };
    wrap.appendChild(
      el('div', { class: 'counter' }, [
        el('span', { class: 'counter-label', text: field.label }),
        el('span', { class: 'counter-controls' }, [
          el('button', { type: 'button', 'aria-label': `${field.label}を1減らす`, onclick: () => update(-1), text: '−' }),
          value,
          el('button', { type: 'button', 'aria-label': `${field.label}を1増やす`, onclick: () => update(1), text: '＋' }),
        ]),
      ])
    );
  }
}

function renderSundayDrill() {
  const list = $('#sunday-drill');
  clear(list);
  for (const drill of SUNDAY_DRILL) {
    list.appendChild(
      el('li', {}, [
        el('div', { class: 'step' }, [
          el('span', { text: `${drill.order}. ${drill.title}` }),
          el('span', { class: 'chip', text: `${drill.balls}球`, style: 'margin-left:auto' }),
        ]),
      ])
    );
  }
}

function renderCarryTable() {
  const wrap = $('#carry-table');
  clear(wrap);
  for (const club of CLUBS) {
    const entry = state.carry[club] || { club, normalCarry: '', safeCarry: '' };
    const normal = el('input', {
      type: 'number',
      inputmode: 'numeric',
      min: '0',
      max: '350',
      value: entry.normalCarry ?? '',
      'aria-label': `${club}の基準キャリー`,
    });
    const safe = el('input', {
      type: 'number',
      inputmode: 'numeric',
      min: '0',
      max: '350',
      value: entry.safeCarry ?? '',
      'aria-label': `${club}の安全キャリー`,
    });
    normal.dataset.club = club;
    normal.dataset.kind = 'normalCarry';
    safe.dataset.club = club;
    safe.dataset.kind = 'safeCarry';
    wrap.appendChild(
      el('div', { class: 'carry-row' }, [el('span', { class: 'carry-club', text: club }), normal, safe])
    );
  }
}

function renderRangeSummary() {
  const wrap = $('#range-summary');
  clear(wrap);
  const stats = rangeSessionStats(rangeList(state));
  if (!stats.count) {
    wrap.appendChild(el('p', { class: 'empty', text: 'まだ練習記録がありません。日曜の80球から始めます。' }));
    return;
  }
  const grid = el('div', { class: 'kpi-grid' }, [
    kpi('7I 合格率', fmt(stats.sevenIronGoodRate, '%')),
    kpi('ドライバー次打可能率', fmt(stats.driverPlayableRate, '%')),
    kpi('仮想グリーン成功率', fmt(stats.virtualGreenRate, '%')),
    kpi('キャリー不足', `${stats.carryShortTotal}回`),
    kpi('ショートサイド', `${stats.shortSideTotal}回`),
    kpi('判断ミス', `${stats.decisionMissTotal}回`),
  ]);
  wrap.appendChild(grid);
  if (stats.latest?.swingCue) {
    wrap.appendChild(el('p', { class: 'section-note', text: `直近の合図：${stats.latest.swingCue}` }));
  }
}

function saveSession() {
  sessionDraft.swingCue = $('#rng-cue').value.trim();
  sessionDraft.date = practiceDate;
  state.range[practiceDate] = { ...sessionDraft };
  persist(`${formatShort(practiceDate)} の練習を保存しました`);
  renderPractice();
}

function saveCarry() {
  for (const input of $$('#carry-table input')) {
    const club = input.dataset.club;
    const kind = input.dataset.kind;
    if (!state.carry[club]) state.carry[club] = { club };
    const raw = input.value.trim();
    state.carry[club][kind] = raw === '' ? null : num(raw, null);
    state.carry[club].measuredAt = today;
  }
  persist('キャリーを保存しました');
}

// ---------------------------------------------------------------------------
// スコア
// ---------------------------------------------------------------------------

const SCORE_FIELDS = {
  date: '#sc-date',
  course: '#sc-course',
  tee: '#sc-tee',
  outScore: '#sc-out',
  inScore: '#sc-in',
  totalScore: '#sc-total',
  putts: '#sc-putts',
  greensInRegulation: '#sc-gir',
  bogeyOn: '#sc-bogey',
  penalties: '#sc-pen',
  threePutts: '#sc-3putt',
  threePuttsAfterGIR: '#sc-3putt-gir',
  shortSideMisses: '#sc-shortside',
  carryShorts: '#sc-carryshort',
  strategyErrors: '#sc-strategy',
  tripleOrWorse: '#sc-triple',
  bestFeeling: '#sc-feel',
  nextFocus: '#sc-next',
};

function renderScore() {
  const rounds = sortByDateDesc(allRounds(state));
  $('#score-count').textContent = `${rounds.length}件`;

  const datalist = $('#course-list');
  clear(datalist);
  for (const course of [...new Set(rounds.map((r) => r.course))]) {
    datalist.appendChild(el('option', { value: course }));
  }

  if (!$('#sc-date').value) $('#sc-date').value = today;
  $('#sc-date').max = today;

  const wrap = $('#score-list');
  clear(wrap);
  if (!rounds.length) {
    wrap.appendChild(el('p', { class: 'empty', text: 'ラウンド記録がありません' }));
    return;
  }
  const best = Math.min(...rounds.map((r) => r.totalScore));
  for (const round of rounds) {
    wrap.appendChild(scoreCard(round, { best }));
  }
}

function scoreCard(round, { best = null, compact = false } = {}) {
  const girPct = Math.round((round.greensInRegulation / 18) * 1000) / 10;
  const chips = [
    chip('OUT', round.outScore ?? '—'),
    chip('IN', round.inScore ?? '—'),
    chip('パット', round.putts),
    chip('パーオン', `${round.greensInRegulation}/18 (${girPct}%)`),
  ];
  if (!compact) {
    chips.push(chip('ボギーオン以内', `${round.bogeyOn}/18`));
    if (round.source === 'seed') chips.push(el('span', { class: 'chip seed', text: '初期データ' }));
  }

  const card = el('div', { class: 'score-card' }, [
    el('div', { class: 'score-top' }, [
      el('div', {}, [
        el('p', { class: 'score-course', text: round.course }),
        el('p', { class: 'score-date', text: `${formatLong(round.date)}／${round.tee || '—'}` }),
      ]),
      el('span', {
        class: `score-total${best !== null && round.totalScore === best ? ' best' : ''}`,
        text: String(round.totalScore),
      }),
    ]),
    el('div', { class: 'score-chips' }, chips),
  ]);

  if (compact) return card;

  const detailWrap = el('div');
  card.appendChild(detailWrap);

  const toggle = el('button', {
    class: 'btn-ghost btn-small',
    style: 'margin-top:10px;width:100%',
    text: expandedRound === round.id ? '閉じる' : '詳細を見る',
    onclick: () => {
      expandedRound = expandedRound === round.id ? null : round.id;
      renderScore();
    },
  });
  card.appendChild(toggle);

  if (expandedRound === round.id) {
    const detail = el('div', { class: 'score-detail' }, [
      kv('3パット', `${round.threePutts}回`),
      kv('パーオン後の3パット', `${round.threePuttsAfterGIR}回`),
      kv('OB・1ペナ', `${round.penalties}回`),
      kv('ショートサイド', `${round.shortSideMisses}回`),
      kv('キャリー不足', `${round.carryShorts}回`),
      kv('判断ミス', `${round.strategyErrors}回`),
      kv('トリプル以上', `${round.tripleOrWorse}ホール`),
    ]);
    if (round.bestFeeling) detail.appendChild(kv('良かった感覚', round.bestFeeling));
    if (round.nextFocus) detail.appendChild(kv('次回の課題', round.nextFocus));
    detail.appendChild(
      el('div', { class: 'btn-row', style: 'margin-top:10px' }, [
        el('button', { class: 'btn-small', text: '編集', onclick: () => editRound(round) }),
        el('button', { class: 'btn-danger btn-small', text: '削除', onclick: () => deleteRound(round) }),
      ])
    );
    detailWrap.appendChild(detail);
  }

  return card;
}

function chip(label, value) {
  return el('span', { class: 'chip' }, [document.createTextNode(`${label} `), el('b', { text: String(value) })]);
}

function kv(label, value) {
  return el('div', { class: 'kv' }, [el('span', { text: label }), el('span', { text: String(value) })]);
}

function editRound(round) {
  for (const [key, sel] of Object.entries(SCORE_FIELDS)) {
    const node = $(sel);
    const value = round[key];
    node.value = value === null || value === undefined ? '' : value;
  }
  $('#sc-id').value = round.id;
  $('#score-form-group').open = true;
  $('#score-form-summary').textContent = 'ラウンドを編集する';
  $('#score-form-group').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearScoreForm() {
  for (const sel of Object.values(SCORE_FIELDS)) $(sel).value = '';
  $('#sc-id').value = '';
  $('#sc-date').value = today;
  $('#sc-tee').value = 'レギュラー';
  $('#score-form-summary').textContent = '＋ 新しいラウンドを登録する';
}

function deleteRound(round) {
  if (!window.confirm(`${formatShort(round.date)} ${round.course} の記録を削除します。よろしいですか？`)) return;
  if (round.source === 'seed') {
    state.hiddenSeedIds = [...new Set([...(state.hiddenSeedIds || []), round.id])];
  } else {
    state.rounds = state.rounds.filter((r) => r.id !== round.id);
  }
  expandedRound = null;
  persist('削除しました');
  renderScore();
}

function saveRound() {
  const date = $('#sc-date').value;
  const course = $('#sc-course').value.trim();
  const out = $('#sc-out').value === '' ? null : num($('#sc-out').value);
  const inn = $('#sc-in').value === '' ? null : num($('#sc-in').value);
  let total = $('#sc-total').value === '' ? null : num($('#sc-total').value);
  if (total === null && out !== null && inn !== null) total = out + inn;

  if (!date) return toast('日付を入力してください', true);
  if (diffDays(date, today) > 0) return toast('未来の日付は登録できません', true);
  if (!course) return toast('ゴルフ場を入力してください', true);
  if (!total) return toast('合計スコアを入力してください', true);

  const gir = clamp(num($('#sc-gir').value), 0, 18);
  const bogey = clamp(num($('#sc-bogey').value), 0, 18);

  const record = {
    id: $('#sc-id').value || newId('round'),
    date,
    course,
    tee: $('#sc-tee').value,
    outScore: out,
    inScore: inn,
    totalScore: total,
    putts: num($('#sc-putts').value),
    greensInRegulation: gir,
    bogeyOn: Math.max(bogey, gir),
    penalties: num($('#sc-pen').value),
    threePutts: num($('#sc-3putt').value),
    threePuttsAfterGIR: Math.min(num($('#sc-3putt-gir').value), gir),
    shortSideMisses: num($('#sc-shortside').value),
    carryShorts: num($('#sc-carryshort').value),
    strategyErrors: num($('#sc-strategy').value),
    tripleOrWorse: num($('#sc-triple').value),
    bestFeeling: $('#sc-feel').value.trim(),
    nextFocus: $('#sc-next').value.trim(),
    source: 'user',
  };

  const editingSeed = record.id.startsWith('seed-');
  if (editingSeed) {
    // 初期データを編集した場合は、元データを隠してユーザーデータとして持ち直す
    state.hiddenSeedIds = [...new Set([...(state.hiddenSeedIds || []), record.id])];
    record.id = newId('round');
  }

  const index = state.rounds.findIndex((r) => r.id === record.id);
  const sameDay = state.rounds.findIndex((r) => r.id !== record.id && r.date === date && r.course === course);
  if (index >= 0) state.rounds[index] = record;
  else if (sameDay >= 0) {
    if (!window.confirm('同じ日・同じコースの記録があります。上書きしますか？')) return;
    state.rounds[sameDay] = record;
  } else state.rounds.push(record);

  persist('スコアを保存しました');
  clearScoreForm();
  $('#score-form-group').open = false;
  expandedRound = null;
  renderScore();
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

// ---------------------------------------------------------------------------
// 分析
// ---------------------------------------------------------------------------

function kpi(label, value, sub = '') {
  return el('div', { class: 'kpi' }, [
    el('span', { class: 'kpi-label', text: label }),
    el('div', { class: 'kpi-value', text: String(value) }),
    sub ? el('span', { class: 'kpi-sub', text: sub }) : null,
  ]);
}

function renderAnalysis() {
  const rounds = allRounds(state);
  const stats = roundStats(rounds);
  const practice = practiceStats({ startDate: state.settings.startDate, records: dailyList(state), today });

  const scoreKpi = $('#an-score-kpi');
  clear(scoreKpi);
  [
    kpi('全ラウンド平均', fmt(stats.averageScore), `${stats.count}ラウンド`),
    kpi('直近3R平均', fmt(stats.averageLast3)),
    kpi('直近5R平均', fmt(stats.averageLast5)),
    kpi('ベスト', fmt(stats.bestScore, '', 0)),
    kpi('ワースト', fmt(stats.worstScore, '', 0)),
    kpi('目標まで', stats.averageLast5 === null ? '—' : fmt(stats.averageLast5 - state.settings.targetScore, '打', 1)),
  ].forEach((node) => scoreKpi.appendChild(node));

  const greenKpi = $('#an-green-kpi');
  clear(greenKpi);
  [
    kpi('パーオン率', fmt(stats.girRate, '%'), '全期間'),
    kpi('パーオン率', fmt(stats.girRateLast5, '%'), '直近5R'),
    kpi('ボギーオン率', fmt(stats.bogeyOnRate, '%'), '全期間'),
    kpi('ボギーオン率', fmt(stats.bogeyOnRateLast5, '%'), '直近5R'),
    kpi('平均パット', fmt(stats.averagePutts), '全期間'),
    kpi('平均パット', fmt(stats.averagePuttsLast5), '直近5R'),
    kpi('パーオン後3パット率', fmt(stats.threePuttAfterGirRate, '%'), '全期間'),
    kpi('パーオン後3パット率', fmt(stats.threePuttAfterGirRateLast5, '%'), '直近5R'),
  ].forEach((node) => greenKpi.appendChild(node));

  const missKpi = $('#an-miss-kpi');
  clear(missKpi);
  [
    kpi('OB・1ペナ', fmt(stats.averagePenalties, '回')),
    kpi('トリプル以上', fmt(stats.averageTriple, 'H')),
    kpi('3パット', fmt(stats.averageThreePutts, '回')),
    kpi('キャリー不足', fmt(stats.averageCarryShorts, '回')),
    kpi('ショートサイド', fmt(stats.averageShortSide, '回')),
    kpi('判断ミス', fmt(stats.averageStrategyErrors, '回')),
  ].forEach((node) => missKpi.appendChild(node));

  const scoreSeriesData = scoreSeries(rounds);
  const chartScore = $('#chart-score');
  clear(chartScore);
  chartScore.appendChild(
    lineChart({ series: scoreSeriesData, average: movingAverage(scoreSeriesData, 3), invertHint: true })
  );

  const girSeriesData = girSeries(rounds);
  const chartGir = $('#chart-gir');
  clear(chartGir);
  chartGir.appendChild(lineChart({ series: girSeriesData, average: movingAverage(girSeriesData, 3), unit: '%' }));

  const practiceKpi = $('#an-practice-kpi');
  clear(practiceKpi);
  const rate28 = recentPracticeRate({ startDate: state.settings.startDate, records: dailyList(state), today, days: 28 });
  [
    kpi('練習実施率', practice.achievementRate === null ? '—' : `${practice.achievementRate}%`, '全期間'),
    kpi('練習実施率', rate28 === null ? '—' : `${rate28}%`, '直近28日'),
    kpi('実施日', `${practice.doneDays}日`),
    kpi('未実施日', `${practice.missedDays}日`),
  ].forEach((node) => practiceKpi.appendChild(node));

  renderPracticeScoreRelation();

  const adviceWrap = $('#an-advice');
  clear(adviceWrap);
  for (const message of buildAdvice(adviceInput())) adviceWrap.appendChild(adviceNode(message));
}

/** 練習実施率とスコアの関係（データ蓄積後に表示） */
function renderPracticeScoreRelation() {
  const wrap = $('#an-practice-score');
  clear(wrap);
  const records = dailyList(state);
  const points = [];
  for (const round of allRounds(state)) {
    if (diffDays(round.date, state.settings.startDate) < 0) continue;
    const from = addDays(round.date, -14);
    const stats = practiceStats({
      startDate: state.settings.startDate,
      records,
      today,
      from,
      to: addDays(round.date, -1),
    });
    if (stats.achievementRate === null) continue;
    points.push({ date: round.date, rate: stats.achievementRate, score: round.totalScore });
  }
  wrap.appendChild(el('p', { class: 'card-title', text: '練習実施率とスコアの関係', style: 'margin-top:14px' }));
  wrap.appendChild(scatterChart({ points }));
  if (points.length < 3) {
    wrap.appendChild(
      el('p', {
        class: 'section-note',
        text: 'プロジェクト開始後のラウンドが3回たまると、練習量とスコアの関係を表示します。',
      })
    );
  }
}

// ---------------------------------------------------------------------------
// データ管理
// ---------------------------------------------------------------------------

function exportData() {
  const json = exportJSON(state);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `trd-golf-backup-${today}.json` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('バックアップを書き出しました');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const next = importJSON(String(reader.result));
      if (!window.confirm('現在の入力データを読み込んだ内容で置き換えます。よろしいですか？')) return;
      state = next;
      persist('バックアップを読み込みました');
      renderAll();
    } catch (e) {
      toast('読み込めませんでした（ファイル形式を確認してください）', true);
    }
  };
  reader.readAsText(file);
}

function resetData() {
  if (!window.confirm('この端末に保存した練習・キャリー・スコアをすべて消去します。元に戻せません。')) return;
  state = defaultState(today);
  sessionDraft = null;
  persist('消去しました');
  renderAll();
}

// ---------------------------------------------------------------------------
// 初期化
// ---------------------------------------------------------------------------

function bindEvents() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      location.hash = tab.dataset.view;
    });
  });
  window.addEventListener('hashchange', () => showView(currentView()));

  $('#home-memo-save').addEventListener('click', () => {
    const rec = ensureDaily(today);
    rec.fatigue = $('#home-fatigue').value ? Number($('#home-fatigue').value) : undefined;
    rec.pain = $('#home-pain').value;
    rec.memo = $('#home-memo').value.trim();
    persist('メモを保存しました');
  });

  $('#cal-prev').addEventListener('click', () => {
    calCursor = calCursor.m === 1 ? { y: calCursor.y - 1, m: 12 } : { ...calCursor, m: calCursor.m - 1 };
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', () => {
    calCursor = calCursor.m === 12 ? { y: calCursor.y + 1, m: 1 } : { ...calCursor, m: calCursor.m + 1 };
    renderCalendar();
  });

  $('#set-save').addEventListener('click', () => {
    const start = $('#set-start').value;
    if (!start) return toast('開始日を入力してください', true);
    state.settings.startDate = start;
    state.settings.targetScore = clamp(num($('#set-target').value, 85), 60, 120);
    state.settings.firstStageAverage = clamp(num($('#set-first').value, 92), 60, 120);
    persist('設定を保存しました');
    renderAll();
  });

  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('#sheet-close').addEventListener('click', () => {
    if (sheetDate) {
      const memo = $('#sheet-memo').value.trim();
      if (memo || state.daily[sheetDate]) {
        const rec = ensureDaily(sheetDate);
        rec.memo = memo;
        saveState(state);
      }
    }
    closeSheet();
    renderCalendar();
  });
  $('#sheet-clear').addEventListener('click', () => {
    if (!sheetDate) return;
    delete state.daily[sheetDate];
    persist('記録を消しました');
    closeSheet();
    renderAll();
  });

  $('#rng-date').addEventListener('change', (e) => {
    practiceDate = e.target.value || today;
    sessionDraft = null;
    renderPractice();
  });
  $('#rng-save').addEventListener('click', saveSession);
  $('#carry-save').addEventListener('click', saveCarry);

  const syncTotal = () => {
    const out = $('#sc-out').value;
    const inn = $('#sc-in').value;
    if (out !== '' && inn !== '') $('#sc-total').value = num(out) + num(inn);
  };
  $('#sc-out').addEventListener('input', syncTotal);
  $('#sc-in').addEventListener('input', syncTotal);
  $('#sc-save').addEventListener('click', saveRound);
  $('#sc-cancel').addEventListener('click', () => {
    clearScoreForm();
    toast('入力をクリアしました');
  });

  $('#data-export').addEventListener('click', exportData);
  $('#data-import-btn').addEventListener('click', () => $('#data-import').click());
  $('#data-import').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importData(file);
    e.target.value = '';
  });
  $('#data-reset').addEventListener('click', resetData);

  // 日付が変わったら（日をまたいだ利用）表示を更新する
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const now = todayJST();
    if (now !== today) {
      today = now;
      practiceDate = now;
      sessionDraft = null;
      renderAll();
    }
  });
}

function init() {
  bindEvents();
  showView(currentView());
  if (!canPersist) {
    toast('この端末では保存できない設定です（プライベートモードなど）', true);
  }
}

init();
