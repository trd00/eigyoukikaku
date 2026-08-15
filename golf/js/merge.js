// 端末間の同期でデータを統合する純関数。DOMにもネットワークにも触らない。
//
// 方針：全体を上書きせず、項目ごとに新しい方を採用する。
// 2台の端末が同時にオフラインで編集しても、片方の入力が丸ごと消えないようにするため。
// 例：iPhoneでスコアを追加、Chromebookで練習を記録 → 両方が残る。
//
// 各レコードは updatedAt（ISO文字列）を持つ。無い場合は「古い」として扱う。

/** 更新時刻を打つ */
export function stamp(record, now = new Date().toISOString()) {
  return { ...record, updatedAt: now };
}

function timeOf(record) {
  const t = record && record.updatedAt ? Date.parse(record.updatedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** 新しい方のレコードを返す。同時刻ならローカルを優先（入力直後の取りこぼしを防ぐ） */
function newer(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  return timeOf(remote) > timeOf(local) ? remote : local;
}

/** id をキーにした配列の統合 */
export function mergeById(localList = [], remoteList = [], key = 'id') {
  const map = new Map();
  for (const item of localList) map.set(item[key], item);
  for (const item of remoteList) {
    const existing = map.get(item[key]);
    map.set(item[key], newer(existing, item));
  }
  return [...map.values()];
}

/** キー付きオブジェクト（日付→記録 など）の統合 */
export function mergeByKey(localMap = {}, remoteMap = {}) {
  const out = { ...localMap };
  for (const [key, remoteItem] of Object.entries(remoteMap || {})) {
    out[key] = newer(localMap ? localMap[key] : null, remoteItem);
  }
  return out;
}

/** 削除済みID等、和集合でよいもの */
function union(a = [], b = []) {
  return [...new Set([...(a || []), ...(b || [])])];
}

/**
 * ローカルとクラウドの状態を統合する。
 * settings のような単一オブジェクトは updatedAt の新しい方を丸ごと採用する。
 */
export function mergeStates(local, remote) {
  if (!remote) return local;
  if (!local) return remote;

  const settings = newer(local.settings, remote.settings);
  const planOverrides = newer(
    { ...local.planOverrides, updatedAt: local.planOverridesUpdatedAt },
    { ...remote.planOverrides, updatedAt: remote.planOverridesUpdatedAt }
  );
  delete planOverrides.updatedAt;

  return {
    ...local,
    version: Math.max(local.version || 1, remote.version || 1),
    settings,
    daily: mergeByKey(local.daily, remote.daily),
    range: mergeByKey(local.range, remote.range),
    carry: mergeByKey(local.carry, remote.carry),
    rounds: mergeById(local.rounds, remote.rounds),
    courses: mergeById(local.courses, remote.courses),
    bookings: mergeById(local.bookings, remote.bookings),
    hiddenSeedIds: union(local.hiddenSeedIds, remote.hiddenSeedIds),
    collectedData: { ...remote.collectedData, ...local.collectedData },
    planOverrides,
    planOverridesUpdatedAt:
      timeOf({ updatedAt: remote.planOverridesUpdatedAt }) > timeOf({ updatedAt: local.planOverridesUpdatedAt })
        ? remote.planOverridesUpdatedAt
        : local.planOverridesUpdatedAt,
    // 履歴を引き継ぐ設定は、一度決めたら端末間で揃える
    useSeedData: remote.useSeedData ?? local.useSeedData,
    profileName: local.profileName || remote.profileName,
  };
}

/**
 * 同期が必要かどうか。無駄な書き込みを避ける。
 */
export function hasChanges(a, b) {
  return JSON.stringify(stripVolatile(a)) !== JSON.stringify(stripVolatile(b));
}

function stripVolatile(state) {
  if (!state) return state;
  const { syncedAt, ...rest } = state;
  return rest;
}
