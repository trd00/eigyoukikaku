// 利用者ごとの週間メニューを組み立てる純関数。
//
// てらちゃんの週間メニュー（menu.js の WEEKLY_MENU）は本人の課題
// （カット軌道・ボール位置・7Iのキャリー不足）に合わせた固定内容。
// 別の人が使う場合は、その人が練習できる曜日・時間・課題から組み直す。

/** 初期設定で選ぶ課題 */
export const FOCUS_OPTIONS = [
  { key: 'direction', label: '方向が安定しない', short: '方向' },
  { key: 'distance', label: '飛距離が足りない', short: '飛距離' },
  { key: 'approach', label: '100yd以内が寄らない', short: 'アプローチ' },
  { key: 'putt', label: 'パットが決まらない・3パットが多い', short: 'パット' },
  { key: 'bigmiss', label: 'OBや大叩きが多い', short: '大叩き' },
  { key: 'stamina', label: '後半に崩れる・体力', short: '体力' },
];

/**
 * 課題ごとの練習メニュー。
 * type は集計上の分類（menu.js の MenuType と同じ）。
 */
const DRILLS = {
  direction: {
    type: 'swing',
    title: 'アドレス＋ハーフスイング',
    purpose: '構えと出球の方向を揃える',
    steps: [
      'クラブを置いてボール位置を確認する',
      '腰から腰のハーフスイング10回（フィニッシュで静止）',
      'ゆっくり素振り10回',
    ],
  },
  distance: {
    type: 'swing',
    title: '切り返しの素振り',
    purpose: '手打ちを減らし、体の回転で振る',
    steps: ['下半身から切り返す素振り10回', '左脚で受け止める素振り10回', 'フィニッシュ静止3秒×5回'],
  },
  approach: {
    type: 'swing',
    title: 'アプローチの振り幅',
    purpose: '30・50・70ydの距離感を作る',
    steps: ['時計の7時〜5時の振り幅を10回', '50yd想定を10回', '同じ振り幅で3球続けて同じ距離に出す'],
  },
  putt: {
    type: 'putt',
    title: 'パター（距離感中心）',
    purpose: 'ロングパットを1m以内に収める',
    steps: ['10m×10球：1m以内に入った本数を記録', '5m×10球', '1m×10球（カップインで終える）'],
  },
  bigmiss: {
    type: 'swing',
    title: 'ティーショットの型作り',
    purpose: '飛距離ではなく次打可能率を上げる',
    steps: ['ゆっくり素振り10回（振り幅8割で固定）', '目標線に対して構える練習5回', '1番手短いクラブでの素振り5回'],
  },
  stamina: {
    type: 'strength',
    title: '下半身の軽い筋トレ',
    purpose: '後半の失速を減らす',
    steps: ['スクワット 10回×2セット', 'バックランジ 左右5回×1セット', 'ヒップリフト 10回×2セット', 'プランク 20秒×2セット'],
  },
};

/** 打ちっぱなしの日のメニュー（課題に応じて球数配分を変える） */
function rangeMenu(focus) {
  const steps = ['アプローチ（PWの小さい振り幅）10球'];
  if (focus.includes('direction')) steps.push('7番アイアンで方向確認 20球');
  if (focus.includes('distance')) steps.push('番手別キャリー測定 15球');
  if (focus.includes('approach')) steps.push('50・70・90ydの打ち分け 15球');
  if (focus.includes('bigmiss')) steps.push('ドライバー10球（次打可能数を記録）');
  if (focus.includes('putt')) steps.push('練習グリーンでロングパット 10球');
  steps.push('仮想ラウンド（1打ごとに狙いを決めて打つ）10球');
  return {
    type: 'range',
    title: '打ちっぱなし',
    purpose: '検証とキャリー測定',
    steps,
  };
}

const REST = {
  type: 'rest',
  title: '完全休養',
  purpose: '回復',
  steps: ['ストレッチのみ', '睡眠を確保する'],
};

const LIGHT = {
  type: 'tune',
  title: '軽い確認',
  purpose: '翌日に疲労を残さない',
  steps: ['アドレス確認', 'ゆっくり素振り10回'],
};

/**
 * 週間メニューを組み立てる。
 * @param {object} input
 * @param {number[]} input.practiceDays 練習できる曜日（0=日〜6=土）
 * @param {number} input.minutes 1回の練習時間（分）
 * @param {number|null} input.rangeDay 打ちっぱなしに行ける曜日
 * @param {string[]} input.focus 課題のキー
 * @returns {object} 曜日番号をキーにしたメニュー
 */
export function buildWeeklyPlan({ practiceDays = [], minutes = 15, rangeDay = null, focus = [] }) {
  const activeFocus = focus.filter((f) => DRILLS[f]);
  const plan = {};

  // 打ちっぱなしの日を先に確定させる
  if (rangeDay !== null && rangeDay !== undefined) {
    plan[rangeDay] = { ...rangeMenu(activeFocus), minutes: 75, minutesLabel: '60〜90分' };
  }

  // 練習日に課題を順番に割り当てる（同じ内容が続かないよう巡回させる）
  const drills = activeFocus.length ? activeFocus.map((f) => DRILLS[f]) : [DRILLS.direction];
  const days = practiceDays.filter((d) => d !== rangeDay).sort((a, b) => a - b);
  days.forEach((day, index) => {
    const drill = drills[index % drills.length];
    plan[day] = { ...drill, minutes, minutesLabel: `${minutes}分` };
  });

  // 練習日でも打ちっぱなしでもない曜日は休養にする
  for (let day = 0; day <= 6; day++) {
    if (plan[day]) continue;
    // 打ちっぱなしの翌日は完全休養、それ以外は軽い確認
    const isAfterRange = rangeDay !== null && day === (rangeDay + 1) % 7;
    plan[day] = isAfterRange
      ? { ...REST, minutes: 0, minutesLabel: '0分' }
      : { ...REST, minutes: 0, minutesLabel: '0分' };
    if (!isAfterRange && days.length >= 5) {
      // 練習日が多い人には、休みの日に軽い確認を置く
      plan[day] = { ...LIGHT, minutes: 10, minutesLabel: '10分' };
    }
  }

  return plan;
}

/** 週間メニューから完全休養日（達成率の分母に入れない曜日）を求める */
export function restDaysOf(plan) {
  const rest = [];
  for (let day = 0; day <= 6; day++) {
    if (plan && plan[day] && plan[day].type === 'rest') rest.push(day);
  }
  return rest;
}

/** 設定内容の要約（確認画面用） */
export function describePlan(plan) {
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  return Object.keys(plan)
    .map(Number)
    .sort((a, b) => a - b)
    .map((day) => ({
      day,
      label: labels[day],
      title: plan[day].title,
      minutesLabel: plan[day].minutesLabel,
      type: plan[day].type,
    }));
}
