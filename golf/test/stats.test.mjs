// node --test golf/test/
// 集計ロジックと初期データが要件定義書の受入条件を満たすことを確認する。

import test from 'node:test';
import assert from 'node:assert/strict';

import { SEED_ROUNDS } from '../js/seed.js';
import {
  practiceStats,
  roundStats,
  girRate,
  bogeyOnRate,
  recent,
  averageScore,
  averagePutts,
  filterByYear,
  threePuttAfterGirRate,
  movingAverage,
  scoreSeries,
} from '../js/stats.js';
import { projectDay, diffDays, addDays, weekday, todayJST, dateRange } from '../js/date.js';
import { buildAdvice } from '../js/advice.js';

// ---------------------------------------------------------------------------
// 初期投入ラウンドデータ（要件9 / 受入条件15）
// ---------------------------------------------------------------------------

test('初期データは19ラウンド', () => {
  assert.equal(SEED_ROUNDS.length, 19);
});

test('OUT+IN と totalScore が一致する', () => {
  for (const r of SEED_ROUNDS) {
    assert.equal(r.outScore + r.inScore, r.totalScore, `${r.id} の合計が不一致`);
  }
});

test('全19ラウンド平均は約92.5', () => {
  assert.equal(averageScore(SEED_ROUNDS), 92.5);
});

test('2026年の11ラウンド平均は約93.4', () => {
  const rounds2026 = filterByYear(SEED_ROUNDS, 2026);
  assert.equal(rounds2026.length, 11);
  assert.equal(averageScore(rounds2026), 93.4);
});

test('直近5ラウンド平均は92.6', () => {
  assert.equal(averageScore(recent(SEED_ROUNDS, 5)), 92.6);
});

test('ベスト87 / ワースト100', () => {
  const s = roundStats(SEED_ROUNDS);
  assert.equal(s.bestScore, 87);
  assert.equal(s.worstScore, 100);
});

test('平均パットは全期間34.9 / 直近5R 38.6', () => {
  assert.equal(averagePutts(SEED_ROUNDS), 34.9);
  assert.equal(averagePutts(recent(SEED_ROUNDS, 5)), 38.6);
});

test('パーオン率は全期間19.9% / 直近5R 31.1%', () => {
  assert.equal(girRate(SEED_ROUNDS), 19.9);
  assert.equal(girRate(recent(SEED_ROUNDS, 5)), 31.1);
});

test('ボギーオン率は全期間70.2% / 直近5R 76.7%', () => {
  assert.equal(bogeyOnRate(SEED_ROUNDS), 70.2);
  assert.equal(bogeyOnRate(recent(SEED_ROUNDS, 5)), 76.7);
});

test('ボギーオン（以内）はパーオン以上18以下', () => {
  for (const r of SEED_ROUNDS) {
    assert.ok(r.bogeyOn >= r.greensInRegulation, `${r.id}: ボギーオン < パーオン`);
    assert.ok(r.bogeyOn <= 18, `${r.id}: ボギーオンが18超`);
    assert.ok(r.threePuttsAfterGIR <= r.greensInRegulation, `${r.id}: パーオン後3パットがパーオン数超`);
    assert.ok(r.threePuttsAfterGIR <= r.threePutts, `${r.id}: パーオン後3パットが3パット数超`);
  }
});

test('初期データの期間は2025-09-28〜2026-08-12', () => {
  const dates = SEED_ROUNDS.map((r) => r.date).sort();
  assert.equal(dates[0], '2025-09-28');
  assert.equal(dates[dates.length - 1], '2026-08-12');
});

// ---------------------------------------------------------------------------
// 計算ルール（要件7）
// ---------------------------------------------------------------------------

test('経過日数：開始日当日は1', () => {
  assert.equal(projectDay('2026-08-13', '2026-08-13'), 1);
  assert.equal(projectDay('2026-08-13', '2026-08-20'), 8);
});

test('日付計算は月またぎ・年またぎでもずれない', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01'); // 2026年は平年
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); // うるう年
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(diffDays('2026-03-01', '2026-02-01'), 28);
  assert.equal(dateRange('2026-08-01', '2026-08-03').length, 3);
});

test('曜日判定：2026-08-13は木曜', () => {
  assert.equal(weekday('2026-08-13'), 4);
  assert.equal(weekday('2026-08-17'), 1); // 月曜=完全休養
});

test('todayJSTはYYYY-MM-DD形式', () => {
  assert.match(todayJST(), /^\d{4}-\d{2}-\d{2}$/);
});

test('実施日：完了と一部だけ実施を数え、同一日は重複しない', () => {
  const s = practiceStats({
    startDate: '2026-08-04', // 火
    today: '2026-08-08', // 土
    records: [
      { date: '2026-08-04', status: 'done' },
      { date: '2026-08-05', status: 'partial' },
      { date: '2026-08-06', status: 'done' },
      { date: '2026-08-07', status: 'done' },
      { date: '2026-08-08', status: 'done' },
    ],
  });
  assert.equal(s.doneDays, 5);
  assert.equal(s.missedDays, 0);
  assert.equal(s.achievementRate, 100);
});

test('完全休養日（月曜）は未実施にも分母にも含めない', () => {
  const s = practiceStats({
    startDate: '2026-08-10', // 月
    today: '2026-08-12', // 水
    records: [{ date: '2026-08-11', status: 'done' }],
  });
  assert.equal(s.restDays, 1); // 月曜
  assert.equal(s.doneDays, 1); // 火曜
  assert.equal(s.missedDays, 0); // 水曜は当日なので未実施にしない
  assert.equal(s.achievementRate, 100);
});

