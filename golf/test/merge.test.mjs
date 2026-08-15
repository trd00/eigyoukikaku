// node --test golf/test/merge.test.mjs
// 端末間同期の統合ロジック。ここが壊れると入力が消えるため、重点的に検証する。

import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeById, mergeByKey, mergeStates, stamp, hasChanges } from '../js/merge.js';

const OLD = '2026-08-01T00:00:00.000Z';
const NEW = '2026-08-10T00:00:00.000Z';

test('stamp は更新時刻を打つ', () => {
  const r = stamp({ id: 'a' }, NEW);
  assert.equal(r.updatedAt, NEW);
  assert.equal(r.id, 'a');
});

test('mergeById：両方にしかない項目は両方残る', () => {
  const local = [{ id: 'a', v: 1 }];
  const remote = [{ id: 'b', v: 2 }];
  const merged = mergeById(local, remote);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((r) => r.id).sort(), ['a', 'b']);
});

test('mergeById：同じIDは更新時刻が新しい方を採用', () => {
  const local = [{ id: 'a', v: 'local', updatedAt: OLD }];
  const remote = [{ id: 'a', v: 'remote', updatedAt: NEW }];
  assert.equal(mergeById(local, remote)[0].v, 'remote');
  assert.equal(mergeById(remote, local)[0].v, 'remote');
});

test('mergeById：更新時刻が同じならローカルを優先する', () => {
  const local = [{ id: 'a', v: 'local', updatedAt: NEW }];
  const remote = [{ id: 'a', v: 'remote', updatedAt: NEW }];
  assert.equal(mergeById(local, remote)[0].v, 'local');
});

test('mergeById：更新時刻が無い側は古いものとして扱う', () => {
  const local = [{ id: 'a', v: 'no-stamp' }];
  const remote = [{ id: 'a', v: 'stamped', updatedAt: OLD }];
  assert.equal(mergeById(local, remote)[0].v, 'stamped');
});

test('mergeByKey：日付ごとの記録が両方残る', () => {
  const local = { '2026-08-01': { status: 'done', updatedAt: NEW } };
  const remote = { '2026-08-02': { status: 'rest', updatedAt: NEW } };
  const merged = mergeByKey(local, remote);
  assert.equal(Object.keys(merged).length, 2);
  assert.equal(merged['2026-08-01'].status, 'done');
  assert.equal(merged['2026-08-02'].status, 'rest');
});

test('mergeByKey：同じ日付は新しい方を採用', () => {
  const local = { '2026-08-01': { status: 'missed', updatedAt: OLD } };
  const remote = { '2026-08-01': { status: 'done', updatedAt: NEW } };
  assert.equal(mergeByKey(local, remote)['2026-08-01'].status, 'done');
});

test('2台で別々に編集した内容が両方残る（同期の中心的な要件）', () => {
  // iPhoneでスコアを追加
  const iphone = {
    version: 2,
    settings: { startDate: '2026-08-01', targetScore: 85, updatedAt: OLD },
    daily: { '2026-08-10': { date: '2026-08-10', status: 'done', updatedAt: NEW } },
    range: {},
    carry: { '7I': { club: '7I', normalCarry: 138, updatedAt: OLD } },
    rounds: [{ id: 'r1', totalScore: 91, updatedAt: NEW }],
    courses: [],
    bookings: [],
    hiddenSeedIds: ['seed-01'],
    collectedData: {},
    planOverrides: {},
  };
  // Chromebookで練習とキャリーを記録
  const chromebook = {
    version: 2,
    settings: { startDate: '2026-08-01', targetScore: 85, updatedAt: OLD },
    daily: { '2026-08-11': { date: '2026-08-11', status: 'partial', updatedAt: NEW } },
    range: { '2026-08-11': { date: '2026-08-11', sevenIronGood: 12, updatedAt: NEW } },
    carry: { '7I': { club: '7I', normalCarry: 141, updatedAt: NEW } },
    rounds: [],
    courses: [],
    bookings: [],
    hiddenSeedIds: ['seed-02'],
    collectedData: {},
    planOverrides: {},
  };

  const merged = mergeStates(iphone, chromebook);
  assert.equal(merged.rounds.length, 1, 'iPhoneで足したスコアが消えた');
  assert.equal(Object.keys(merged.daily).length, 2, '練習記録が片方消えた');
  assert.equal(merged.range['2026-08-11'].sevenIronGood, 12, 'Chromebookの練習記録が消えた');
  assert.equal(merged.carry['7I'].normalCarry, 141, '新しいキャリー実測が反映されていない');
  assert.deepEqual(merged.hiddenSeedIds.sort(), ['seed-01', 'seed-02']);
});

