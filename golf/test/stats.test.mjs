// node --test golf/test/
// 集計ロジックと初期データが要件定義書の受入条件を満たすことを確認する。

import test from 'node:test';
import assert from 'node:assert/strict';

import { ROUNDS_NO_DETAIL, ROUNDS_WITH_DETAIL, SAMPLE_COURSES, RATED_COURSES } from './fixtures.mjs';
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
  fullRounds,
  halfRounds,
} from '../js/stats.js';
import { projectDay, diffDays, addDays, weekday, todayJST, dateRange } from '../js/date.js';

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

/**
 * 集計の検証は架空データで行う。
 * 実在のスコア履歴はアプリに含めない（公開URLから見えてしまうため）。
 */
test('18ホールと9ホールを区別して集計する', () => {
  const s = roundStats(ROUNDS_NO_DETAIL);
  assert.equal(s.count, 8);
  assert.equal(s.halfCount, 2);
  assert.equal(s.averageScore, 93.3);
  assert.equal(s.bestScore, 88);
  assert.equal(s.worstScore, 100);
  assert.equal(s.averagePutts, 36.5);
});

test('9ホールのスコアは平均やベストに混ざらない', () => {
  const s = roundStats(ROUNDS_NO_DETAIL);
  assert.ok(s.bestScore > 60, '9ホールのスコアがベストに混入している');
  assert.equal(scoreSeries(ROUNDS_NO_DETAIL).length, 8);
});

test('直近5ラウンドは18ホールの新しい順に5件', () => {
  const full = fullRounds(ROUNDS_NO_DETAIL);
  assert.equal(averageScore(recent(full, 5)), 91.6);
  assert.equal(averagePutts(recent(full, 5)), 38);
});

test('アプリに初期ラウンドを持たない（履歴は各自の入力かバックアップ）', async () => {
  const seed = await import('../js/seed.js');
  assert.equal(seed.SEED_ROUNDS.length, 0, 'アプリに実際のラウンド履歴が残っている');
  assert.ok(seed.SEED_CARRY.every((c) => c.normalCarry === null), 'キャリーの実測値が残っている');
});

test('未計測の項目は0ではなくnullのまま扱う', () => {
  for (const r of ROUNDS_NO_DETAIL) {
    assert.equal(r.greensInRegulation, null);
    assert.equal(r.tripleOrWorse, null);
  }
  const s = roundStats(ROUNDS_NO_DETAIL);
  assert.equal(s.girRate, null);
  assert.equal(s.averageTriple, null);
  assert.equal(s.averageCarryShorts, null);
});

test('パーオン率などは未入力なら0%ではなくnullを返す', () => {
  assert.equal(girRate(ROUNDS_NO_DETAIL), null);
  assert.equal(bogeyOnRate(ROUNDS_NO_DETAIL), null);
  assert.equal(threePuttAfterGirRate(ROUNDS_NO_DETAIL), null);
});

test('内訳が記録されていれば率を計算する', () => {
  assert.equal(girRate(ROUNDS_WITH_DETAIL), 31.1);
  assert.equal(bogeyOnRate(ROUNDS_WITH_DETAIL), 76.7);
  assert.equal(threePuttAfterGirRate(ROUNDS_WITH_DETAIL), 32.1);
});

test('パーオン率は記録のあるラウンドだけで計算する', () => {
  const mixed = [
    { date: '2026-01-01', totalScore: 90, putts: 32, greensInRegulation: 5, holes: 18 },
    { date: '2026-01-02', totalScore: 92, putts: 33, greensInRegulation: null, holes: 18 },
    { date: '2026-01-03', totalScore: 45, putts: 17, greensInRegulation: 3, holes: 9 },
  ];
  assert.equal(girRate(mixed), 27.8);
});

