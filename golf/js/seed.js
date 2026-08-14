// 初期投入ラウンドデータ。楽天GORAの「ラウンド履歴」一覧から取り込んだ実データ。
// 2024-10-20 〜 2026-08-12 の36ラウンド（うち9ホールが5回）。
//
// 一覧に出るのは スコア／パット／OB／FWキープ率 の4項目だけなので、
// パーオン数・ボギーオン数・3パット・キャリー不足などは「未入力（null）」にしてある。
// 推測値を入れると分析が実態と乖離するため、0では埋めない。
// 各ラウンドの詳細から入力するか、今後のラウンドで記録すると分析に反映される。
//
// FWキープ率は全ラウンドで0.0%（1件のみ100.0%）と表示されており、未入力の可能性が
// 高いため取り込んでいない。OBも0が続くため、分析では参考値として扱う。
//
// 参考：このうち 2025-09-28〜2026-08-12 の18ホール19ラウンドが要件定義書9章の
// 集計値（全19R平均92.5 / 2026年11R平均93.4 / 直近5R 92.6 / ベスト87 / ワースト100 /
// 平均パット34.9・直近5R 38.6）と一致する。

import { SEED_COURSES, findCourseByName } from './courses.js';

// [日付, コースID, スコア, パット, OB・1ペナ, ホール数]
const RAW_ROUNDS = [
  ['2024-10-20', 'c-ube72', 92, 32, 0, 18],
  ['2024-11-02', 'c-island-garden', 48, 19, 0, 9],
  ['2024-11-24', 'c-island-garden', 44, 17, 0, 9],
  ['2024-12-04', 'c-mouri-teien', 99, 36, 0, 18],
  ['2024-12-29', 'c-unimat-yamaguchi', 96, 31, 0, 18],
  ['2025-01-02', 'c-hagi-iwami', 105, 33, 0, 18],
  ['2025-02-11', 'c-sanyo-green', 96, 36, 0, 18],
  ['2025-03-23', 'c-yamaguchi-rainbow', 95, 31, 0, 18],
  ['2025-04-04', 'c-iwakuni-century', 99, 40, 0, 18],
  ['2025-05-25', 'c-yuda', 93, 32, 0, 18],
  ['2025-06-08', 'c-kudamatsu', 46, 18, 0, 9],
  ['2025-06-24', 'c-unimat-yamaguchi', 97, 32, 1, 18],
  ['2025-07-28', 'c-yuda', 95, 34, 1, 18],
  ['2025-08-12', 'c-unimat-yamaguchi', 101, 33, 0, 18],
  ['2025-08-25', 'c-nakasu', 81, 25, 0, 18],
  ['2025-09-28', 'c-ube72', 99, 33, 0, 18],
  ['2025-10-19', 'c-ube72', 89, 29, 0, 18],
  ['2025-11-03', 'c-island-garden', 43, 17, 0, 9],
  ['2025-11-12', 'c-ube72', 98, 33, 0, 18],
  ['2025-11-13', 'c-hagi-iwami', 89, 31, 0, 18],
  ['2025-11-16', 'c-miwa', 88, 38, 0, 18],
  ['2025-11-26', 'c-island-garden', 91, 32, 0, 18],
  ['2025-11-29', 'c-ube72', 88, 37, 0, 18],
  ['2025-12-27', 'c-asa', 89, 32, 0, 18],
  ['2026-01-02', 'c-ube72', 55, 21, 0, 9],
  ['2026-02-22', 'c-lakeswan', 95, 35, 1, 18],
  ['2026-02-25', 'c-moji', 94, 31, 0, 18],
  ['2026-02-28', 'c-moji', 100, 35, 0, 18],
  ['2026-03-15', 'c-sanyo-kokusai', 91, 35, 0, 18],
  ['2026-03-19', 'c-yanai', 90, 37, 0, 18],
  ['2026-04-15', 'c-shunan', 94, 33, 0, 18],
  ['2026-04-22', 'c-asa', 95, 38, 0, 18],
  ['2026-04-29', 'c-yanai', 87, 39, 0, 18],
  ['2026-06-14', 'c-unimat-yamaguchi', 95, 37, 0, 18],
  ['2026-06-28', 'c-asa', 95, 44, 0, 18],
  ['2026-08-12', 'c-nakasu', 91, 35, 0, 18],
];

/**
 * seedデータもユーザー追加データと同じ型で扱う（要件17）。
 * 未計測の項目は null。0（＝計測して0回だった）と区別する。
 */
export const SEED_ROUNDS = RAW_ROUNDS.map(([date, courseId, totalScore, putts, penalties, holes], index) => ({
  id: `seed-${String(index + 1).padStart(2, '0')}`,
  date,
  courseId,
  course: SEED_COURSES.find((c) => c.id === courseId)?.name || '',
  tee: '',
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
  bestFeeling: '',
  nextFocus: '',
  source: 'seed',
}));

/** 番手別キャリーの初期値（要件4：7Iの実キャリーは135〜140yd） */
export const SEED_CARRY = [
  { club: 'Driver', normalCarry: 210, safeCarry: 195 },
  { club: '4UT', normalCarry: 175, safeCarry: 165 },
  { club: '5UT', normalCarry: 165, safeCarry: 155 },
  { club: '6I', normalCarry: 148, safeCarry: 140 },
  { club: '7I', normalCarry: 138, safeCarry: 130 },
  { club: '8I', normalCarry: 126, safeCarry: 118 },
  { club: '9I', normalCarry: 114, safeCarry: 106 },
  { club: 'PW', normalCarry: 100, safeCarry: 92 },
  { club: '48°', normalCarry: 88, safeCarry: 80 },
  { club: '52°', normalCarry: 74, safeCarry: 66 },
  { club: '56°', normalCarry: 60, safeCarry: 52 },
];

export const CLUBS = SEED_CARRY.map((c) => c.club);

// findCourseByName は他モジュールからも使うため再エクスポートしておく
export { findCourseByName };
