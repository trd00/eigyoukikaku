// 日付ユーティリティ。日本時間(JST)基準で計算し、UTCずれを起こさない（要件12/17）。
// 内部表現はすべて 'YYYY-MM-DD' の文字列。Dateオブジェクトのタイムゾーン変換は使わない。

const JST_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** JSTでの今日を 'YYYY-MM-DD' で返す */
export function todayJST(now = new Date()) {
  // en-CA は YYYY-MM-DD 形式を返す
  return JST_FORMATTER.format(now);
}

/** 'YYYY-MM-DD' → {y, m, d} */
export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** 年月日 → 'YYYY-MM-DD' */
export function toISO(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 1970-01-01 からの通算日数。UTCベースで計算するが、入力が「暦日」なので
 * タイムゾーンの影響を受けない（差分計算専用）。
 */
export function dayNumber(iso) {
  const { y, m, d } = parseISO(iso);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** 通算日数 → 'YYYY-MM-DD' */
export function fromDayNumber(n) {
  const dt = new Date(n * 86400000);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** a - b（日数）。a が後なら正 */
export function diffDays(a, b) {
  return dayNumber(a) - dayNumber(b);
}

/** iso の n 日後 */
export function addDays(iso, n) {
  return fromDayNumber(dayNumber(iso) + n);
}

/** 曜日番号（0=日, 1=月, ... 6=土）。暦日から算出するのでTZ非依存 */
export function weekday(iso) {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** 開始日を1日目とした経過日数（要件7.1） */
export function projectDay(startDate, today) {
  return diffDays(today, startDate) + 1;
}

/** start〜end（両端含む）の日付配列 */
export function dateRange(start, end) {
  const out = [];
  const last = dayNumber(end);
  for (let n = dayNumber(start); n <= last; n++) out.push(fromDayNumber(n));
  return out;
}

/** 表示用 'M/D(曜)' */
export function formatShort(iso) {
  const { m, d } = parseISO(iso);
  return `${m}/${d}(${WEEKDAY_LABELS[weekday(iso)]})`;
}

/** 表示用 'YYYY年M月D日(曜)' */
export function formatLong(iso) {
  const { y, m, d } = parseISO(iso);
  return `${y}年${m}月${d}日(${WEEKDAY_LABELS[weekday(iso)]})`;
}

/** ISO日時を日本時間の HH:MM で表示する */
const JST_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? JST_TIME.format(new Date(t)) : '';
}

/** 指定月の日数 */
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
