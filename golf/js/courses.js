// ゴルフ場マスタ。コースレート／スロープレーティングを保持し、スコアの難易度補正に使う。
//
// 重要：初期値のコースレート・スロープは一般的な相場から置いた「仮の値」。
// スコアカードや倶楽部の公式値と異なる場合があるため verified:false を付け、
// 画面上に「要確認」を表示する。正しい値に更新すると分析精度が上がる。

export const SEED_COURSES = [
  course('c-toride', '取手国際ゴルフ倶楽部', 72, 71.4, 128, 6350),
  course('c-oatsugi', '大厚木カントリークラブ', 72, 70.8, 126, 6180),
  course('c-tomei', '東名カントリークラブ', 72, 71.0, 127, 6250),
  course('c-sagami', '相模カンツリー倶楽部', 72, 71.8, 130, 6420),
  course('c-tsukuba', '筑波東急ゴルフクラブ', 72, 71.2, 129, 6300),
];

function course(id, name, par, courseRate, slopeRating, yards) {
  return { id, name, par, courseRate, slopeRating, yards, tee: 'レギュラー', memo: '', verified: false };
}

/** 名前からコースを引く（初期ラウンドデータの紐付け用） */
export function findCourseByName(courses, name) {
  return courses.find((c) => c.name === name) || null;
}

export function courseById(courses, id) {
  return courses.find((c) => c.id === id) || null;
}

/**
 * ラウンドに対応するコース情報を返す。
 * ラウンド側にコースレートが直接入っていればそちらを優先する。
 */
export function resolveCourse(round, courses) {
  const master = round.courseId ? courseById(courses, round.courseId) : findCourseByName(courses, round.course);
  const par = round.par ?? master?.par ?? null;
  const courseRate = round.courseRate ?? master?.courseRate ?? null;
  const slopeRating = round.slopeRating ?? master?.slopeRating ?? null;
  return { master, par, courseRate, slopeRating, verified: master?.verified ?? false };
}

export const DEFAULT_PAR = 72;
export const STANDARD_SLOPE = 113;
