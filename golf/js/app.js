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
import {
  STATUS_LABELS,
  STATUS_MARKS,
  STRENGTH_NOTE,
  SUNDAY_DRILL,
  effectiveMenu,
  isRestWeekday,
  stepsForWeekday,
} from './menu.js';
import {
  girSeries,
  movingAverage,
  practiceStats,
  rangeSessionStats,
  recentPracticeRate,
  round1,
  roundStats,
  scoreSeries,
  sortByDateAsc,
  sortByDateDesc,
} from './stats.js';
import { DATA_REQUESTS, analyzeBooking, buildDiagnosis, differential } from './diagnose.js';
import { courseById } from './courses.js';
import { lineChart, scatterChart } from './chart.js';
import {
  allRounds,
  canPersist,
  courseList,
  dailyList,
  defaultState,
  exportJSON,
  importJSON,
  loadState,
  newId,
  nextBooking,
  rangeList,
  saveState,
} from './store.js';
import { CLUBS } from './seed.js';
import * as cloud from './cloud.js';
import { FOCUS_OPTIONS, buildWeeklyPlan, describePlan, restDaysOf } from './plan.js';
import { QUESTIONS, answerFor, buildConsultPrompt } from './consult.js';
import { memoFeedback } from './feedback.js';
import { mergeStates, stamp } from './merge.js';

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
  scheduleCloudPush();
  return result.ok;
}

// ---------------------------------------------------------------------------
// クラウド同期
// ---------------------------------------------------------------------------

let cloudUser = null;
let cloudReady = false;
let cloudUnsubscribe = null;
let pushTimer = null;
let lastSyncedAt = null;

/** 連続保存でクラウドへ何度も書かないよう、まとめて送る */
function scheduleCloudPush() {
  if (!cloudUser) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      await cloud.push(cloudUser.uid, state);
      lastSyncedAt = new Date();
      renderCloudPanel();
    } catch (e) {
      console.warn('クラウドへの保存に失敗しました（通信が戻ったとき自動で再送されます）', e);
      renderCloudPanel();
    }
  }, 1200);
}

async function startCloud() {
  if (!cloud.isConfigured()) {
    renderCloudPanel();
    return;
  }
  cloudReady = await cloud.init();
  if (!cloudReady) {
    renderCloudPanel();
    return;
  }
  cloud.onUserChange(async (user) => {
    cloudUser = user;
    renderCloudPanel();
    if (cloudUnsubscribe) {
      cloudUnsubscribe();
      cloudUnsubscribe = null;
    }
    if (!user) return;

    try {
      // 1. クラウドの内容と手元の内容を統合する（どちらの入力も消さない）
      const remote = await cloud.pull(user.uid);
      state = mergeStates(state, remote);
      state.cloudUid = user.uid;
      saveState(state);
      renderAll();
      updateSetupVisibility();

      // 2. 統合結果を書き戻す
      await cloud.push(user.uid, state);
      lastSyncedAt = new Date();

      // 3. 他の端末の変更を受け取る
      cloudUnsubscribe = cloud.subscribe(user.uid, (remoteState) => {
        state = mergeStates(state, remoteState);
        saveState(state);
        lastSyncedAt = new Date();
        renderAll();
        renderCloudPanel();
        updateSetupVisibility();
      });
      renderCloudPanel();
      toast('クラウドと同期しました');
    } catch (e) {
      console.warn('同期に失敗しました', e);
      toast('同期できませんでした（端末内の保存は有効です）', true);
      renderCloudPanel();
    }
  });
}

function renderCloudPanel() {
  const statusWrap = $('#cloud-status');
  const actionWrap = $('#cloud-actions');
  if (!statusWrap || !actionWrap) return;
  clear(statusWrap);
  clear(actionWrap);

  if (!cloud.isConfigured()) {
    statusWrap.appendChild(
      el('p', {
        class: 'section-note',
        style: 'margin-top:0',
        text: 'クラウド同期は未設定です。設定すると、機種変更やもう1台の端末でも同じデータを使えます。設定するまでは、これまで通りこの端末だけに保存されます。',
      })
    );
    return;
  }

  if (!cloudReady) {
    statusWrap.appendChild(
      el('p', { class: 'cloud-state offline', html: '状態：<b>接続できません</b>' })
    );
    statusWrap.appendChild(
      el('p', {
        class: 'section-note',
        text: 'オフラインか、設定が正しくない可能性があります。通信のある場所で開き直すと自動で再接続します。端末内のデータはそのまま使えます。',
      })
    );
    actionWrap.appendChild(
      el('button', {
        class: 'btn-small',
        style: 'width:100%',
        text: '再接続する',
        onclick: async () => {
          await startCloud();
          if (!cloudReady) toast('まだ接続できません', true);
        },
      })
    );
    return;
  }

  if (!cloudUser) {
    statusWrap.appendChild(el('p', { class: 'cloud-state', html: '状態：<b>未ログイン</b>' }));
    statusWrap.appendChild(
      el('p', {
        class: 'section-note',
        text: 'ログインすると、この端末のデータがGoogleアカウントに紐づいて保存され、別の端末でも同じ内容を使えます。',
      })
    );
    actionWrap.appendChild(
      el('button', { class: 'btn-primary', style: 'width:100%', text: 'Googleでログイン', onclick: doSignIn })
    );
    return;
  }

  const initial = (cloudUser.name || cloudUser.email || '?').slice(0, 1);
  statusWrap.appendChild(
    el('div', { class: 'cloud-user' }, [
      el('div', { class: 'cloud-avatar' }, [
        cloudUser.photo ? el('img', { src: cloudUser.photo, alt: '' }) : el('span', { text: initial }),
      ]),
      el('div', {}, [
        el('p', { class: 'cloud-name', text: cloudUser.name || '(名前なし)' }),
        el('p', { class: 'cloud-mail', text: cloudUser.email }),
      ]),
    ])
  );
  statusWrap.appendChild(
    el('p', {
      class: 'cloud-state',
      html: lastSyncedAt
        ? `状態：<b>同期済み</b>（最終 ${lastSyncedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}）`
        : '状態：<b>接続中</b>',
    })
  );
  actionWrap.appendChild(
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn-ghost btn-small', text: 'ログアウト', onclick: doSignOut }),
      el('button', { class: 'btn-small', text: '今すぐ同期', onclick: doSyncNow }),
    ])
  );
  actionWrap.appendChild(
    el('button', {
      class: 'btn-danger btn-small',
      style: 'width:100%;margin-top:8px',
      text: 'クラウド上のデータを削除',
      onclick: doDeleteCloud,
    })
  );
}

async function doSignIn() {
  try {
    await cloud.signIn();
  } catch (e) {
    const code = e && e.code ? e.code : '';
    if (code === 'auth/unauthorized-domain') {
      toast('この URL からのログインが許可されていません（Firebaseの承認済みドメインに追加してください）', true);
    } else if (code === 'auth/popup-closed-by-user') {
      toast('ログインを中止しました', true);
    } else {
      toast(`ログインできませんでした：${code || (e && e.message) || '不明なエラー'}`, true);
    }
  }
}

async function doSignOut() {
  if (cloudUnsubscribe) {
    cloudUnsubscribe();
    cloudUnsubscribe = null;
  }
  await cloud.signOutUser();
  cloudUser = null;
  lastSyncedAt = null;
  renderCloudPanel();
  toast('ログアウトしました（端末内のデータは残ります）');
}

