// node --test golf/test/insights.test.mjs
// 練習メモとラウンドの記述から傾向を取り出す部分。
// メモはこのアプリで最も情報量が多い記録のため、扱いを誤らないよう検証する。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  THEMES,
  themesOf,
  themeCounts,
  recurringThemes,
  focusFollowUp,
  buildMemoInsights,
  describeTheme,
  memoEntries,
} from '../js/insights.js';
import { buildDiagnosis } from '../js/diagnose.js';
import { SAMPLE_COURSES, ROUNDS_NO_DETAIL } from './fixtures.mjs';

const TODAY = '2026-08-15';

function memo(date, text, extra = {}) {
  return { date, memo: text, status: 'done', ...extra };
}

test('メモから話題を拾う', () => {
  assert.deepEqual(themesOf('ゆっくり素振りする事を意識した そうすると軌道が確認できた'), ['path', 'tempo']);
  assert.deepEqual(themesOf('ボール位置が右寄り'), ['address']);
  assert.deepEqual(themesOf('7番のキャリーが届かない'), ['distance']);
  assert.deepEqual(themesOf(''), []);
  assert.deepEqual(themesOf('特になし'), []);
});

test('話題の定義に重複や空がない', () => {
  const keys = THEMES.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(THEMES.every((t) => t.label && t.words.length));
});

test('期間内のメモを話題ごとに数える', () => {
  const records = [
    memo('2026-08-10', 'ボール位置を確認'),
    memo('2026-08-12', 'ボール位置が安定してきた'),
    memo('2026-08-14', 'パットの距離感'),
    memo('2026-07-01', 'ボール位置'), // 期間外
  ];
  const counts = themeCounts(records, { from: '2026-08-01', to: TODAY });
  assert.equal(counts[0].key, 'address');
  assert.equal(counts[0].count, 2);
  assert.deepEqual(counts[0].dates, ['2026-08-10', '2026-08-12']);
  assert.equal(counts.find((c) => c.key === 'putt').count, 1);
});

test('繰り返す話題は、直前の同じ期間と比べて増減を出す', () => {
  const records = [
    // 直近21日
    memo('2026-08-14', 'ボール位置がまた右になっていた'),
    memo('2026-08-12', 'ボール位置を意識'),
    memo('2026-08-10', 'ボール位置の確認から入った'),
    // その前の21日
    memo('2026-07-20', 'ボール位置'),
  ];
  const themes = recurringThemes(records, TODAY, { windowDays: 21 });
  const address = themes.find((t) => t.key === 'address');
  assert.equal(address.count, 3);
  assert.equal(address.previousCount, 1);
  assert.equal(address.trend, 'up');
  assert.equal(address.lastDate, '2026-08-14');
  assert.match(describeTheme(address), /増えている/);
});

test('1回だけの話題は繰り返しとして扱わない', () => {
  const records = [memo('2026-08-14', 'パットの距離感')];
  assert.equal(recurringThemes(records, TODAY).length, 0);
});

test('前回ラウンドの課題が練習に現れているかを判定する', () => {
  const rounds = [
    { id: 'r1', date: '2026-08-01', totalScore: 95, holes: 18, nextFocus: 'ボール位置を毎回確認する' },
  ];
  const records = [
    memo('2026-08-05', 'ボール位置をクラブで確認した'),
    memo('2026-08-08', 'ボール位置は良かった'),
    memo('2026-08-10', 'パットの練習'),
  ];
  const follow = focusFollowUp({ rounds, records, today: TODAY });
  assert.equal(follow.focusText, 'ボール位置を毎回確認する');
  assert.deepEqual(follow.themes.map((t) => t.key), ['address']);
  assert.equal(follow.memosSince, 3);
  assert.equal(follow.matchedCount, 2);
  assert.equal(follow.lastMatchedDate, '2026-08-08');
});

test('課題に触れていない場合は0件として返す', () => {
  const rounds = [{ id: 'r1', date: '2026-08-01', totalScore: 95, holes: 18, nextFocus: 'パットの距離感' }];
  const records = [memo('2026-08-05', '素振りをした'), memo('2026-08-08', 'ドライバーが曲がる')];
  const follow = focusFollowUp({ rounds, records, today: TODAY });
  assert.equal(follow.matchedCount, 0);
  assert.equal(follow.memosSince, 2);
});

