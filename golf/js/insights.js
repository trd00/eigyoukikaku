// 練習メモとラウンドの記述から傾向を取り出す純関数。
//
// メモは「その日の気づき」で終わらせると価値が出ない。
// 何度も同じことを書いているか、前回のラウンドで決めた課題が練習に現れているか、
// といった時間をまたいだ見方をして初めて、次の一手が決まる。
//
// 判定は語の一致だけで行う。書き手の意図を推測はしない。
// 該当が少ないときは「判断できない」と返し、無理に結論を出さない。

import { addDays, diffDays, formatShort } from './date.js';
import { fullRounds, sortByDateAsc } from './stats.js';

/** メモから拾う話題。表記ゆれを含めて並べる。 */
export const THEMES = [
  {
    key: 'address',
    label: 'ボール位置・構え',
    words: ['ボール位置', 'アドレス', '構え', 'スタンス', '手元', 'ハンドファースト', '前傾'],
  },
  {
    key: 'path',
    label: 'スイング軌道',
    words: ['軌道', 'カット', 'アウトサイド', 'インサイド', '振り遅れ', 'こすり', 'フェース', '面'],
  },
  {
    key: 'tempo',
    label: 'テンポ・力み',
    words: ['ゆっくり', 'テンポ', 'リズム', '力み', '力ん', '脱力', '急い', '間'],
  },
  {
    key: 'distance',
    label: '距離感・キャリー',
    words: ['距離感', '飛距離', 'キャリー', 'ヤード', '届か', 'ショート', 'オーバー', '番手'],
  },
  { key: 'putt', label: 'パット', words: ['パット', 'パター', 'グリーン', 'カップ', 'ライン', '3パット'] },
  {
    key: 'approach',
    label: 'アプローチ',
    words: ['アプローチ', '寄せ', 'ピッチ', 'ランニング', 'バンカー', 'ザックリ', 'トップ'],
  },
  {
    key: 'driver',
    label: 'ティーショット',
    words: ['ドライバー', 'ティーショット', 'OB', '曲が', 'スライス', 'フック', '林'],
  },
  { key: 'body', label: '体の状態', words: ['痛', '違和感', '張り', 'しびれ', '腰', '肘', '膝', '肩', '首'] },
  { key: 'condition', label: '時間・疲労', words: ['疲', 'だる', '眠', '時間がな', '忙し', '寒', '暑'] },
];

/** 文章に含まれる話題を返す */
export function themesOf(text) {
  const body = String(text || '');
  if (!body.trim()) return [];
  return THEMES.filter((t) => t.words.some((w) => body.includes(w))).map((t) => t.key);
}

function labelOf(key) {
  return THEMES.find((t) => t.key === key)?.label || key;
}

/** メモのある日次記録を新しい順に返す */
export function memoEntries(records, limit = 0) {
  const items = records
    .filter((r) => (r.memo || '').trim())
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return limit ? items.slice(0, limit) : items;
}

/**
 * 期間内のメモを話題ごとに数える。
 * @returns {Array<{key,label,count,dates:string[]}>} 多い順
 */
export function themeCounts(records, { from, to } = {}) {
  const counts = new Map();
  for (const rec of records) {
    if (from && diffDays(rec.date, from) < 0) continue;
    if (to && diffDays(rec.date, to) > 0) continue;
    for (const key of themesOf(rec.memo)) {
      if (!counts.has(key)) counts.set(key, { key, label: labelOf(key), count: 0, dates: [] });
      const entry = counts.get(key);
      entry.count++;
      entry.dates.push(rec.date);
    }
  }
  // 入力の並び順に依存しないよう、日付を昇順に整えてから返す
  for (const entry of counts.values()) entry.dates.sort();
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * 繰り返し出てくる話題。直前の同じ長さの期間と比べて増減も出す。
 * @param {Array} records 日次記録
 * @param {string} today
 * @param {{windowDays?:number, minCount?:number}} options
 */
export function recurringThemes(records, today, { windowDays = 21, minCount = 2 } = {}) {
  const from = addDays(today, -(windowDays - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(windowDays - 1));

  const current = themeCounts(records, { from, to: today });
  const previous = themeCounts(records, { from: prevFrom, to: prevTo });

  return current
    .filter((t) => t.count >= minCount)
    .map((t) => {
      const before = previous.find((p) => p.key === t.key)?.count ?? 0;
      return {
        ...t,
        previousCount: before,
        trend: t.count > before ? 'up' : t.count < before ? 'down' : 'flat',
        firstDate: t.dates[0],
        lastDate: t.dates[t.dates.length - 1],
      };
    });
}

/**
 * 前回ラウンドで決めた「次回の課題」が、その後の練習メモに現れているか。
 * 決めた課題が練習に繋がっているかを確かめるための材料。
 */
export function focusFollowUp({ rounds, records, today }) {
  const played = sortByDateAsc(fullRounds(rounds)).filter((r) => (r.nextFocus || '').trim());
  const last = played[played.length - 1];
  if (!last) return null;

  const focusThemes = themesOf(last.nextFocus);
  const since = records.filter((r) => diffDays(r.date, last.date) > 0 && (r.memo || '').trim());
  const matched = since.filter((r) => themesOf(r.memo).some((k) => focusThemes.includes(k)));

  return {
    round: last,
    focusText: last.nextFocus.trim(),
    themes: focusThemes.map((k) => ({ key: k, label: labelOf(k) })),
    daysSince: diffDays(today, last.date),
    memosSince: since.length,
    matchedCount: matched.length,
    lastMatchedDate: matched.length ? matched[matched.length - 1].date : null,
  };
}

/**
 * ラウンド前2週間に多かった話題と、そのラウンドのスコアを並べる。
 * 因果は主張しない。件数が少ないうちは判断材料が足りないことを明示するために使う。
 */
export function themeScorePairs({ rounds, records, days = 14 }) {
  return sortByDateAsc(fullRounds(rounds)).map((round) => {
    const from = addDays(round.date, -days);
    const to = addDays(round.date, -1);
    return {
      date: round.date,
      course: round.course,
      score: round.totalScore,
      themes: themeCounts(records, { from, to }).map((t) => t.label),
    };
  });
}

/**
 * メモとラウンドから読み取れることをまとめる。
 * 診断・相談の両方から使う。
 */
export function buildMemoInsights({ records, rounds, today, windowDays = 21 }) {
  const entries = memoEntries(records);
  const recent = recurringThemes(records, today, { windowDays });
  const follow = focusFollowUp({ rounds, records, today });

  const bestFeelings = sortByDateAsc(fullRounds(rounds))
    .filter((r) => (r.bestFeeling || '').trim())
    .slice(-3)
    .map((r) => ({ date: r.date, text: r.bestFeeling.trim() }));

  return {
    totalMemos: entries.length,
    latest: entries[0] || null,
    windowDays,
    recurring: recent,
    topTheme: recent[0] || null,
    focusFollowUp: follow,
    bestFeelings,
    // メモが少ないうちは傾向として扱わない
    hasEnough: entries.length >= 3,
  };
}

/** 画面表示用の1行要約 */
export function describeTheme(theme) {
  const trend =
    theme.trend === 'up'
      ? `前の${theme.previousCount}回から増えている`
      : theme.trend === 'down'
        ? `前の${theme.previousCount}回から減っている`
        : `前の期間と同じ${theme.previousCount}回`;
  return `${theme.label}：${theme.count}回（${trend}）。直近は${formatShort(theme.lastDate)}。`;
}
