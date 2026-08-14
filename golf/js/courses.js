// ゴルフ場マスタ。コースレート／スロープレーティングを保持し、スコアの難易度補正に使う。
//
// 名称は楽天GORAのラウンド履歴一覧から取り込んだもの。一覧では名前が途中で
// 省略されるため、正式名称と異なる場合がある（スコア画面から編集できる）。
//
// コースレート・スロープ・パーは一覧に表示されないため未登録（null）にしてある。
// 推測値を入れると難易度補正が狂うため、実際の値が分かるまで空のままにする。
// スコアカードの値を登録すると、ディファレンシャルと推定ハンディが計算される。

export const SEED_COURSES = [
  course('c-ube72', '宇部７２カントリークラブ'),
  course('c-unimat-yamaguchi', 'ユニマット山口ゴルフクラブ'),
  course('c-asa', '厚狭ゴルフ倶楽部'),
  course('c-yuda', '湯田カントリークラブ'),
  course('c-yanai', '柳井カントリー倶楽部'),
  course('c-nakasu', '中須ゴルフ倶楽部'),
  course('c-moji', '門司ゴルフ倶楽部'),
  course('c-hagi-iwami', '萩・石見カントリー倶楽部'),
  course('c-island-garden', 'アイランドゴルフガーデン'),
  course('c-miwa', '美和ゴルフクラブ'),
  course('c-shunan', '周南カントリー倶楽部'),
  course('c-sanyo-kokusai', '山陽国際ゴルフクラブ'),
  course('c-sanyo-green', '山陽グリーンゴルフ'),
  course('c-lakeswan', 'レークスワンカントリークラブ'),
  course('c-yamaguchi-rainbow', '山口レインボーヒルズカントリークラブ'),
  course('c-iwakuni-century', '岩国センチュリーゴルフ倶楽部'),
  course('c-mouri-teien', '毛利庭園ゴルフ倶楽部'),
  course('c-kudamatsu', 'くだまつパブリックゴルフ場'),
];

function course(id, name) {
  return {
    id,
    name,
    par: null,
    courseRate: null,
    slopeRating: null,
    yards: null,
    tee: 'レギュラー',
    memo: '',
    verified: false,
  };
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