test('次回の課題が書かれていなければ判定しない', () => {
  const rounds = [{ id: 'r1', date: '2026-08-01', totalScore: 95, holes: 18, nextFocus: '' }];
  assert.equal(focusFollowUp({ rounds, records: [], today: TODAY }), null);
});

test('メモが少ないうちは傾向として扱わない', () => {
  const records = [memo('2026-08-14', 'ボール位置'), memo('2026-08-13', 'ボール位置')];
  const insights = buildMemoInsights({ records, rounds: [], today: TODAY });
  assert.equal(insights.totalMemos, 2);
  assert.equal(insights.hasEnough, false);
});

test('メモ一覧は新しい順に返る', () => {
  const records = [memo('2026-08-10', 'a'), memo('2026-08-14', 'b'), memo('2026-08-12', 'c')];
  assert.deepEqual(memoEntries(records).map((r) => r.memo), ['b', 'c', 'a']);
  assert.equal(memoEntries(records, 2).length, 2);
});

// ---------------------------------------------------------------------------
// 診断への反映
// ---------------------------------------------------------------------------

function diagnose(records, rounds = ROUNDS_NO_DETAIL) {
  return buildDiagnosis({
    rounds,
    courses: SAMPLE_COURSES,
    practice: { achievementRate: 70, doneDays: 7, missedDays: 3, restDays: 2 },
    rangeStats: { count: 1 },
    settings: { targetScore: 90 },
    records,
    today: TODAY,
  });
}

test('診断：同じ話題を繰り返していれば改善点として出す', () => {
  const records = [
    memo('2026-08-14', 'ボール位置がまた右になっていた'),
    memo('2026-08-12', 'ボール位置を意識した'),
    memo('2026-08-10', 'ボール位置の確認から入った'),
    memo('2026-08-08', '素振り'),
  ];
  const d = diagnose(records);
  const finding = d.findings.find((f) => f.key === 'memo-recurring');
  assert.ok(finding, 'メモからの指摘がない');
  assert.equal(finding.level, 'improve');
  assert.match(finding.reading, /定着していない/);
  assert.match(finding.action, /ボール位置/);
});

test('診断：前回の課題が練習に現れていなければ指摘する', () => {
  const rounds = [
    { id: 'r1', date: '2026-08-01', totalScore: 95, putts: 34, holes: 18, penalties: 0, nextFocus: 'パットの距離感' },
  ];
  const records = [memo('2026-08-05', '素振りをした'), memo('2026-08-08', 'ドライバーの練習')];
  const d = diagnose(records, rounds);
  const finding = d.findings.find((f) => f.key === 'focus-not-practiced');
  assert.ok(finding, '課題の引き継ぎの指摘がない');
  assert.match(finding.fact, /パットの距離感/);
  assert.match(finding.action, /1項目目/);
});

test('診断：課題が練習に現れていれば維持として扱う', () => {
  const rounds = [
    { id: 'r1', date: '2026-08-01', totalScore: 95, putts: 34, holes: 18, penalties: 0, nextFocus: 'パットの距離感' },
  ];
  const records = [memo('2026-08-05', 'パットの距離感を10m中心に'), memo('2026-08-08', 'パター練習')];
  const d = diagnose(records, rounds);
  const finding = d.findings.find((f) => f.key === 'focus-practiced');
  assert.ok(finding);
  assert.equal(finding.level, 'keep');
});

test('診断：メモが無ければ気になるポイントで知らせる', () => {
  const d = diagnose([]);
  assert.ok(d.watchPoints.some((w) => w.title.includes('練習メモが未記録')));
});

test('診断：メモからの指摘にも励ましや叱責を入れない', () => {
  const ng = ['すごい', '素晴らしい', '完璧', '最高', 'さすが', 'ダメ', 'サボ', '怠', '甘い'];
  const records = [
    memo('2026-08-14', 'ボール位置がまた右'),
    memo('2026-08-12', 'ボール位置'),
    memo('2026-08-10', 'ボール位置'),
  ];
  const d = diagnose(records);
  const texts = [
    ...d.findings.flatMap((f) => [f.fact, f.reading, f.action || '']),
    ...d.watchPoints.flatMap((w) => [w.title, w.body]),
  ];
  for (const text of texts) {
    for (const word of ng) assert.ok(!text.includes(word), `禁止表現「${word}」: ${text}`);
  }
});