test('OB・1ペナは記録された値をそのまま保持する', () => {
  const withOb = ROUNDS_NO_DETAIL.filter((r) => r.penalties > 0);
  assert.equal(withOb.length, 2);
  assert.equal(roundStats(ROUNDS_NO_DETAIL).averagePenalties, 0.4);
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
    ...ROUNDS_NO_DETAIL,
    {
      id: 'u1',
      date: '2026-08-20',
      courseId: 'c-a',
      holes: 18,
      totalScore: 80,
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
  assert.equal(s.count, 9);
  assert.equal(s.bestScore, 80);
  assert.ok(s.averageScore < 93.3);
  // 1件だけ記録があればパーオン率も計算される
  assert.equal(s.girRate, round1((8 / 18) * 100));
  const series = scoreSeries(added);
  assert.equal(series[series.length - 1].value, 80);
  assert.equal(movingAverage(series, 3).length, 9);
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

test('全ラウンドがゴルフ場マスタに紐づく', () => {
  const enriched = withCourseContext(ROUNDS_NO_DETAIL, SAMPLE_COURSES);
  assert.equal(enriched.length, 10);
  assert.ok(
    enriched.every((r) => SAMPLE_COURSES.some((c) => c.id === r.courseId)),
    'マスタに存在しないコースIDのラウンドがある'
  );
  assert.ok(enriched.every((r) => r.course.length > 0), 'コース名が空のラウンドがある');
});

test('コースレート未登録のうちはディファレンシャルを出さない', () => {
  const enriched = withCourseContext(ROUNDS_NO_DETAIL, SAMPLE_COURSES);
  assert.ok(enriched.every((r) => r.differential === null));
  assert.equal(estimateHandicap(enriched.map((r) => r.differential)), null);
});

test('コースレートを登録するとディファレンシャルが計算される', () => {
  const enriched = withCourseContext(ROUNDS_NO_DETAIL, RATED_COURSES);
  const rated = enriched.filter((r) => r.courseId === 'c-a' && r.holes === 18);
  assert.ok(rated.length && rated.every((r) => r.differential !== null));
  // 9ホールは18ホール基準のコースレートと比較しない
  const half = enriched.find((r) => r.courseId === 'c-a' && r.holes === 9);
  assert.equal(half.differential, null);
});

test('ゴルフ場別の成績を集計する（9ホールは別カウント）', () => {
  const stats = courseStats(ROUNDS_NO_DETAIL, SAMPLE_COURSES);
  assert.equal(stats.length, 3);
  const a = stats.find((c) => c.courseId === 'c-a');
  assert.equal(a.count, 3); // 18ホール3回
  assert.equal(a.halfCount, 1); // 9ホール1回
  assert.equal(a.best, 88);
  assert.equal(a.worst, 100);
  assert.equal(a.average, 93.3);
  assert.equal(a.latest.totalScore, 88);
  assert.equal(a.latestDelta, 88 - 92);
  assert.equal(a.averageGir, null); // 未入力は0にしない
});

// ---------------------------------------------------------------------------
// 診断
// ---------------------------------------------------------------------------

function diagnose(overrides = {}) {
  return buildDiagnosis({
    rounds: ROUNDS_NO_DETAIL,
    courses: SAMPLE_COURSES,
    practice: practiceStats({ startDate: '2026-08-01', records: [], today: '2026-08-13' }),
    rangeStats: { count: 0 },
    settings: { targetScore: 85 },
    ...overrides,
  });
}

test('診断：直近5ラウンドを基準にした現在地を必ず出す', () => {
  const d = diagnose();
  assert.equal(d.sample.recentCount, 5);
  assert.equal(d.sample.avgScore5, 91.6);
  assert.equal(d.sample.count, 8); // 9ホールは含めない
  assert.equal(d.sample.halfCount, 2);
  assert.equal(d.findings[0].area, '現在地');
  // コースレート未登録なので、補正できないことを明示して登録を促す
  assert.equal(d.findings[0].key, 'baseline-no-rate');
  assert.ok(d.findings[0].dataNeeded.includes('course-rating'));
});

test('診断：コースレートを登録すると難易度補正した現在地に切り替わる', () => {
  const d = diagnose({ courses: RATED_COURSES });
  assert.equal(d.findings[0].key, 'baseline');
  assert.match(d.findings[0].fact, /ディファレンシャル/);
  assert.ok(d.sample.avgDiff5 > 0);
  assert.ok(d.sample.handicap !== null);
});

test('診断：パーオン数が未入力ならパット増加の原因を断定しない', () => {
  const d = diagnose();
  const putting = d.findings.find((f) => f.key === 'putts-up-unknown-cause');
  assert.ok(putting, 'パットの指摘がない');
  assert.match(putting.reading, /判別できない/);
  assert.match(putting.reading, /悪化とは判断しない/);
  assert.ok(putting.dataNeeded.includes('round-detail'));
  // 断定できないので改善点ではなく観察として出す
  assert.equal(putting.level, 'watch');
});

test('診断：改善点に対応する練習プラン変更案と計測データが出る', () => {
  const d = diagnose();
  const plan = d.planChanges.find((p) => p.day === 4);
  assert.ok(plan, '木曜の変更案がない');
  assert.ok(plan.steps.length >= 2);
  assert.ok(plan.reason.length > 0);
  assert.ok(d.dataRequests.some((r) => r.key === 'first-putt-distance'));
  assert.ok(d.dataRequests.some((r) => r.key === 'round-detail'));
  assert.ok(d.dataRequests.every((r) => r.title && r.how && r.why));
});

test('診断：未入力の項目とコースレート未登録を気になるポイントで知らせる', () => {
  const d = diagnose();
  assert.ok(d.watchPoints.some((w) => w.title.includes('コースレート')));
  assert.ok(d.watchPoints.some((w) => w.title.includes('パーオン数')));
  assert.ok(d.watchPoints.some((w) => w.title.includes('9ホール')));
});

test('診断：未入力の項目を0回として指摘しない', () => {
  const d = diagnose();
  const bogus = d.findings.filter((f) => ['carry-short', 'triple', 'penalty', 'gir-low'].includes(f.key));
  assert.equal(bogus.length, 0, `未入力データを根拠にした指摘が出ている: ${bogus.map((f) => f.key).join(',')}`);
});

test('診断：ペナルティが0続きなら未入力の可能性を指摘する', () => {
  const rounds = fullRounds(ROUNDS_NO_DETAIL).map((r) => ({ ...r, penalties: 0 }));
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
    booking: { date: '2026-09-06', courseId: 'c-a', courseName: 'テストAゴルフ倶楽部', tee: 'レギュラー' },
    rounds: ROUNDS_NO_DETAIL,
    courses: RATED_COURSES,
    settings: { targetScore: 85 },
  });
  assert.equal(result.history.count, 3);
  assert.ok(result.expectedScore > 80 && result.expectedScore < 110);
  assert.equal(result.targetRange.length, 2);
  assert.ok(result.notes.some((n) => n.includes('平均')));
});

test('予約：コースレート未登録なら想定スコアを出さず登録を促す', () => {
  const result = analyzeBooking({
    booking: { date: '2026-09-06', courseId: 'c-a', courseName: 'テストAゴルフ倶楽部' },
    rounds: ROUNDS_NO_DETAIL,
    courses: SAMPLE_COURSES,
  });
  assert.equal(result.expectedScore, null);
  assert.equal(result.targetRange, null);
  assert.ok(result.notes.some((n) => n.includes('コースレートが未登録')));
});

test('予約：記録のないコースでも事前分析を返す', () => {
  const result = analyzeBooking({
    booking: { date: '2026-09-06', courseId: 'c-unknown', courseName: '初めてのGC' },
    rounds: ROUNDS_NO_DETAIL,
    courses: SAMPLE_COURSES,
  });
  assert.equal(result.history, null);
  assert.ok(result.notes.some((n) => n.includes('センター')));
});