test('過去日の未記録は未実施として集計される', () => {
  const s = practiceStats({
    startDate: '2026-08-04', // 火
    today: '2026-08-08', // 土
    records: [{ date: '2026-08-04', status: 'done' }],
  });
  // 8/5水 8/6木 8/7金 が未実施、8/8土は当日なので除外
  assert.equal(s.missedDays, 3);
  assert.equal(s.doneDays, 1);
  assert.equal(s.achievementRate, 25);
});

test('当日は記録がなくても未実施に含めないが、できなかったを選べば含める', () => {
  const base = { startDate: '2026-08-12', today: '2026-08-12' };
  assert.equal(practiceStats({ ...base, records: [] }).missedDays, 0);
  assert.equal(
    practiceStats({ ...base, records: [{ date: '2026-08-12', status: 'missed' }] }).missedDays,
    1
  );
});

test('休養記録は分母から除外される', () => {
  const s = practiceStats({
    startDate: '2026-08-04',
    today: '2026-08-07',
    records: [
      { date: '2026-08-04', status: 'done' },
      { date: '2026-08-05', status: 'rest' },
      { date: '2026-08-06', status: 'rest' },
    ],
  });
  assert.equal(s.doneDays, 1);
  assert.equal(s.restDays, 2);
  assert.equal(s.missedDays, 0);
  assert.equal(s.achievementRate, 100);
});

test('達成率は四捨五入した整数', () => {
  const s = practiceStats({
    startDate: '2026-08-04', // 火
    today: '2026-08-10', // 月（休養）
    records: [
      { date: '2026-08-04', status: 'done' },
      { date: '2026-08-05', status: 'done' },
      { date: '2026-08-06', status: 'missed' },
      { date: '2026-08-07', status: 'missed' },
      { date: '2026-08-08', status: 'missed' },
      { date: '2026-08-09', status: 'missed' },
    ],
  });
  // 実施2 / 未実施4 → 33.33% → 33
  assert.equal(s.achievementRate, 33);
});

test('from/to で月別に絞り込める（過去月の月末も未実施として数える）', () => {
  const records = [
    { date: '2026-07-28', status: 'done' },
    { date: '2026-08-04', status: 'done' },
  ];
  const july = practiceStats({
    startDate: '2026-07-27', // 月（休養）
    records,
    today: '2026-08-13',
    from: '2026-07-01',
    to: '2026-07-31',
  });
  // 7/27休養、7/28実施、7/29〜7/31の3日が未実施
  assert.equal(july.doneDays, 1);
  assert.equal(july.restDays, 1);
  assert.equal(july.missedDays, 3);
  assert.equal(july.achievementRate, 25);
});

test('未来の月を指定すると集計は0件', () => {
  const s = practiceStats({
    startDate: '2026-08-01',
    records: [],
    today: '2026-08-13',
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.equal(s.doneDays, 0);
  assert.equal(s.missedDays, 0);
  assert.equal(s.achievementRate, null);
});

test('開始日より前の記録は集計に影響しない', () => {
  const s = practiceStats({
    startDate: '2026-08-05',
    today: '2026-08-06',
    records: [
      { date: '2026-08-01', status: 'done' },
      { date: '2026-08-05', status: 'done' },
    ],
  });
  assert.equal(s.doneDays, 1);
});

test('パーオン後3パット率：パーオン0なら null', () => {
  const zero = [{ greensInRegulation: 0, threePuttsAfterGIR: 0 }];
  assert.equal(threePuttAfterGirRate(zero), null);
});

// ---------------------------------------------------------------------------
// 分析・助言
// ---------------------------------------------------------------------------

test('新規スコアを足すと平均・ベスト・推移が再計算される', () => {
  const added = [
    ...SEED_ROUNDS,
    {
      id: 'u1',
      date: '2026-08-20',
      totalScore: 83,
      putts: 32,
      greensInRegulation: 8,
      bogeyOn: 15,
      penalties: 1,
      threePutts: 2,
      threePuttsAfterGIR: 1,
      shortSideMisses: 1,
      carryShorts: 1,
      strategyErrors: 1,
      tripleOrWorse: 0,
    },
  ];
  const s = roundStats(added);
  assert.equal(s.count, 20);
  assert.equal(s.bestScore, 83);
  assert.ok(s.averageScore < 92.5);
  assert.equal(scoreSeries(added).at(-1).value, 83);
  assert.equal(movingAverage(scoreSeries(added), 3).length, 20);
});

test('助言：パーオン率が高くパーオン後3パットが多いとロングパットを優先', () => {
  const stats = roundStats(recent(SEED_ROUNDS, 5));
  const msgs = buildAdvice({
    stats,
    latestRound: SEED_ROUNDS.at(-1),
    practiceRate: 90,
    rangeStats: {},
  });
  assert.ok(msgs.some((m) => m.key === 'long-putt'));
});

test('助言：実施率50%未満なら再開しやすさを最優先で提示', () => {
  const msgs = buildAdvice({
    stats: roundStats(SEED_ROUNDS),
    latestRound: null,
    practiceRate: 20,
    rangeStats: {},
  });
  assert.equal(msgs[0].key, 'practice-restart');
});

test('助言：ユーザーを責める表現を含まない', () => {
  const ng = ['サボ', 'ダメ', '怠', '悪い', '失敗です'];
  const msgs = buildAdvice({
    stats: roundStats(SEED_ROUNDS),
    latestRound: SEED_ROUNDS.at(-1),
    practiceRate: 10,
    rangeStats: { carryShortTotal: 5, shortSideTotal: 4 },
  });
  for (const m of msgs) {
    for (const word of ng) {
      assert.ok(!m.title.includes(word) && !m.body.includes(word), `禁止表現: ${word}`);
    }
  }
});
