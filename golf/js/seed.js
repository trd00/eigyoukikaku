// 初期投入ラウンドデータ（2025-09-28 〜 2026-08-12 / 18ホール19件）
// 出典：楽天GORAスコア履歴の集計値。要件定義書 9章の基礎集計値に一致するよう構成。
//   全19R平均 92.5 / 2026年11R平均 93.4 / 直近5R平均 92.6 / ベスト87 / ワースト100
//   全期間平均パット 34.9 / 直近5R平均パット 38.6
//   全期間パーオン率 19.9% / 直近5R 31.1% / 全期間ボギーオン率 70.2% / 直近5R 76.7%
//
// 注意：楽天GORA側でFWキープ率0%が連続する箇所とOBがほぼ0の箇所は未入力の可能性があるため、
// penalties は信頼できる指標として扱わない（分析画面でも注記を出す）。

/** @type {import('./types.js').RoundRecord[]} */
export const SEED_ROUNDS = [
  r('seed-01', '2025-09-28', '取手国際ゴルフ倶楽部', 'レギュラー', 47, 47, 33, 2, 11, 2, 4, 1, 3, 2, 3, 3),
  r('seed-02', '2025-10-12', '大厚木カントリークラブ', 'レギュラー', 48, 46, 32, 3, 12, 3, 3, 1, 2, 3, 2, 3),
  r('seed-03', '2025-10-26', '東名カントリークラブ', 'レギュラー', 46, 46, 34, 2, 11, 2, 4, 1, 3, 2, 3, 2),
  r('seed-04', '2025-11-09', '相模カンツリー倶楽部', 'レギュラー', 47, 46, 33, 3, 12, 2, 3, 1, 2, 2, 2, 3),
  r('seed-05', '2025-11-23', '取手国際ゴルフ倶楽部', 'レギュラー', 45, 45, 35, 2, 12, 1, 4, 1, 2, 2, 2, 2),
  r('seed-06', '2025-12-07', '筑波東急ゴルフクラブ', 'レギュラー', 46, 45, 32, 3, 13, 2, 3, 1, 2, 1, 2, 2),
  r('seed-07', '2025-12-14', '大厚木カントリークラブ', 'レギュラー', 45, 44, 34, 2, 11, 1, 4, 1, 2, 2, 1, 1),
  r('seed-08', '2025-12-28', '東名カントリークラブ', 'レギュラー', 44, 43, 33, 3, 12, 1, 3, 1, 1, 1, 1, 1),
  r('seed-09', '2026-01-18', '取手国際ゴルフ倶楽部', 'レギュラー', 51, 49, 35, 3, 13, 4, 4, 1, 4, 4, 4, 5),
  r('seed-10', '2026-02-15', '筑波東急ゴルフクラブ', 'レギュラー', 49, 47, 34, 3, 13, 3, 4, 1, 3, 3, 3, 4),
  r('seed-11', '2026-03-15', '相模カンツリー倶楽部', 'レギュラー', 47, 46, 33, 4, 12, 2, 3, 1, 3, 2, 3, 2),
  r('seed-12', '2026-04-12', '大厚木カントリークラブ', 'レギュラー', 46, 46, 34, 3, 13, 2, 4, 1, 2, 2, 2, 2),
  r('seed-13', '2026-05-10', '東名カントリークラブ', 'レギュラー', 46, 45, 34, 4, 13, 2, 3, 1, 2, 2, 2, 2),
  r('seed-14', '2026-06-07', '取手国際ゴルフ倶楽部', 'レギュラー', 47, 45, 34, 3, 13, 2, 4, 1, 3, 2, 3, 2),
  r('seed-15', '2026-06-28', '筑波東急ゴルフクラブ', 'レギュラー', 48, 47, 38, 5, 13, 2, 5, 2, 3, 3, 3, 2),
  r('seed-16', '2026-07-12', '相模カンツリー倶楽部', 'レギュラー', 45, 45, 39, 6, 14, 1, 6, 2, 2, 2, 2, 1),
  r('seed-17', '2026-07-26', '大厚木カントリークラブ', 'レギュラー', 49, 48, 40, 4, 13, 3, 6, 2, 4, 3, 4, 3),
  r('seed-18', '2026-08-02', '東名カントリークラブ', 'レギュラー', 46, 46, 37, 7, 15, 2, 5, 3, 3, 2, 2, 2),
  r('seed-19', '2026-08-12', '取手国際ゴルフ倶楽部', 'レギュラー', 45, 44, 39, 6, 14, 1, 6, 2, 2, 2, 2, 1),
];

/**
 * seedデータもユーザー追加データと同じ型で扱う（要件17）。
 * 位置引数はデータ定義を1行に収めるための内部都合。
 */
function r(
  id, date, course, tee, outScore, inScore, putts,
  greensInRegulation, bogeyOn, penalties, threePutts, threePuttsAfterGIR,
  shortSideMisses, carryShorts, strategyErrors, tripleOrWorse
) {
  return {
    id,
    date,
    course,
    tee,
    outScore,
    inScore,
    totalScore: outScore + inScore,
    putts,
    greensInRegulation,
    bogeyOn, // ボギーオン以内（パーオンを含む累計）
    penalties,
    threePutts,
    threePuttsAfterGIR,
    shortSideMisses,
    carryShorts,
    strategyErrors,
    tripleOrWorse,
    bestFeeling: '',
    nextFocus: '',
    source: 'seed',
  };
}

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
