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
  round1,
  scoreSeries,
} from '../js/stats.js';
import { projectDay, diffDays, addDays, weekday, todayJST, dateRange } from '../js/date.js';
import { SEED_COURSES } from '../js/courses.js';
import {
  analyzeBooking,
  buildDiagnosis,
  courseStats,
  differential,
  estimateHandicap,
  expectedScore,
  withCourseContext,
} from '../js/diagnose.js';

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

// ---------------------------------------------------------------------------
// コースレートによる補正
// ---------------------------------------------------------------------------

test('ディファレンシャル =（スコア − コースレート）× 113 ÷ スロープ', () => {
  assert.equal(differential(92, 71.4, 128), round1(((92 - 71.4) * 113) / 128));
  assert.equal(differential(92, 71.4, 128), 18.2);
  // スロープ未登録なら113として扱う
  assert.equal(differential(90, 70.0, null), 20);
  assert.equal(differential(90, null, 128), null);
});

test('難易度が高いコースほど同じスコアのディファレンシャルは小さい', () => {
  const easy = differential(92, 70.8, 126);
  const hard = differential(92, 71.8, 130);
  assert.ok(hard < easy, '難コースの方が評価が高くなるべき');
});

test('推定ハンディはラウンド数に応じた本数で計算する', () => {
  assert.equal(estimateHandicap([20, 18, 22, 25, 19]), 18); // 5件→最小1本
  assert.equal(estimateHandicap([20, 18]), null); // 4件以下は算出しない
  assert.equal(estimateHandicap([20, 18, 22, 25, 19, 17, 21]), 17.5); // 7件→最小2本平均
});

test('想定スコア = コースレート + ハンディ × スロープ/113', () => {
  assert.equal(expectedScore(71.4, 128, 18), round1(71.4 + (18 * 128) / 113));
  assert.equal(expectedScore(null, 128, 18), null);
});

test('初期19ラウンドにコースレートが紐づく', () => {
  const enriched = withCourseContext(SEED_ROUNDS, SEED_COURSES);
  assert.equal(enriched.length, 19);
  assert.ok(enriched.every((r) => r.courseRate !== null), 'コースレート未解決のラウンドがある');
  assert.ok(enriched.every((r) => r.differential !== null));
  assert.ok(enriched.every((r) => r.par === 72));
});

test('ゴルフ場別の成績を集計する', () => {
  const stats = courseStats(SEED_ROUNDS, SEED_COURSES);
  assert.equal(stats.length, 5);
  const toride = stats.find((c) => c.name === '取手国際ゴルフ倶楽部');
  assert.equal(toride.count, 5); // 09-28, 11-23, 01-18, 06-07, 08-12
  assert.equal(toride.best, 89);
  assert.equal(toride.worst, 100);
  assert.ok(toride.averageDifferential > 0);
  // 直近と前回の差分が出る
  assert.equal(toride.latest.totalScore, 89);
  assert.equal(toride.latestDelta, 89 - 92);
});

// ---------------------------------------------------------------------------
// 診断
// ---------------------------------------------------------------------------

function diagnose(overrides = {}) {
  return buildDiagnosis({
    rounds: SEED_ROUNDS,
    courses: SEED_COURSES,
    practice: practiceStats({ startDate: '2026-08-01', records: [], today: '2026-08-13' }),
    rangeStats: { count: 0 },
    settings: { targetScore: 85 },
    ...overrides,
  });
}

test('診断：直近5ラウンドとコースレートを基準にした現在地を必ず出す', () => {
  const d = diagnose();
  assert.equal(d.sample.recentCount, 5);
  assert.equal(d.sample.avgScore5, 92.6);
  assert.ok(d.sample.avgDiff5 > 0);
  assert.ok(d.sample.handicap !== null);
  assert.equal(d.findings[0].key, 'baseline');
  assert.match(d.findings[0].fact, /ディファレンシャル/);
});

test('診断：パーオン後3パットが多ければ改善点として出し、判別できない点を明示する', () => {
  const d = diagnose();
  const putting = d.findings.find((f) => f.key === 'three-putt-after-gir');
  assert.ok(putting, 'パットの指摘がない');
  assert.equal(putting.level, 'improve');
  assert.match(putting.reading, /判別できない/);
  assert.ok(putting.dataNeeded.includes('first-putt-distance'));
});

