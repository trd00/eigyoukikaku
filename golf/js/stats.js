// 集計ロジック。DOMに触れない純関数のみ（要件17：UIから分離しテスト可能にする）。

import { addDays, dateRange, diffDays, projectDay, weekday } from './date.js';
import { isRestWeekday } from './menu.js';

/** 小数第1位で四捨五入 */
export function round1(n) {
  return Math.round(n * 10) / 10;
}

/** 整数で四捨五入 */
export function round0(n) {
  return Math.round(n);
}

function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

function avg(arr) {
  return arr.length ? sum(arr) / arr.length : 0;
}

/** null / undefined を除いた数値だけを取り出す（未入力と0を区別する） */
export function values(rounds, key) {
  return rounds.map((r) => r[key]).filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v)));
}

/** 平均。値が1つもなければ null */
function avgOrNull(list) {
  return list.length ? round1(avg(list)) : null;
}

/**
 * 18ホールのラウンドだけを返す。
 * ハーフ（9ホール）は平均スコアやパーオン率の分母に混ぜると数値が壊れるため、
 * 集計からは外し、一覧には残す。holes未指定の記録は18ホールとして扱う。
 */
export function fullRounds(rounds) {
  return rounds.filter((r) => (r.holes ?? 18) === 18);
}

export function halfRounds(rounds) {
  return rounds.filter((r) => (r.holes ?? 18) !== 18);
}

