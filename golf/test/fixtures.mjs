// テスト用の架空データ。
// 実在の記録はアプリに含めないため、集計や診断の検証はこの合成データで行う。

export const SAMPLE_COURSES = [
  { id: 'c-a', name: 'テストAゴルフ倶楽部', par: null, courseRate: null, slopeRating: null, tee: 'レギュラー', verified: false },
  { id: 'c-b', name: 'テストBカントリークラブ', par: null, courseRate: null, slopeRating: null, tee: 'レギュラー', verified: false },
  { id: 'c-c', name: 'テストCゴルフクラブ', par: null, courseRate: null, slopeRating: null, tee: 'レギュラー', verified: false },
];

/** コースレートを登録済みにした版（難易度補正の検証用） */
export const RATED_COURSES = SAMPLE_COURSES.map((c) => ({
  ...c,
  par: 72,
  courseRate: 71.5,
  slopeRating: 125,
  verified: true,
}));

function round(id, date, courseId, totalScore, putts, penalties, holes = 18, detail = {}) {
  return {
    id,
    date,
    courseId,
    course: SAMPLE_COURSES.find((c) => c.id === courseId)?.name || '',
    tee: 'レギュラー',
    holes,
    outScore: null,
    inScore: null,
    totalScore,
    putts,
    penalties,
    greensInRegulation: null,
    bogeyOn: null,
    threePutts: null,
    threePuttsAfterGIR: null,
    shortSideMisses: null,
    carryShorts: null,
    strategyErrors: null,
    tripleOrWorse: null,
    source: 'user',
    ...detail,
  };
}

/**
 * スコア・パット・OBだけの記録（楽天GORAの一覧から取り込んだ状態と同じ）。
 * 18ホール8件＋9ホール2件。
 *   18H平均 93.3 / ベスト88 / ワースト100 / 平均パット36.5
 *   直近5R平均 91.6 / 直近5R平均パット38 / レンジ7
 */
export const ROUNDS_NO_DETAIL = [
  round('r1', '2025-01-05', 'c-a', 100, 34, 1),
  round('r2', '2025-02-02', 'c-b', 96, 33, 0),
  round('r3', '2025-03-02', 'c-a', 92, 35, 0),
  round('r9', '2025-03-15', 'c-a', 48, 18, 0, 9),
  round('r4', '2025-04-06', 'c-c', 94, 36, 0),
  round('r5', '2025-05-04', 'c-b', 90, 38, 0),
  round('r6', '2025-06-01', 'c-a', 88, 39, 0),
  round('r7', '2025-07-06', 'c-c', 95, 37, 2),
  round('r10', '2025-07-20', 'c-c', 45, 17, 0, 9),
  round('r8', '2025-08-03', 'c-b', 91, 40, 0),
];

/**
 * パーオン数などの内訳まで記録した5ラウンド。
 *   パーオン率 31.1%（28/90） / ボギーオン以内 76.7%（69/90）
 *   パーオン後3パット率 32.1%（9/28）
 */
export const ROUNDS_WITH_DETAIL = [
  round('d1', '2026-01-10', 'c-a', 95, 36, 0, 18, {
    greensInRegulation: 5,
    bogeyOn: 13,
    threePutts: 3,
    threePuttsAfterGIR: 2,
    carryShorts: 3,
    shortSideMisses: 2,
    strategyErrors: 2,
    tripleOrWorse: 2,
  }),
  round('d2', '2026-02-14', 'c-b', 92, 37, 1, 18, {
    greensInRegulation: 6,
    bogeyOn: 14,
    threePutts: 3,
    threePuttsAfterGIR: 2,
    carryShorts: 2,
    shortSideMisses: 3,
    strategyErrors: 3,
    tripleOrWorse: 1,
  }),
  round('d3', '2026-03-14', 'c-c', 97, 38, 0, 18, {
    greensInRegulation: 4,
    bogeyOn: 13,
    threePutts: 4,
    threePuttsAfterGIR: 1,
    carryShorts: 3,
    shortSideMisses: 2,
    strategyErrors: 2,
    tripleOrWorse: 3,
  }),
  round('d4', '2026-04-11', 'c-a', 90, 35, 0, 18, {
    greensInRegulation: 7,
    bogeyOn: 15,
    threePutts: 2,
    threePuttsAfterGIR: 2,
    carryShorts: 2,
    shortSideMisses: 1,
    strategyErrors: 1,
    tripleOrWorse: 1,
  }),
  round('d5', '2026-05-09', 'c-b', 91, 37, 0, 18, {
    greensInRegulation: 6,
    bogeyOn: 14,
    threePutts: 3,
    threePuttsAfterGIR: 2,
    carryShorts: 2,
    shortSideMisses: 2,
    strategyErrors: 2,
    tripleOrWorse: 2,
  }),
];