test('診断：改善点に対応する練習プラン変更案と計測データが出る', () => {
  const d = diagnose();
  const plan = d.planChanges.find((p) => p.day === 4);
  assert.ok(plan, '木曜の変更案がない');
  assert.ok(plan.steps.length >= 2);
  assert.match(plan.reason, /%/);
  assert.ok(d.dataRequests.some((r) => r.key === 'first-putt-distance'));
  assert.ok(d.dataRequests.every((r) => r.title && r.how && r.why));
});

test('診断：コースレートが仮の値なら気になるポイントで知らせる', () => {
  const d = diagnose();
  assert.ok(d.watchPoints.some((w) => w.title.includes('コースレート')));
});

test('診断：ペナルティが0続きなら未入力の可能性を指摘する', () => {
  const rounds = recent(SEED_ROUNDS, 5).map((r) => ({ ...r, penalties: 0 }));
  const d = diagnose({ rounds });
  assert.ok(d.watchPoints.some((w) => w.title.includes('ペナルティ0')));
});

test('診断：ラウンドが無ければ診断せず、登録を促す', () => {
  const d = diagnose({ rounds: [] });
  assert.equal(d.findings.length, 0);
  assert.equal(d.watchPoints.length, 1);
});

test('診断：実施率が低い場合は分量を落とす変更案を出す', () => {
  const d = diagnose({
    practice: { achievementRate: 30, doneDays: 3, missedDays: 7, restDays: 2 },
  });
  const finding = d.findings.find((f) => f.key === 'practice-low');
  assert.ok(finding);
  assert.ok(d.planChanges.some((p) => p.day === 2 && p.minutes < 15));
});

test('診断：励ましも叱責も入れない（過剰な優しさ・厳しさの排除）', () => {
  const ng = [
    'すごい', '素晴らしい', '完璧', '最高', '天才', 'さすが', '頑張って', '大丈夫です',
    'サボ', 'ダメ', '怠', '甘い', '言い訳', '努力不足',
  ];
  const d = diagnose({
    practice: { achievementRate: 20, doneDays: 2, missedDays: 8, restDays: 1 },
  });
  const texts = [
    ...d.findings.flatMap((f) => [f.fact, f.reading, f.action || '']),
    ...d.watchPoints.flatMap((w) => [w.title, w.body]),
  ];
  for (const text of texts) {
    for (const word of ng) {
      assert.ok(!text.includes(word), `禁止表現「${word}」が含まれる: ${text}`);
    }
  }
});

test('診断：数値には必ず母数か期間が添えられる', () => {
  const d = diagnose();
  for (const finding of d.findings) {
    assert.match(finding.fact, /直近|全期間|実施|平均/, `根拠が不明な指摘: ${finding.fact}`);
  }
});

// ---------------------------------------------------------------------------
// 予約したラウンドの事前分析
// ---------------------------------------------------------------------------

test('予約：過去成績とコースレートから想定スコアを出す', () => {
  const result = analyzeBooking({
    booking: { date: '2026-09-06', courseId: 'c-toride', courseName: '取手国際ゴルフ倶楽部', tee: 'レギュラー' },
    rounds: SEED_ROUNDS,
    courses: SEED_COURSES,
    settings: { targetScore: 85 },
  });
  assert.equal(result.history.count, 5);
  assert.ok(result.expectedScore > 80 && result.expectedScore < 105);
  assert.equal(result.targetRange.length, 2);
  assert.ok(result.notes.some((n) => n.includes('平均')));
  assert.ok(result.notes.some((n) => n.includes('要確認')));
});

test('予約：記録のないコースでも事前分析を返す', () => {
  const result = analyzeBooking({
    booking: { date: '2026-09-06', courseId: 'c-new', courseName: '初めてのGC' },
    rounds: SEED_ROUNDS,
    courses: SEED_COURSES,
  });
  assert.equal(result.history, null);
  assert.ok(result.notes.some((n) => n.includes('センター')));
});