async function doSyncNow() {
  if (!cloudUser) return;
  try {
    const remote = await cloud.pull(cloudUser.uid);
    state = mergeStates(state, remote);
    saveState(state);
    await cloud.push(cloudUser.uid, state);
    lastSyncedAt = new Date();
    renderAll();
    renderCloudPanel();
    toast('同期しました');
  } catch {
    toast('同期できませんでした（通信を確認してください）', true);
  }
}

async function doDeleteCloud() {
  if (!cloudUser) return;
  if (!window.confirm('クラウドに保存したデータを削除します。この端末のデータは残ります。よろしいですか？')) return;
  try {
    await cloud.remove(cloudUser.uid);
    toast('クラウドのデータを削除しました');
  } catch {
    toast('削除できませんでした', true);
  }
}

// ---------------------------------------------------------------------------
// 相談画面
// ---------------------------------------------------------------------------

let consultAsked = [];

function consultContext() {
  const rounds = allRounds(state);
  const booking = nextBooking(state, today);
  return {
    state,
    rounds,
    today,
    stats: roundStats(rounds),
    practice: practiceStats({
      startDate: state.settings.startDate,
      records: dailyList(state),
      today,
      restWeekdays: state.settings.restWeekdays,
    }),
    diagnosis: currentDiagnosis(),
    booking: booking
      ? analyzeBooking({ booking, rounds, courses: courseList(state), settings: state.settings })
      : null,
  };
}

function bubble(text, who = 'app') {
  return el('div', { class: `bubble ${who}`, text });
}

function openConsult() {
  $('#consult').hidden = false;
  if (!consultAsked.length) resetConsult();
  document.body.style.overflow = 'hidden';
}

function closeConsult() {
  $('#consult').hidden = true;
  document.body.style.overflow = '';
}

function resetConsult() {
  consultAsked = [];
  const log = $('#consult-log');
  clear(log);
  const name = state.profileName ? `${state.profileName}さん` : '';
  log.appendChild(
    el('div', { class: 'bubble-group' }, [
      bubble(
        `${name ? name + '、こんにちは。' : 'こんにちは。'}この画面では、登録された記録をもとに質問へ答えます。\n分からないことは「分からない」と答えます。`
      ),
      bubble('下から聞きたいことを選んでください。'),
    ])
  );
  renderConsultChips();
}

function renderConsultChips() {
  const wrap = $('#consult-chips');
  clear(wrap);
  for (const q of QUESTIONS) {
    wrap.appendChild(
      el('button', {
        class: `consult-chip${consultAsked.includes(q.key) ? ' used' : ''}`,
        text: q.label,
        onclick: () => askConsult(q),
      })
    );
  }
}

function askConsult(question) {
  const log = $('#consult-log');
  log.appendChild(el('div', { class: 'bubble-group' }, [bubble(question.label, 'me')]));

  const lines = answerFor(question.key, consultContext());
  const group = el('div', { class: 'bubble-group' }, lines.map((line) => bubble(line)));
  log.appendChild(group);

  if (!consultAsked.includes(question.key)) consultAsked.push(question.key);
  renderConsultChips();
  log.scrollTop = log.scrollHeight;
}

async function copyConsultPrompt() {
  const text = buildConsultPrompt(consultContext());
  try {
    await navigator.clipboard.writeText(text);
    toast('コピーしました。ChatGPTなどに貼り付けてください');
  } catch {
    // クリップボードが使えない場合は選択できる形で表示する
    const log = $('#consult-log');
    log.appendChild(
      el('div', { class: 'bubble-group' }, [
        bubble('コピーできなかったので、以下を長押しして選択・コピーしてください。'),
        bubble(text),
      ])
    );
    log.scrollTop = log.scrollHeight;
  }
}

// ---------------------------------------------------------------------------
// 初回セットアップ（利用者の選択）
// ---------------------------------------------------------------------------

function updateSetupVisibility() {
  const needsSetup = !state.setupDone;
  $('#setup').hidden = !needsSetup;
  if (needsSetup) showSetupPage(setupPage);
  return needsSetup;
}

// --- 初期設定ウィザード -------------------------------

const SETUP_PAGES = 6;
let setupPage = 1;
const setupAnswers = {
  name: '',
  currentAverage: null,
  targetScore: null,
  days: [],
  minutes: 15,
  rangeDay: null,
  focus: [],
  adviceEnabled: true,
};

function renderWeekdayPicker() {
  const wrap = $('#setup-days');
  clear(wrap);
  WEEKDAY_LABELS.forEach((label, day) => {
    wrap.appendChild(
      el('button', {
        type: 'button',
        class: 'weekday-btn',
        'aria-pressed': setupAnswers.days.includes(day) ? 'true' : 'false',
        text: label,
        onclick: (event) => {
          const active = setupAnswers.days.includes(day);
          setupAnswers.days = active ? setupAnswers.days.filter((d) => d !== day) : [...setupAnswers.days, day];
          event.currentTarget.setAttribute('aria-pressed', active ? 'false' : 'true');
        },
      })
    );
  });
}

function renderFocusOptions() {
  const wrap = $('#setup-focus');
  clear(wrap);
  for (const option of FOCUS_OPTIONS) {
    const checked = setupAnswers.focus.includes(option.key);
    const input = el('input', { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) });
    const row = el('label', { class: `focus-option${checked ? ' checked' : ''}` }, [
      input,
      el('span', { text: option.label }),
    ]);
    // その場で見た目だけ切り替える（毎回描き直すと操作が中断されるため）
    input.addEventListener('change', () => {
      setupAnswers.focus = input.checked
        ? [...new Set([...setupAnswers.focus, option.key])]
        : setupAnswers.focus.filter((k) => k !== option.key);
      row.classList.toggle('checked', input.checked);
    });
    wrap.appendChild(row);
  }
}

function buildSetupPlan() {
  return buildWeeklyPlan({
    practiceDays: setupAnswers.days,
    minutes: setupAnswers.minutes,
    rangeDay: setupAnswers.rangeDay,
    focus: setupAnswers.focus,
  });
}

function renderAdviceChoice() {
  $('#setup-advice-on').classList.toggle('selected', setupAnswers.adviceEnabled);
  $('#setup-advice-off').classList.toggle('selected', !setupAnswers.adviceEnabled);
}

function renderSetupSummary() {
  const wrap = $('#setup-summary');
  clear(wrap);
  const plan = buildSetupPlan();
  wrap.appendChild(
    el('p', {
      class: 'section-note',
      style: 'margin-top:0',
      text: `${setupAnswers.name || '(名前未設定)'}／目標 ${setupAnswers.targetScore ?? '未設定'}${
        setupAnswers.currentAverage ? `（今の平均 ${setupAnswers.currentAverage}）` : ''
      }`,
    })
  );
  wrap.appendChild(
    el('p', {
      class: 'section-note',
      style: 'margin-top:0',
      text: `アドバイス：${setupAnswers.adviceEnabled ? '受け取る' : '受け取らない（数値だけ見る）'}`,
    })
  );
  for (const row of describePlan(plan)) {
    wrap.appendChild(
      el('div', { class: `plan-summary-row${row.type === 'rest' ? ' rest' : ''}` }, [
        el('span', { class: 'plan-summary-day', text: row.label }),
        el('span', { class: 'plan-summary-title', text: row.title }),
        el('span', { class: 'plan-summary-min', text: row.minutesLabel }),
      ])
    );
  }
}

