// localStorage永続化。端末内のみに保存し、外部へは送信しない（要件2.1/12）。
// SSR/localStorage不可（プライベートモード等）でも例外で落ちないようにする（要件17）。

import { SEED_CARRY, SEED_ROUNDS } from './seed.js';
import { SEED_COURSES } from './courses.js';
import { todayJST } from './date.js';

const STORAGE_KEY = 'trdgolf.v1';
const SCHEMA_VERSION = 2;

/** localStorageが使えるか（SSR・プライベートモード対策） */
function storageAvailable() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const probe = '__trdgolf_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export const canPersist = storageAvailable();

/** 保存できない環境でもアプリが動くようメモリへ退避する */
let memoryFallback = null;

export function defaultState(today = todayJST()) {
  return {
    version: SCHEMA_VERSION,
    // 誰のデータとして使うか。null＝初回の選択がまだ。
    // true＝てらちゃんの履歴（初期36ラウンド）を引き継ぐ／false＝空から始める
    useSeedData: null,
    profileName: '',
    settings: {
      startDate: today,
      targetScore: 85,
      firstStageAverage: 92,
    },
    daily: {},
    carry: SEED_CARRY.reduce((acc, c) => {
      acc[c.club] = { ...c, measuredAt: '', maxCarry: null, sampleCount: null, memo: '' };
      return acc;
    }, {}),
    range: {},
    rounds: [],
    hiddenSeedIds: [],
    // ゴルフ場マスタ。初期値のコースレートは仮の値（verified:false）。
    courses: SEED_COURSES.map((c) => ({ ...c })),
    // 予約したラウンド（次回の予定）
    bookings: [],
    // 診断から適用した週間メニューの変更（曜日番号 → メニュー）
    planOverrides: {},
    // 取得済みにした計測データ項目
    collectedData: {},
  };
}

function migrate(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  // v1（コースマスタなし）から移行しても初期コースは失わない
  const courses = Array.isArray(raw.courses) && raw.courses.length ? raw.courses : base.courses;

  return {
    version: SCHEMA_VERSION,
    settings: { ...base.settings, ...(raw.settings || {}) },
    daily: raw.daily && typeof raw.daily === 'object' ? raw.daily : {},
    carry: { ...base.carry, ...(raw.carry || {}) },
    range: raw.range && typeof raw.range === 'object' ? raw.range : {},
    rounds: Array.isArray(raw.rounds) ? raw.rounds : [],
    hiddenSeedIds: Array.isArray(raw.hiddenSeedIds) ? raw.hiddenSeedIds : [],
    courses,
    bookings: Array.isArray(raw.bookings) ? raw.bookings : [],
    planOverrides: raw.planOverrides && typeof raw.planOverrides === 'object' ? raw.planOverrides : {},
    planOverridesUpdatedAt: raw.planOverridesUpdatedAt || null,
    collectedData: raw.collectedData && typeof raw.collectedData === 'object' ? raw.collectedData : {},
    // 既存の利用者（すでにデータがある端末）は初期履歴ありのまま維持する
    useSeedData: raw.useSeedData === undefined || raw.useSeedData === null ? true : raw.useSeedData,
    profileName: raw.profileName || '',
    cloudUid: raw.cloudUid || null,
    syncedAt: raw.syncedAt || null,
  };
}

export function loadState() {
  if (!canPersist) return memoryFallback ? migrate(memoryFallback) : defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('保存データの読み込みに失敗したため初期状態で開始します', e);
    return defaultState();
  }
}

/** @returns {{ok:boolean, error?:string}} */
export function saveState(state) {
  memoryFallback = state;
  if (!canPersist) return { ok: false, error: 'この環境では端末に保存できません（入力は画面を閉じるまで有効）' };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '端末の保存容量が不足している可能性があります' };
  }
}

/**
 * seedとユーザー追加ラウンドを同じ型で1本のリストにする（要件17）。
 */
export function allRounds(state) {
  const user = (state.rounds || []).map((r) => ({ ...r, source: r.source || 'user' }));
  // 「空から始める」を選んだ利用者には、てらちゃんの初期履歴を混ぜない
  if (state.useSeedData === false) return user;
  const hidden = new Set(state.hiddenSeedIds || []);
  const seeds = SEED_ROUNDS.filter((r) => !hidden.has(r.id));
  return [...seeds, ...user];
}

export function dailyList(state) {
  return Object.values(state.daily || {});
}

export function rangeList(state) {
  return Object.values(state.range || {});
}

export function courseList(state) {
  return state.courses || [];
}

/** 今日以降でもっとも近い予約（次のラウンド） */
export function nextBooking(state, today) {
  return (state.bookings || [])
    .filter((b) => b.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
}

/** JSONバックアップ書き出し（要件14 優先案1） */
export function exportJSON(state) {
  return JSON.stringify(
    {
      app: 'TRD GOLF PROJECT',
      exportedAt: new Date().toISOString(),
      ...state,
    },
    null,
    2
  );
}

/** JSONバックアップ読み込み。壊れたファイルは取り込まない */
export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('形式が正しくありません');
  return migrate(parsed);
}

export function newId(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}