/** 日付昇順に並べる（同日は登録順） */
export function sortByDateAsc(rounds) {
  return [...rounds].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 日付降順（一覧表示用：新しいものが先頭） */
export function sortByDateDesc(rounds) {
  return sortByDateAsc(rounds).reverse();
}

// ---------------------------------------------------------------------------
// 練習の集計（要件7.1〜7.4）
// ---------------------------------------------------------------------------

/**
 * 日次記録をMapに畳み込む。同一日は最後の記録を採用（重複カウントしない）。
 * @param {Array<{date:string,status:string}>} records
 */
export function indexDailyRecords(records) {
  const map = new Map();
  for (const rec of records) map.set(rec.date, rec);
  return map;
}

/**
 * 練習の実施状況を集計する。
 * from/to を渡すと期間を絞り込める（カレンダーの月別集計用）。
 * today は「当日を自動未実施にしない」判定に使う実際の今日。
 * @param {{startDate:string, records:Array, today:string, from?:string, to?:string}} params
 */
export function practiceStats({ startDate, records, today, from, to }) {
  const byDate = indexDailyRecords(records);
  const elapsed = projectDay(startDate, today); // 開始日当日=1

  let doneDays = 0;
  let missedDays = 0;
  let restDays = 0;

  const rangeStart = from && diffDays(from, startDate) > 0 ? from : startDate;
  const rangeEnd = to && diffDays(to, today) < 0 ? to : today;

  if (elapsed >= 1 && diffDays(rangeEnd, rangeStart) >= 0) {
    for (const date of dateRange(rangeStart, rangeEnd)) {
      const rec = byDate.get(date);
      const status = rec ? rec.status : null;
      const isToday = date === today;
      const restDay = isRestWeekday(weekday(date));

      if (status === 'done' || status === 'partial') {
        doneDays++;
        continue;
      }
      if (restDay || status === 'rest') {
        restDays++;
        continue;
      }
      // 当日は1日が終わるまで自動未実施に含めない（要件7.3）
      if (isToday && status !== 'missed') continue;
      missedDays++;
    }
  }

  const denominator = doneDays + missedDays;
  const achievementRate = denominator > 0 ? round0((doneDays / denominator) * 100) : null;

  return {
    projectDay: Math.max(elapsed, 0),
    startDate,
    doneDays,
    missedDays,
    restDays,
    achievementRate,
  };
}

/**
 * 直近 n 日間の実施率（助言ロジック用）。
 */
export function recentPracticeRate({ startDate, records, today, days = 28 }) {
  const from = addDays(today, -(days - 1));
  const start = diffDays(from, startDate) > 0 ? from : startDate;
  if (diffDays(today, start) < 0) return null;
  const stats = practiceStats({ startDate: start, records, today });
  return stats.achievementRate;
}

// ---------------------------------------------------------------------------
// ラウンドの集計（要件7.5〜7.7）
// ---------------------------------------------------------------------------

const HOLES = 18;

/** パーオン率。記録のあるラウンドだけで計算し、1件もなければ null */
export function girRate(rounds) {
  const list = values(fullRounds(rounds), 'greensInRegulation');
  if (!list.length) return null;
  return round1((sum(list) / (list.length * HOLES)) * 100);
}

export function bogeyOnRate(rounds) {
  const list = values(fullRounds(rounds), 'bogeyOn');
  if (!list.length) return null;
  return round1((sum(list) / (list.length * HOLES)) * 100);
}

/** パーオン後3パット率。パーオン数0または未入力なら null（表示なし） */
export function threePuttAfterGirRate(rounds) {
  const withBoth = fullRounds(rounds).filter(
    (r) => r.greensInRegulation !== null && r.greensInRegulation !== undefined && r.threePuttsAfterGIR !== null && r.threePuttsAfterGIR !== undefined
  );
  const gir = sum(withBoth.map((r) => r.greensInRegulation));
  if (!gir) return null;
  return round1((sum(withBoth.map((r) => r.threePuttsAfterGIR)) / gir) * 100);
}

/** 直近 n ラウンド（日付昇順の末尾） */
export function recent(rounds, n) {
  const sorted = sortByDateAsc(rounds);
  return sorted.slice(Math.max(sorted.length - n, 0));
}

export function averageScore(rounds) {
  return avgOrNull(values(fullRounds(rounds), 'totalScore'));
}

export function averagePutts(rounds) {
  return avgOrNull(values(fullRounds(rounds), 'putts'));
}

/**
 * 分析画面で使う指標一式。18ホールのラウンドだけを対象にする。
 * @param {Array} rounds
 */
export function roundStats(rounds) {
  const sorted = sortByDateAsc(fullRounds(rounds));
  const last3 = recent(sorted, 3);
  const last5 = recent(sorted, 5);
  const scores = values(sorted, 'totalScore');

  return {
    count: sorted.length,
    halfCount: halfRounds(rounds).length,
    averageScore: averageScore(sorted),
    averageLast3: last3.length ? averageScore(last3) : null,
    averageLast5: last5.length ? averageScore(last5) : null,
    bestScore: scores.length ? Math.min(...scores) : null,
    worstScore: scores.length ? Math.max(...scores) : null,
    averagePutts: averagePutts(sorted),
    averagePuttsLast5: last5.length ? averagePutts(last5) : null,
    girRate: girRate(sorted),
    girRateLast5: last5.length ? girRate(last5) : null,
    bogeyOnRate: bogeyOnRate(sorted),
    bogeyOnRateLast5: last5.length ? bogeyOnRate(last5) : null,
    threePuttAfterGirRate: threePuttAfterGirRate(sorted),
    threePuttAfterGirRateLast5: last5.length ? threePuttAfterGirRate(last5) : null,
    averagePenalties: avgOrNull(values(sorted, 'penalties')),
    averageTriple: avgOrNull(values(sorted, 'tripleOrWorse')),
    averageThreePutts: avgOrNull(values(sorted, 'threePutts')),
    averageCarryShorts: avgOrNull(values(sorted, 'carryShorts')),
    averageShortSide: avgOrNull(values(sorted, 'shortSideMisses')),
    averageStrategyErrors: avgOrNull(values(sorted, 'strategyErrors')),
  };
}

/** 年（'2026'など）で絞り込む */
export function filterByYear(rounds, year) {
  return rounds.filter((r) => r.date.startsWith(String(year)));
}

/** グラフ用の系列。18ホールかつ記録のあるラウンドだけ */
export function scoreSeries(rounds) {
  return sortByDateAsc(fullRounds(rounds))
    .filter((r) => r.totalScore != null)
    .map((r) => ({ date: r.date, value: r.totalScore }));
}

export function girSeries(rounds) {
  return sortByDateAsc(fullRounds(rounds))
    .filter((r) => r.greensInRegulation != null)
    .map((r) => ({ date: r.date, value: round1((r.greensInRegulation / HOLES) * 100) }));
}

export function puttSeries(rounds) {
  return sortByDateAsc(fullRounds(rounds))
    .filter((r) => r.putts != null)
    .map((r) => ({ date: r.date, value: r.putts }));
}

/** 移動平均（3ラウンド）。推移グラフの補助線用 */
export function movingAverage(series, window = 3) {
  return series.map((point, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = series.slice(from, i + 1);
    return { date: point.date, value: round1(avg(slice.map((s) => s.value))) };
  });
}

// ---------------------------------------------------------------------------
// 打ちっぱなし記録の集計
// ---------------------------------------------------------------------------

export function rangeSessionStats(sessions) {
  const sorted = sortByDateAsc(sessions);
  const latest = sorted[sorted.length - 1] || null;
  const last4 = recent(sorted, 4);
  const shots7i = sum(last4.map((s) => s.sevenIronGood + s.sevenIronLeft + s.sevenIronRight + s.sevenIronShort));
  const driverShots = sum(last4.map((s) => s.driverPlayable + s.driverLeftMiss + s.driverRightMiss));
  const greenShots = sum(
    last4.map((s) => s.virtualGreenSuccess + s.shortSideMiss + s.carryShort + s.decisionMiss + s.executionMiss)
  );
  return {
    count: sorted.length,
    latest,
    sevenIronGoodRate: shots7i ? round1((sum(last4.map((s) => s.sevenIronGood)) / shots7i) * 100) : null,
    driverPlayableRate: driverShots ? round1((sum(last4.map((s) => s.driverPlayable)) / driverShots) * 100) : null,
    virtualGreenRate: greenShots ? round1((sum(last4.map((s) => s.virtualGreenSuccess)) / greenShots) * 100) : null,
    carryShortTotal: sum(last4.map((s) => s.carryShort)),
    shortSideTotal: sum(last4.map((s) => s.shortSideMiss)),
    decisionMissTotal: sum(last4.map((s) => s.decisionMiss)),
  };
}