function showSetupPage(page) {
  setupPage = Math.min(Math.max(page, 1), SETUP_PAGES);
  for (let i = 1; i <= SETUP_PAGES; i++) {
    const node = $(`#setup-page-${i}`);
    if (node) node.hidden = i !== setupPage;
  }
  $('#setup-step-label').textContent = `${setupPage} / ${SETUP_PAGES}`;
  $('#setup-next').textContent = setupPage === SETUP_PAGES ? 'この内容で始める' : '次へ';
  $('#setup-back').textContent = '戻る';
  $('#setup-back').disabled = setupPage === 1;
  if (setupPage === 3) renderWeekdayPicker();
  if (setupPage === 4) renderFocusOptions();
  if (setupPage === 5) renderAdviceChoice();
  if (setupPage === SETUP_PAGES) renderSetupSummary();
}

function collectSetupPage() {
  if (setupPage === 1) setupAnswers.name = $('#setup-name').value.trim();
  if (setupPage === 2) {
    setupAnswers.currentAverage = $('#setup-current').value === '' ? null : num($('#setup-current').value);
    setupAnswers.targetScore = $('#setup-target').value === '' ? null : num($('#setup-target').value);
  }
  if (setupPage === 3) {
    setupAnswers.minutes = num($('#setup-minutes').value, 15);
    setupAnswers.rangeDay = $('#setup-range').value === '' ? null : num($('#setup-range').value);
  }
}

function validateSetupPage() {
  if (setupPage === 1 && !setupAnswers.name) {
    toast('お名前を入力してください', true);
    return false;
  }
  if (setupPage === 3 && !setupAnswers.days.length && setupAnswers.rangeDay === null) {
    toast('練習できる曜日を1つ以上選ぶか、打ちっぱなしの日を選んでください', true);
    return false;
  }
  return true;
}

function finishSetup() {
  const plan = buildSetupPlan();
  state.setupDone = true;
  state.profileName = setupAnswers.name;
  state.settings = stamp({
    ...state.settings,
    startDate: today,
    targetScore: setupAnswers.targetScore ?? 90,
    currentAverage: setupAnswers.currentAverage,
    firstStageAverage: setupAnswers.currentAverage ?? state.settings.firstStageAverage,
    practiceMinutes: setupAnswers.minutes,
    focusAreas: setupAnswers.focus,
    adviceEnabled: setupAnswers.adviceEnabled,
    weeklyPlan: plan,
    restWeekdays: restDaysOf(plan),
  });
  state.planOverrides = {};
  persist(`${setupAnswers.name} さんの設定で始めます`);
  $('#setup').hidden = true;
  $('#setup-wizard').hidden = true;
  renderAll();
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
    const menu = effectiveMenu(weekday(date), state.planOverrides, state.settings.weeklyPlan);
    state.daily[date] = {
      id: newId('d'),
      date,
      menuType: menu.type,
      status: null,
      minutes: menu.minutes,
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
  const stats = practiceStats({ startDate: state.settings.startDate, records: dailyList(state), today, restWeekdays: state.settings.restWeekdays });
  const started = diffDays(today, state.settings.startDate) >= 0;

  $('#home-day').textContent = started ? String(stats.projectDay).padStart(3, '0') : '—';
  $('#home-start').textContent = started
    ? `開始日 ${formatLong(state.settings.startDate)}／目標 ${state.settings.targetScore}`
    : `開始予定日 ${formatLong(state.settings.startDate)}`;
  $('#home-done').textContent = stats.doneDays;
  $('#home-missed').textContent = stats.missedDays;
  $('#home-rate').textContent = stats.achievementRate === null ? '—' : `${stats.achievementRate}%`;

  const w = weekday(today);
  const menu = effectiveMenu(w, state.planOverrides, state.settings.weeklyPlan);
  $('#home-weekday').textContent = WEEKDAY_LABELS[w];
  $('#home-today-label').textContent = `今日のメニュー（${formatShort(today)}）`;
  $('#home-menu-title').textContent = menu.title;
  $('#home-menu-meta').textContent = `${menu.minutesLabel}／${menu.purpose}`;
  const notes = [];
  if (menu.customized) notes.push('※ 診断からの変更を適用中');
  if (menu.type === 'strength') notes.push(STRENGTH_NOTE);
  if (isRestWeekday(w, state.settings.restWeekdays)) notes.push('今日は完全休養日です。達成率の分母には入りません。');
  $('#home-menu-note').textContent = notes.join(' ');

  renderSteps(w);
  renderStatusButtons();

  const record = state.daily[today];
  $('#home-fatigue').value = record?.fatigue ? String(record.fatigue) : '';
  $('#home-pain').value = record?.pain || 'none';
  $('#home-memo').value = record?.memo || '';
  clear($('#home-memo-feedback'));

  renderHomeBooking();
  renderHomeAdvice();
  renderLastRound();
}

function renderSteps(w) {
  const list = $('#home-steps');
  clear(list);
  const steps = stepsForWeekday(w, state.planOverrides, state.settings.weeklyPlan);
  const menuType = effectiveMenu(w, state.planOverrides, state.settings.weeklyPlan).type;
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
  rec.menuType = effectiveMenu(weekday(date), state.planOverrides, state.settings.weeklyPlan).type;
  state.daily[date] = stamp(rec);
  persist(`${formatShort(date)} を「${STATUS_LABELS[status]}」で記録しました`);
  renderAll();
  if (sheetDate) renderSheet();
}

/** 診断エンジンへの入力をまとめる */
function diagnosisInput() {
  return {
    rounds: allRounds(state),
    courses: courseList(state),
    practice: practiceStats({ startDate: state.settings.startDate, records: dailyList(state), today, restWeekdays: state.settings.restWeekdays }),
    rangeStats: rangeSessionStats(rangeList(state)),
    settings: state.settings,
  };
}

function currentDiagnosis() {
  return buildDiagnosis(diagnosisInput());
}

const LEVEL_LABEL = {
  baseline: '現在地',
  improve: '改善点',
  keep: '維持',
  watch: '観察',
};

function findingNode(finding, { compact = false } = {}) {
  const level = LEVEL_LABEL[finding.level] || '';
  const label = !level || level === finding.area ? finding.area : `${level}／${finding.area}`;
  const node = el('div', { class: `advice ${finding.level === 'improve' ? 'focus' : 'good'}` }, [
    el('h3', {}, [el('span', { class: 'chip', text: label })]),
    el('p', { text: finding.fact }),
  ]);
  if (!compact) node.appendChild(el('p', { text: finding.reading, style: 'margin-top:6px' }));
  if (finding.action) {
    node.appendChild(el('p', { class: 'action-line', text: `→ ${finding.action}` }));
  }
  return node;
}

/** アドバイスを表示する設定か（利用者ごと） */
function adviceEnabled() {
  return state.settings.adviceEnabled !== false;
}

function applyAdvicePreference() {
  const on = adviceEnabled();
  const homeAdvice = $('#home-advice-card');
  if (homeAdvice) homeAdvice.hidden = !on;
  for (const id of ['#an-findings-card', '#an-watch-card', '#an-plan-card', '#an-data-card']) {
    const node = $(id);
    if (node) node.hidden = !on;
  }
}

function renderHomeAdvice() {
  const wrap = $('#home-advice');
  clear(wrap);
  if (!adviceEnabled()) return;
  const { findings } = currentDiagnosis();
  const improve = findings.filter((f) => f.level === 'improve').slice(0, 2);
  const list = improve.length ? improve : findings.slice(0, 1);
  if (!list.length) {
    wrap.appendChild(el('p', { class: 'empty', text: 'ラウンドを登録すると診断を表示します' }));
    return;
  }
  for (const finding of list) wrap.appendChild(findingNode(finding, { compact: true }));
  wrap.appendChild(
    el('button', {
      class: 'btn-ghost btn-small',
      style: 'width:100%;margin-top:8px',
      text: '分析の全文を見る',
      onclick: () => {
        location.hash = 'analysis';
      },
    })
  );
}

/** メモを保存したときの応答。どこに保存されたかも必ず伝える。 */
function renderMemoFeedback(record) {
  const wrap = $('#home-memo-feedback');
  if (!wrap) return;
  clear(wrap);

  const { headline, lines } = memoFeedback({
    memo: record.memo,
    record,
    settings: state.settings,
    records: dailyList(state),
    today,
  });

  const box = el('div', { class: 'feedback' }, [el('p', { class: 'feedback-head', text: headline })]);
  for (const line of lines) box.appendChild(el('p', { text: line }));
  box.appendChild(
    el('p', {
      class: 'section-note',
      style: 'margin-top:8px',
      text: `保存先：記録タブの「最近のメモ」と、カレンダーの${formatShort(today)}です。`,
    })
  );
  box.appendChild(
    el('button', {
      class: 'btn-small',
      style: 'width:100%;margin-top:8px',
      text: '記録タブでメモを見る',
      onclick: () => {
        location.hash = 'calendar';
      },
    })
  );
  wrap.appendChild(box);
}

function renderHomeBooking() {
  const wrap = $('#home-booking');
  clear(wrap);
  const booking = nextBooking(state, today);
  if (!booking) {
    wrap.appendChild(el('p', { class: 'empty', text: '予約は登録されていません' }));
    wrap.appendChild(
      el('button', {
        class: 'btn-ghost btn-small',
        style: 'width:100%',
        text: 'スコア画面で予約を登録する',
        onclick: () => {
          location.hash = 'score';
        },
      })
    );
    return;
  }

  const analysis = analyzeBooking({
    booking,
    rounds: allRounds(state),
    courses: courseList(state),
    settings: state.settings,
  });
  const days = diffDays(booking.date, today);
  wrap.appendChild(
    el('div', { class: 'booking-head' }, [
      el('div', {}, [
        el('p', { class: 'score-course', text: booking.courseName }),
        el('p', { class: 'score-date', text: `${formatLong(booking.date)}／${booking.tee || '—'}` }),
      ]),
      el('span', { class: 'booking-days' }, [
        el('b', { text: days === 0 ? '本日' : `あと${days}日` }),
      ]),
    ])
  );

  if (analysis?.targetRange) {
    wrap.appendChild(
      el('p', {
        class: 'chip',
        style: 'display:inline-block;margin-top:8px',
        text: `想定スコア ${analysis.targetRange[0]}〜${analysis.targetRange[1]}`,
      })
    );
  }
  for (const note of analysis?.notes || []) {
    wrap.appendChild(el('p', { class: 'section-note', text: note }));
  }
}

function renderLastRound() {
  const wrap = $('#home-last-round');
  clear(wrap);
  // 古いiOS Safari（15.3以前）に Array.prototype.at がないため添字で取得する
  const sortedRounds = sortByDateAsc(allRounds(state));
  const last = sortedRounds[sortedRounds.length - 1];
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
  if (isRestWeekday(weekday(date), state.settings.restWeekdays)) return 'rest';
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
          state.daily[date]?.memo ? el('span', { class: 'memo-dot' }) : null,
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
    restWeekdays: state.settings.restWeekdays,
  });
  $('#cal-done').textContent = monthStats.doneDays;
  $('#cal-missed').textContent = monthStats.missedDays;
  $('#cal-rate').textContent = monthStats.achievementRate === null ? '—' : `${monthStats.achievementRate}%`;

  renderMemoList();

  $('#set-start').value = state.settings.startDate;
  $('#set-target').value = state.settings.targetScore;
  $('#set-first').value = state.settings.firstStageAverage;
}

