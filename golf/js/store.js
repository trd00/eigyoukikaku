// localStorage永続化。端末内のみに保存し、外部へは送信しない（要件2.1/12）。
// SSR/localStorage不可（プライベートモード等）でも例外で落ちないようにする（要件17）。

import { SEED_CARRY, SEED_ROUNDS } from './seed.js';
import { todayJST } from './date.js';

const STORAGE_KEY = 'trdgolf.v1';
const SCHEMA_VERSION = 1;

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
  };
}

function migrate(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    version: SCHEMA_VERSION,
    settings: { ...base.settings, ...(raw.settings || {}) },
    daily: raw.daily && typeof raw.daily === 'object' ? raw.daily : {},
    carry: { ...base.carry, ...(raw.carry || {}) },
    range: raw.range && typeof raw.range === 'object' ? raw.range : {},
    rounds: Array.isArray(raw.rounds) ? raw.rounds : [],
    hiddenSeedIds: Array.isArray(raw.hiddenSeedIds) ? raw.hiddenSeedIds : [],
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
  const hidden = new Set(state.hiddenSeedIds || []);
  const seeds = SEED_ROUNDS.filter((r) => !hidden.has(r.id));
  const user = (state.rounds || []).map((r) => ({ ...r, source: r.source || 'user' }));
  return [...seeds, ...user];
}

export function dailyList(state) {
  return Object.values(state.daily || {});
}

export function rangeList(state) {
  return Object.values(state.range || {});
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
