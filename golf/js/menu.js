// 週間トレーニングメニュー定義（要件5）。曜日番号 0=日 〜 6=土。

/** @typedef {'rest'|'swing'|'strength'|'putt'|'range'|'tune'} MenuType */

export const WEEKLY_MENU = [
  { day: 0, type: 'range', title: '打ちっぱなし', minutes: 75, minutesLabel: '60〜90分', purpose: '検証・キャリー・仮想ラウンド' },
  { day: 1, type: 'rest', title: '完全休養', minutes: 0, minutesLabel: '0分', purpose: '日曜練習からの回復' },
  { day: 2, type: 'swing', title: 'アドレス＋素振り', minutes: 15, minutesLabel: '15分', purpose: 'ボール位置・手元位置の固定' },
  { day: 3, type: 'strength', title: '軽い下半身筋トレ', minutes: 15, minutesLabel: '15分', purpose: '姿勢・左脚支持・後半の安定' },
  { day: 4, type: 'putt', title: 'パター', minutes: 15, minutesLabel: '15分', purpose: 'ロングパットの距離感' },
  { day: 5, type: 'swing', title: '素振り', minutes: 15, minutesLabel: '15分', purpose: '切り返し・右への押し込み' },
  { day: 6, type: 'tune', title: '軽い確認', minutes: 10, minutesLabel: '10分', purpose: '日曜へ疲労を残さない' },
];

/** 完全休養日（未実施の分母に含めない） */
export const REST_WEEKDAYS = [1];

export function menuForWeekday(w) {
  return WEEKLY_MENU[w];
}

export function isRestWeekday(w) {
  return REST_WEEKDAYS.includes(w);
}

/** 曜日ごとの実施チェック項目 */
export const MENU_STEPS = {
  rest: ['ストレッチのみ', '睡眠を確保する'],
  swing: [
    'ボール位置：左踵内側〜中央（クラブで確認）',
    'ハンドファーストで構える',
    '切り返しで右へ押し込む素振り10回',
    'ゆっくり素振り10回（フィニッシュ静止）',
  ],
  strength: [
    'スクワット 10回×2セット',
    'バックランジ 左右5回×1セット',
    'ヒップリフト 10回×2セット',
    'プランク 20秒×2セット',
  ],
  putt: [
    '1m×10球（カップイン優先）',
    '5m 距離感 10球',
    '10m 距離感 10球（カップ半径1mに寄せる）',
  ],
  tune: ['アドレス確認', 'ゆっくり素振り10回'],
  range: [
    'PWの小さい振り幅 10球',
    '7番アイアンのアドレス比較 15球',
    '7番アイアン基礎 20球',
    '番手別キャリー測定 15球',
    'ドライバー次打可能率 10球',
    '仮想グリーン攻略 10球',
  ],
};

/** 日曜の80球メニュー（要件5.2） */
export const SUNDAY_DRILL = [
  { order: 1, title: 'PWの小さい振り幅', balls: 10 },
  { order: 2, title: '7番アイアンのアドレス比較', balls: 15 },
  { order: 3, title: '7番アイアン基礎', balls: 20 },
  { order: 4, title: '番手別キャリー測定', balls: 15 },
  { order: 5, title: 'ドライバー次打可能率', balls: 10 },
  { order: 6, title: '仮想グリーン攻略', balls: 10 },
];

export const STATUS_LABELS = {
  done: '完了',
  partial: '一部だけ実施',
  rest: '休養',
  missed: 'できなかった',
};

export const STATUS_MARKS = {
  done: '◎',
  partial: '△',
  rest: '休',
  missed: '×',
};

/** 筋トレ強度の注意書き */
export const STRENGTH_NOTE = '強度は「あと3〜4回できる」で終了。';