/** 記録タブのメモ一覧。保存したメモを見返せる場所。 */
function renderMemoList() {
  const wrap = $('#memo-list');
  if (!wrap) return;
  clear(wrap);

  const items = dailyList(state)
    .filter((r) => (r.memo || '').trim())
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  $('#memo-count').textContent = `${items.length}件`;
  if (!items.length) {
    wrap.appendChild(
      el('p', {
        class: 'empty',
        text: 'メモはまだありません。ホーム画面の「メモ・疲労度・痛みを記録する」から書けます。',
      })
    );
    return;
  }

  for (const item of items.slice(0, 30)) {
    const w = weekday(item.date);
    const menu = effectiveMenu(w, state.planOverrides, state.settings.weeklyPlan);
    const status = item.status || 'none';
    wrap.appendChild(
      el('button', { class: 'memo-item', onclick: () => openSheet(item.date) }, [
        el('div', { class: 'memo-item-head' }, [
          el('span', { class: `memo-mark ${status}`, text: STATUS_MARKS[status] || '·' }),
          el('span', { class: 'memo-date', text: formatShort(item.date) }),
          el('span', { class: 'memo-menu', text: menu.title }),
        ]),
        el('span', { class: 'memo-text', text: item.memo }),
      ])
    );
  }
  if (items.length > 30) {
    wrap.appendChild(el('p', { class: 'section-note', text: `他 ${items.length - 30} 件はカレンダーから見られます。` }));
  }
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
  const menu = effectiveMenu(weekday(sheetDate), state.planOverrides, state.settings.weeklyPlan);
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

  const menu = effectiveMenu(weekday(practiceDate), state.planOverrides, state.settings.weeklyPlan);
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
  state.range[practiceDate] = stamp({ ...sessionDraft });
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
    state.carry[club] = stamp(state.carry[club]);
  }
  persist('キャリーを保存しました');
}

// ---------------------------------------------------------------------------
// スコア
// ---------------------------------------------------------------------------