test('設定は新しい方をまとめて採用する', () => {
  const local = { settings: { targetScore: 85, updatedAt: OLD }, daily: {}, rounds: [] };
  const remote = { settings: { targetScore: 82, updatedAt: NEW }, daily: {}, rounds: [] };
  assert.equal(mergeStates(local, remote).settings.targetScore, 82);
});

test('クラウド側が空でもローカルは消えない', () => {
  const local = {
    settings: { targetScore: 85 },
    daily: { '2026-08-10': { status: 'done', updatedAt: NEW } },
    rounds: [{ id: 'r1', updatedAt: NEW }],
    carry: {},
    range: {},
    courses: [],
    bookings: [],
  };
  const merged = mergeStates(local, null);
  assert.equal(merged.rounds.length, 1);
  assert.equal(Object.keys(merged.daily).length, 1);
});

test('履歴を引き継ぐ設定は端末間で揃える', () => {
  const local = { useSeedData: null, settings: {}, daily: {}, rounds: [] };
  const remote = { useSeedData: false, settings: {}, daily: {}, rounds: [] };
  assert.equal(mergeStates(local, remote).useSeedData, false);
});

test('練習プランの変更は新しい方の内容で置き換える', () => {
  const local = {
    settings: {},
    daily: {},
    rounds: [],
    planOverrides: { 4: { title: '古い' } },
    planOverridesUpdatedAt: OLD,
  };
  const remote = {
    settings: {},
    daily: {},
    rounds: [],
    planOverrides: { 4: { title: '新しい' } },
    planOverridesUpdatedAt: NEW,
  };
  const merged = mergeStates(local, remote);
  assert.equal(merged.planOverrides[4].title, '新しい');
  assert.equal(merged.planOverrides.updatedAt, undefined, 'updatedAtが混入している');
});

test('hasChanges：中身が同じなら書き込まない', () => {
  const a = { settings: { targetScore: 85 }, syncedAt: '2026-08-01T00:00:00Z' };
  const b = { settings: { targetScore: 85 }, syncedAt: '2026-08-14T00:00:00Z' };
  assert.equal(hasChanges(a, b), false);
  assert.equal(hasChanges(a, { settings: { targetScore: 82 } }), true);
});

// ---------------------------------------------------------------------------
// Firebase設定の読み取り（コンソールからの貼り付けを想定）
// ---------------------------------------------------------------------------

test('parseConfig：JSON形式を読み取る', async () => {
  const { parseConfig } = await import('../js/cloud.js');
  const c = parseConfig('{"apiKey":"A","authDomain":"d","projectId":"p","appId":"x"}');
  assert.equal(c.projectId, 'p');
});

test('parseConfig：コンソールのconst宣言をそのまま貼っても読み取る', async () => {
  const { parseConfig } = await import('../js/cloud.js');
  const text = `const firebaseConfig = {
    apiKey: "AIzaSyTest",
    authDomain: "trd-golf.firebaseapp.com",
    projectId: "trd-golf",
    storageBucket: "trd-golf.appspot.com",
    messagingSenderId: "123",
    appId: "1:123:web:abc",
  };`;
  const c = parseConfig(text);
  assert.equal(c.apiKey, 'AIzaSyTest');
  assert.equal(c.projectId, 'trd-golf');
  assert.equal(c.appId, '1:123:web:abc');
});

test('parseConfig：不足や不正は例外にする', async () => {
  const { parseConfig } = await import('../js/cloud.js');
  assert.throws(() => parseConfig(''), /空/);
  assert.throws(() => parseConfig('ただの文字列'), /形式/);
  assert.throws(() => parseConfig('{"apiKey":"A"}'), /見つかりません/);
});