const SCORE_FIELDS = {
  date: '#sc-date',
  courseId: '#sc-course',
  tee: '#sc-tee',
  holes: '#sc-holes',
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

  fillCourseSelect($('#sc-course'), $('#sc-course').value);
  updateCourseNote();
  renderBookingForm();
  renderCourseMaster();

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
  const holes = round.holes ?? 18;
  const chips = [];
  if (holes !== 18) chips.push(el('span', { class: 'chip warn', text: `${holes}H` }));
  if (round.outScore != null) chips.push(chip('OUT', round.outScore));
  if (round.inScore != null) chips.push(chip('IN', round.inScore));
  chips.push(chip('パット', round.putts ?? '—'));
  if (round.greensInRegulation != null) {
    const girPct = Math.round((round.greensInRegulation / holes) * 1000) / 10;
    chips.push(chip('パーオン', `${round.greensInRegulation}/${holes} (${girPct}%)`));
  } else {
    chips.push(chip('パーオン', '未入力'));
  }
  const course = courseById(courseList(state), round.courseId);
  const diff = holes === 18 ? differential(round.totalScore, course?.courseRate ?? null, course?.slopeRating ?? null) : null;
  if (diff !== null) chips.push(chip('対CR', `+${round1(round.totalScore - course.courseRate)}／D ${diff}`));
  if (!compact) {
    if (round.bogeyOn != null) chips.push(chip('ボギーオン以内', `${round.bogeyOn}/${holes}`));
    if (round.penalties != null) chips.push(chip('OB・1ペナ', `${round.penalties}`));
    if (round.source === 'seed') chips.push(el('span', { class: 'chip seed', text: 'GORA取込' }));
  }

  const card = el('div', { class: 'score-card' }, [
    el('div', { class: 'score-top' }, [
      el('div', {}, [
        el('p', { class: 'score-course', text: round.course }),
        el('p', {
          class: 'score-date',
          text: `${formatLong(round.date)}${round.tee ? `／${round.tee}` : ''}${holes !== 18 ? `／${holes}ホール` : ''}`,
        }),
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
      kv('3パット', count(round.threePutts, '回')),
      kv('パーオン後の3パット', count(round.threePuttsAfterGIR, '回')),
      kv('OB・1ペナ', count(round.penalties, '回')),
      kv('ショートサイド', count(round.shortSideMisses, '回')),
      kv('キャリー不足', count(round.carryShorts, '回')),
      kv('判断ミス', count(round.strategyErrors, '回')),
      kv('トリプル以上', count(round.tripleOrWorse, 'ホール')),
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

// ---------------------------------------------------------------------------
// ゴルフ場マスタ・予約
// ---------------------------------------------------------------------------

function fillCourseSelect(select, selected) {
  clear(select);
  select.appendChild(el('option', { value: '', text: '選択してください' }));
  for (const course of courseList(state)) {
    const rate = course.courseRate != null ? `CR ${course.courseRate}` : 'CR未登録';
    select.appendChild(
      el('option', { value: course.id, text: `${course.name}（${rate}${course.verified ? '' : '・要確認'}）` })
    );
  }
  select.appendChild(el('option', { value: '__new', text: '＋ 新しいゴルフ場を登録する' }));
  if (selected) select.value = selected;
}

function updateCourseNote() {
  const course = courseById(courseList(state), $('#sc-course').value);
  const note = $('#sc-course-note');
  if (!course) {
    note.textContent = '';
    return;
  }
  note.textContent = `パー${course.par}／コースレート ${course.courseRate ?? '—'}／スロープ ${
    course.slopeRating ?? '—'
  }${course.verified ? '' : '（要確認：仮の値）'}`;
}

function renderCourseMaster() {
  const wrap = $('#course-list-view');
  clear(wrap);
  const courses = courseList(state);
  if (!courses.length) {
    wrap.appendChild(el('p', { class: 'empty', text: 'ゴルフ場が登録されていません' }));
    return;
  }
  const stats = currentDiagnosis().courseStats;
  for (const course of courses) {
    const played = stats.find((s) => s.courseId === course.id || s.name === course.name);
    const chips = [
      chip('パー', course.par ?? '—'),
      chip('CR', course.courseRate ?? '—'),
      chip('スロープ', course.slopeRating ?? '—'),
    ];
    if (played && played.average !== null) chips.push(chip('平均', played.average));
    if (course.courseRate === null) chips.push(el('span', { class: 'chip warn', text: 'CR未登録' }));
    else if (!course.verified) chips.push(el('span', { class: 'chip warn', text: '要確認' }));

    wrap.appendChild(
      el('div', { class: 'course-row' }, [
        el('div', { class: 'course-row-head' }, [
          el('span', { class: 'course-name', text: course.name }),
          el('button', {
            class: 'btn-ghost btn-small',
            text: '編集',
            onclick: () => editCourse(course),
          }),
        ]),
        el('div', { class: 'score-chips' }, chips),
      ])
    );
  }
}

function editCourse(course) {
  $('#co-id').value = course.id;
  $('#co-name').value = course.name;
  $('#co-tee').value = course.tee || 'レギュラー';
  $('#co-par').value = course.par ?? '';
  $('#co-rate').value = course.courseRate ?? '';
  $('#co-slope').value = course.slopeRating ?? '';
  $('#co-yards').value = course.yards ?? '';
  $('#co-verified').checked = !!course.verified;
  $('#co-memo').value = course.memo || '';
  $('#course-form-group').open = true;
  $('#course-form-summary').textContent = `${course.name} を編集`;
  $('#course-form-group').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearCourseForm() {
  for (const sel of ['#co-id', '#co-name', '#co-par', '#co-rate', '#co-slope', '#co-yards', '#co-memo']) {
    $(sel).value = '';
  }
  $('#co-tee').value = 'レギュラー';
  $('#co-verified').checked = false;
  $('#course-form-summary').textContent = '＋ ゴルフ場を追加する';
}

function saveCourse() {
  const name = $('#co-name').value.trim();
  if (!name) return toast('ゴルフ場名を入力してください', true);

  const record = {
    id: $('#co-id').value || newId('course'),
    name,
    tee: $('#co-tee').value,
    par: $('#co-par').value === '' ? 72 : num($('#co-par').value, 72),
    courseRate: $('#co-rate').value === '' ? null : Number($('#co-rate').value),
    slopeRating: $('#co-slope').value === '' ? null : num($('#co-slope').value, null),
    yards: $('#co-yards').value === '' ? null : num($('#co-yards').value, null),
    verified: $('#co-verified').checked,
    memo: $('#co-memo').value.trim(),
  };

  const index = state.courses.findIndex((c) => c.id === record.id);
  if (index >= 0) state.courses[index] = stamp({ ...state.courses[index], ...record });
  else state.courses.push(stamp(record));

  persist('ゴルフ場を保存しました');
  clearCourseForm();
  $('#course-form-group').open = false;
  renderScore();
}

function renderBookingForm() {
  const select = $('#bk-course');
  const booking = nextBooking(state, today);
  fillCourseSelect(select, booking?.courseId || select.value);
  $('#bk-date').min = today;
  if (booking) {
    $('#bk-date').value = booking.date;
    $('#bk-tee').value = booking.tee || 'レギュラー';
  }

  const wrap = $('#bk-analysis');
  clear(wrap);
  if (!booking) {
    wrap.appendChild(el('p', { class: 'empty', text: '予約は登録されていません' }));
    return;
  }

  const analysis = analyzeBooking({
    booking,
    rounds: allRounds(state),
    courses: courseList(state),
    settings: state.settings,
  });
  wrap.appendChild(
    el('p', {
      class: 'score-course',
      text: `${booking.courseName}／${formatLong(booking.date)}`,
      style: 'margin:0 0 6px',
    })
  );
  if (analysis.targetRange) {
    wrap.appendChild(
      el('div', { class: 'kpi-grid' }, [
        kpi('想定スコア', `${analysis.targetRange[0]}〜${analysis.targetRange[1]}`, '推定ハンディ基準'),
        kpi('推定ハンディ', fmt(analysis.handicap), '直近の成績から'),
        kpi('このコース平均', analysis.history ? String(analysis.history.average) : '—', analysis.history ? `${analysis.history.count}回` : '記録なし'),
      ])
    );
  }
  for (const note of analysis.notes) wrap.appendChild(el('p', { class: 'section-note', text: note }));
  if (analysis.course?.memo) {
    wrap.appendChild(el('p', { class: 'section-note', text: `コースメモ：${analysis.course.memo}` }));
  }
  wrap.appendChild(
    el('button', {
      class: 'btn-small',
      style: 'width:100%;margin-top:10px',
      text: 'このラウンドの結果を入力する',
      onclick: () => {
        clearScoreForm();
        $('#sc-date').value = booking.date <= today ? booking.date : today;
        fillCourseSelect($('#sc-course'), booking.courseId);
        $('#sc-tee').value = booking.tee || 'レギュラー';
        updateCourseNote();
        $('#score-form-group').open = true;
        $('#score-form-group').scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    })
  );
}

function saveBooking() {
  const date = $('#bk-date').value;
  const courseId = $('#bk-course').value;
  if (!date) return toast('日付を入力してください', true);
  if (!courseId || courseId === '__new') return toast('ゴルフ場を選択してください', true);
  const course = courseById(courseList(state), courseId);

  const booking = {
    id: newId('bk'),
    date,
    courseId,
    courseName: course?.name || '',
    tee: $('#bk-tee').value,
  };
  // 予定は1件だけ持つ（過去の予定は結果入力後に不要になるため置き換える）
  state.bookings = [...(state.bookings || []).filter((b) => b.date < today), stamp(booking)];
  persist('予約を保存しました');
  renderScore();
  renderHome();
}

function chip(label, value) {
  return el('span', { class: 'chip' }, [document.createTextNode(`${label} `), el('b', { text: String(value) })]);
}

/** 未入力（null）は 0 と区別して「未入力」と出す */
function count(value, unit) {
  return value === null || value === undefined ? '未入力' : `${value}${unit}`;
}

function kv(label, value) {
  return el('div', { class: 'kv' }, [el('span', { text: label }), el('span', { text: String(value) })]);
}

function editRound(round) {
  fillCourseSelect($('#sc-course'), '');
  for (const [key, sel] of Object.entries(SCORE_FIELDS)) {
    const node = $(sel);
    const value = round[key];
    node.value = value === null || value === undefined ? '' : value;
  }
  updateCourseNote();
  $('#sc-holes').value = String(round.holes ?? 18);
  if (!round.tee) $('#sc-tee').value = 'レギュラー';
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
  $('#sc-holes').value = '18';
  $('#sc-course-note').textContent = '';
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
  const courseId = $('#sc-course').value;
  const courseRecord = courseById(courseList(state), courseId);
  const course = courseRecord?.name || '';
  const out = $('#sc-out').value === '' ? null : num($('#sc-out').value);
  const inn = $('#sc-in').value === '' ? null : num($('#sc-in').value);
  let total = $('#sc-total').value === '' ? null : num($('#sc-total').value);
  if (total === null && out !== null && inn !== null) total = out + inn;

  if (!date) return toast('日付を入力してください', true);
  if (diffDays(date, today) > 0) return toast('未来の日付は登録できません', true);
  if (!course) return toast('ゴルフ場を選択してください', true);
  if (!total) return toast('合計スコアを入力してください', true);

  const holes = num($('#sc-holes').value, 18) === 9 ? 9 : 18;
  // 未入力は 0 ではなく null。0回だったのか記録していないのかを区別する。
  const optional = (sel, min, max) => {
    const raw = $(sel).value.trim();
    if (raw === '') return null;
    return clamp(num(raw), min, max);
  };
  const gir = optional('#sc-gir', 0, holes);
  const bogey = optional('#sc-bogey', 0, holes);
  const tpAfterGir = optional('#sc-3putt-gir', 0, holes);

  const record = {
    id: $('#sc-id').value || newId('round'),
    date,
    course,
    courseId: courseId || null,
    tee: $('#sc-tee').value,
    holes,
    outScore: out,
    inScore: inn,
    totalScore: total,
    putts: optional('#sc-putts', 0, 99),
    greensInRegulation: gir,
    bogeyOn: bogey === null ? null : gir === null ? bogey : Math.max(bogey, gir),
    penalties: optional('#sc-pen', 0, 50),
    threePutts: optional('#sc-3putt', 0, holes),
    threePuttsAfterGIR: tpAfterGir === null ? null : gir === null ? tpAfterGir : Math.min(tpAfterGir, gir),
    shortSideMisses: optional('#sc-shortside', 0, holes),
    carryShorts: optional('#sc-carryshort', 0, holes),
    strategyErrors: optional('#sc-strategy', 0, holes),
    tripleOrWorse: optional('#sc-triple', 0, holes),
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

  const stamped = stamp(record);
  const index = state.rounds.findIndex((r) => r.id === stamped.id);
  const sameDay = state.rounds.findIndex((r) => r.id !== record.id && r.date === date && r.course === course);
  if (index >= 0) state.rounds[index] = stamped;
  else if (sameDay >= 0) {
    if (!window.confirm('同じ日・同じコースの記録があります。上書きしますか？')) return;
    state.rounds[sameDay] = stamped;
  } else state.rounds.push(stamped);

  // 予約していたラウンドの結果を入れたら、その予約は消化済みにする
  state.bookings = (state.bookings || []).filter((b) => !(b.date === date && b.courseId === courseId));

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
  const practice = practiceStats({ startDate: state.settings.startDate, records: dailyList(state), today, restWeekdays: state.settings.restWeekdays });

  renderDiagnosis();

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
  const rate28 = recentPracticeRate({
    startDate: state.settings.startDate,
    records: dailyList(state),
    today,
    days: 28,
    restWeekdays: state.settings.restWeekdays,
  });
  [
    kpi('練習実施率', practice.achievementRate === null ? '—' : `${practice.achievementRate}%`, '全期間'),
    kpi('練習実施率', rate28 === null ? '—' : `${rate28}%`, '直近28日'),
    kpi('実施日', `${practice.doneDays}日`),
    kpi('未実施日', `${practice.missedDays}日`),
  ].forEach((node) => practiceKpi.appendChild(node));

  renderPracticeScoreRelation();
  renderCloudPanel();
  renderProfileStatus();
  applyAdvicePreference();
}

function renderProfileStatus() {
  const wrap = $('#profile-status');
  if (!wrap) return;
  const toggle = $('#advice-toggle');
  if (toggle) toggle.checked = adviceEnabled();
  clear(wrap);
  const name = state.profileName || '（名前未設定）';
  const rounds = allRounds(state).length;
  wrap.appendChild(el('p', { class: 'cloud-name', text: name }));
  wrap.appendChild(
    el('p', {
      class: 'section-note',
      style: 'margin-top:4px',
      text: `登録済みのラウンドは ${rounds} 件です。記録はこの端末に保存され、他の人の画面には表示されません。`,
    })
  );
}

/** コースレート基準の現在地・診断・変更案・必要データ */
function renderDiagnosis() {
  applyAdvicePreference();
  if (!adviceEnabled()) {
    // 数値だけを見たい設定のときは、診断まわりを組み立てない
    renderRatingOnly();
    return;
  }
  const diag = currentDiagnosis();
  const s = diag.sample;

  const ratingKpi = $('#an-rating-kpi');
  clear(ratingKpi);
  [
    kpi('直近5R平均', fmt(s.avgScore5), `全期間 ${fmt(s.avgScoreAll)}`),
    kpi('ディファレンシャル', fmt(s.avgDiff5), s.bestDiff5 !== null ? `ベスト ${s.bestDiff5}` : 'コースレート未登録'),
    kpi('推定ハンディ', fmt(s.handicap), '参考値'),
    kpi('スコアのレンジ', s.spread != null ? `${s.spread}打` : '—', '直近5R'),
    kpi('パーオン率', fmt(s.girRate5, '%'), '直近5R'),
    kpi('前半→後半', s.nineGap === null ? '—' : `${s.nineGap > 0 ? '+' : ''}${s.nineGap}打`, 'IN − OUT'),
  ].forEach((node) => ratingKpi.appendChild(node));

  $('#an-rating-note').textContent =
    'ディファレンシャル＝（スコア − コースレート）× 113 ÷ スロープ。コース難易度を補正した数値で、小さいほど良い。推定ハンディはラウンド数が少ないほど誤差が大きい参考値。';

  const findingsWrap = $('#an-findings');
  clear(findingsWrap);
  if (!diag.findings.length) {
    findingsWrap.appendChild(el('p', { class: 'empty', text: 'ラウンドを登録すると診断を表示します' }));
  }
  for (const finding of diag.findings) findingsWrap.appendChild(findingNode(finding));

  const watchWrap = $('#an-watch');
  clear(watchWrap);
  if (!diag.watchPoints.length) {
    watchWrap.appendChild(el('p', { class: 'empty', text: '現時点で気になる点はありません' }));
  }
  for (const point of diag.watchPoints) {
    watchWrap.appendChild(
      el('div', { class: 'watch' }, [el('h3', { text: point.title }), el('p', { text: point.body })])
    );
  }

  renderPlanChanges(diag.planChanges);
  renderDataRequests(diag.dataRequests);
  renderCourseStats(diag.courseStats);
}

/** アドバイスを使わない設定のとき、現在地の数値だけを出す */
function renderRatingOnly() {
  const diag = currentDiagnosis();
  const s = diag.sample;
  const ratingKpi = $('#an-rating-kpi');
  clear(ratingKpi);
  [
    kpi('直近5R平均', fmt(s.avgScore5), `全期間 ${fmt(s.avgScoreAll)}`),
    kpi('ディファレンシャル', fmt(s.avgDiff5), s.bestDiff5 !== null ? `ベスト ${s.bestDiff5}` : 'コースレート未登録'),
    kpi('推定ハンディ', fmt(s.handicap), '参考値'),
    kpi('スコアのレンジ', s.spread != null ? `${s.spread}打` : '—', '直近5R'),
    kpi('パーオン率', fmt(s.girRate5, '%'), '直近5R'),
    kpi('前半→後半', s.nineGap === null ? '—' : `${s.nineGap > 0 ? '+' : ''}${s.nineGap}打`, 'IN − OUT'),
  ].forEach((node) => ratingKpi.appendChild(node));
  $('#an-rating-note').textContent =
    'ディファレンシャル＝（スコア − コースレート）× 113 ÷ スロープ。小さいほど良い数値です。';
  renderCourseStats(diag.courseStats);
}

function renderPlanChanges(changes) {
  const wrap = $('#an-plan');
  clear(wrap);
  const applied = state.planOverrides || {};

  if (!changes.length && !Object.keys(applied).length) {
    wrap.appendChild(el('p', { class: 'empty', text: '現在のメニューを変更する理由は見つかりません' }));
    return;
  }

  for (const change of changes) {
    const base = effectiveMenu(change.day, {}, state.settings.weeklyPlan);
    const isApplied = !!applied[change.day] && applied[change.day].title === change.title;
    wrap.appendChild(
      el('div', { class: 'plan-change' }, [
        el('p', { class: 'plan-head', text: `${WEEKDAY_LABELS[change.day]}曜：${base.title} → ${change.title}` }),
        el('p', { class: 'section-note', text: `理由：${change.reason}` }),
        el('ul', { class: 'steps' }, change.steps.map((s) => el('li', {}, [el('div', { class: 'step' }, [el('span', { text: s })])]))),
        el('button', {
          class: isApplied ? 'btn-ghost btn-small' : 'btn-primary btn-small',
          style: 'width:100%',
          text: isApplied ? '適用中（元に戻す）' : 'この変更を週間メニューに適用する',
          onclick: () => togglePlanChange(change, isApplied),
        }),
      ])
    );
  }

  const appliedDays = Object.keys(applied);
  if (appliedDays.length) {
    wrap.appendChild(
      el('p', {
        class: 'section-note',
        text: `適用中：${appliedDays.map((d) => `${WEEKDAY_LABELS[Number(d)]}曜`).join('、')}。ホーム画面の今日のメニューに反映されます。`,
      })
    );
  }
}

function togglePlanChange(change, isApplied) {
  if (isApplied) {
    delete state.planOverrides[change.day];
    state.planOverridesUpdatedAt = new Date().toISOString();
    persist('元のメニューに戻しました');
  } else {
    state.planOverrides[change.day] = {
      title: change.title,
      minutes: change.minutes,
      purpose: change.purpose,
      steps: change.steps,
    };
    state.planOverridesUpdatedAt = new Date().toISOString();
    persist(`${WEEKDAY_LABELS[change.day]}曜のメニューを変更しました`);
  }
  renderAnalysis();
}

function renderDataRequests(requests) {
  const wrap = $('#an-data-requests');
  clear(wrap);
  if (!requests.length) {
    wrap.appendChild(el('p', { class: 'empty', text: '追加で取りたいデータはありません' }));
    return;
  }
  for (const request of requests) {
    const collected = state.collectedData?.[request.key];
    const input = el('input', { type: 'checkbox', ...(collected ? { checked: 'checked' } : {}) });
    input.addEventListener('change', () => {
      if (!state.collectedData) state.collectedData = {};
      if (input.checked) state.collectedData[request.key] = today;
      else delete state.collectedData[request.key];
      persist(input.checked ? '取得済みにしました' : '取得済みを解除しました');
      renderDiagnosis();
    });
    wrap.appendChild(
      el('div', { class: `data-request${collected ? ' collected' : ''}` }, [
        el('label', { class: 'step' }, [input, el('span', { text: request.title })]),
        el('p', { class: 'section-note', text: `取り方：${request.how}` }),
        el('p', { class: 'section-note', text: `目的：${request.why}` }),
        collected ? el('p', { class: 'inline-note', text: `取得済み（${formatShort(collected)}）` }) : null,
      ])
    );
  }
}

function renderCourseStats(stats) {
  const wrap = $('#an-course-stats');
  clear(wrap);
  if (!stats.length) {
    wrap.appendChild(el('p', { class: 'empty', text: 'ラウンド記録がありません' }));
    return;
  }
  for (const entry of stats) {
    const chips = [];
    if (entry.count) chips.push(chip('18H', `${entry.count}回`));
    if (entry.halfCount) chips.push(chip('9H', `${entry.halfCount}回`));
    if (entry.average !== null) chips.push(chip('平均', entry.average));
    if (entry.best !== null) chips.push(chip('ベスト', entry.best));
    if (entry.averagePutts !== null) chips.push(chip('平均パット', entry.averagePutts));
    if (entry.averageGir !== null) chips.push(chip('平均パーオン', `${entry.averageGir}/18`));
    if (entry.averageDifferential !== null) chips.push(chip('D平均', entry.averageDifferential));
    if (entry.courseRate === null) chips.push(el('span', { class: 'chip warn', text: 'CR未登録' }));
    else if (!entry.verified) chips.push(el('span', { class: 'chip warn', text: 'CR要確認' }));

    // 未入力の項目は行ごと出さない（0回と誤読させない）
    const detail = [
      entry.averagePenalties !== null ? `OB・1ペナ ${entry.averagePenalties}回` : null,
      entry.averageCarryShorts !== null ? `キャリー不足 ${entry.averageCarryShorts}回` : null,
      entry.averageShortSide !== null ? `ショートサイド ${entry.averageShortSide}回` : null,
      entry.averageTriple !== null ? `トリプル以上 ${entry.averageTriple}H` : null,
    ].filter(Boolean);

    const row = el('div', { class: 'course-row' }, [
      el('div', { class: 'course-row-head' }, [
        el('span', { class: 'course-name', text: entry.name }),
        entry.latest
          ? el('span', {
              class: 'chip',
              text:
                entry.latestDelta === null
                  ? `前回 ${entry.latest.totalScore}`
                  : `前回 ${entry.latest.totalScore}（${entry.latestDelta > 0 ? '+' : ''}${entry.latestDelta}）`,
            })
          : null,
      ]),
      el('div', { class: 'score-chips' }, chips),
    ]);
    if (detail.length) {
      row.appendChild(el('p', { class: 'section-note', text: `1ラウンド平均：${detail.join('／')}` }));
    }
    wrap.appendChild(row);
  }
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
      restWeekdays: state.settings.restWeekdays,
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

function importData(file, { fromSetup = false } = {}) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = importJSON(String(reader.result));
      const count = (incoming.rounds || []).length;
      if (
        !fromSetup &&
        !window.confirm(`バックアップの${count}ラウンドを取り込みます。今のデータと統合し、同じ記録は新しい方を残します。よろしいですか？`)
      ) {
        return;
      }
      // 置き換えではなく統合する（手元の入力が消えないようにする）
      state = mergeStates(state, incoming);
      state.setupDone = true;
      persist(`バックアップから${count}ラウンドを取り込みました`);
      $('#setup').hidden = true;
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
    state.daily[today] = stamp(rec);
    persist('メモを保存しました');
    renderMemoFeedback(state.daily[today]);
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
    state.settings = stamp({
      ...state.settings,
      startDate: start,
      targetScore: clamp(num($('#set-target').value, 85), 60, 120),
      firstStageAverage: clamp(num($('#set-first').value, 92), 60, 120),
    });
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
  $('#sc-course').addEventListener('change', (e) => {
    if (e.target.value === '__new') {
      e.target.value = '';
      $('#course-form-group').open = true;
      $('#course-form-group').scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('ゴルフ場を登録してから選択してください');
    }
    updateCourseNote();
  });
  $('#sc-save').addEventListener('click', saveRound);

  $('#co-save').addEventListener('click', saveCourse);
  $('#co-cancel').addEventListener('click', () => {
    clearCourseForm();
    toast('入力をクリアしました');
  });

  $('#bk-course').addEventListener('change', (e) => {
    if (e.target.value === '__new') {
      e.target.value = '';
      $('#course-form-group').open = true;
      $('#course-form-group').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  $('#bk-save').addEventListener('click', saveBooking);
  $('#bk-delete').addEventListener('click', () => {
    const booking = nextBooking(state, today);
    if (!booking) return toast('予約はありません', true);
    state.bookings = (state.bookings || []).filter((b) => b.id !== booking.id);
    persist('予約を取り消しました');
    renderScore();
    renderHome();
  });
  $('#sc-cancel').addEventListener('click', () => {
    clearScoreForm();
    toast('入力をクリアしました');
  });

  // 初回セットアップ
  $('#setup-restore').addEventListener('click', () => $('#setup-restore-file').click());
  $('#setup-restore-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importData(file, { fromSetup: true });
    e.target.value = '';
  });
  $('#setup-advice-on').addEventListener('click', () => {
    setupAnswers.adviceEnabled = true;
    renderAdviceChoice();
    showSetupPage(setupPage + 1);
  });
  $('#setup-advice-off').addEventListener('click', () => {
    setupAnswers.adviceEnabled = false;
    renderAdviceChoice();
    showSetupPage(setupPage + 1);
  });
  $('#advice-toggle').addEventListener('change', (e) => {
    state.settings = stamp({ ...state.settings, adviceEnabled: e.target.checked });
    persist(e.target.checked ? 'アドバイスを表示します' : '数値だけを表示します');
    renderAnalysis();
  });
  $('#open-consult').addEventListener('click', openConsult);
  $('#consult-close').addEventListener('click', closeConsult);
  $('#consult-reset').addEventListener('click', resetConsult);
  $('#consult-copy').addEventListener('click', copyConsultPrompt);

  $('#setup-next').addEventListener('click', () => {
    collectSetupPage();
    if (!validateSetupPage()) return;
    if (setupPage === SETUP_PAGES) finishSetup();
    else showSetupPage(setupPage + 1);
  });
  $('#setup-back').addEventListener('click', () => {
    collectSetupPage();
    if (setupPage === 1) return;
    showSetupPage(setupPage - 1);
  });
  $('#profile-reset').addEventListener('click', () => {
    if (!window.confirm('初期設定をやり直します。入力済みの記録はそのまま残ります。よろしいですか？')) return;
    state.setupDone = false;
    setupPage = 1;
    setupAnswers.name = state.profileName || '';
    saveState(state);
    updateSetupVisibility();
  });

  // クラウド設定
  $('#cloud-config-save').addEventListener('click', async () => {
    try {
      const config = cloud.parseConfig($('#cloud-config').value);
      cloud.saveConfig(config);
      toast('設定を保存しました。接続します');
      $('#cloud-setup-group').open = false;
      await startCloud();
    } catch (e) {
      toast(`設定を読み取れません：${e.message}`, true);
    }
  });
  $('#cloud-config-clear').addEventListener('click', () => {
    if (!window.confirm('クラウド設定を削除します。端末内のデータは残ります。よろしいですか？')) return;
    cloud.clearConfig();
    cloudUser = null;
    $('#cloud-config').value = '';
    renderCloudPanel();
    toast('クラウド設定を削除しました');
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
  updateSetupVisibility();
  showView(currentView());
  if (!canPersist) {
    toast('この端末では保存できない設定です（プライベートモードなど）', true);
  }
  // クラウドは設定済みのときだけ動く。失敗しても端末内保存で継続する。
  startCloud().catch((e) => console.warn('クラウド初期化に失敗しました', e));
  // index.html の起動チェック用。ここまで来れば画面は動いている。
  window.__trdGolfReady = true;
}

init();
