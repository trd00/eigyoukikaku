// メモを保存したときに返すコメントを組み立てる純関数。
//
// ここも外部のAIには接続していない。書かれた内容と、その日の記録から返す。
// 中身を褒めたり評価したりはせず、「その気づきを次にどう使うか」だけを書く。

import { WEEKDAY_LABELS, addDays, weekday } from './date.js';
import { effectiveMenu, isRestWeekday } from './menu.js';

/**
 * メモの内容から拾う手がかり。
 * 先に書かれたものを優先するのではなく、確認の優先度が高い順に並べている。
 */
const CUES = [
  {
    key: 'pain',
    words: ['痛', 'いた', '違和感', '張り', 'しびれ'],
    line: '体の違和感が書かれています。痛みがある日は、続けるより止める判断を優先します。翌日も残るようなら、その週の練習量を半分にしてください。',
  },
  {
    key: 'path',
    words: ['軌道', 'カット', 'アウトサイド', 'インサイド', '振り遅れ', 'こすり'],
    line: '軌道の手応えは、日によって再現できたりできなかったりします。次に同じ感覚が出るか確かめるため、後方（飛球線の後ろ）から3球だけ動画を撮ると、感覚と実際のズレが分かります。',
  },
  {
    key: 'address',
    words: ['ボール位置', 'アドレス', '構え', 'スタンス', '手元', 'ハンドファースト'],
    line: '構えは毎回わずかにズレます。クラブを地面に置いて位置を確認してから打つ手順を固定すると、確認にかかる時間が減ります。',
  },
  {
    key: 'tempo',
    words: ['ゆっくり', 'テンポ', 'リズム', '力み', '脱力', '間'],
    line: 'テンポの感覚は言葉にして残すと再現しやすくなります。次回そのまま同じ言葉を口に出してから打つと、再現できたかどうかが判定できます。',
  },
  {
    key: 'distance',
    words: ['距離感', '飛距離', 'キャリー', 'ヤード', '届か', 'ショート', 'オーバー'],
    line: '距離の感覚は数値と照合すると確定します。練習画面のキャリー表に実測値を入れておくと、次のラウンドで番手を迷いません。',
  },
  {
    key: 'putt',
    words: ['パット', 'パター', 'グリーン', 'カップ', '寄せ'],
    line: 'パットの感覚は本数で残すと比較できます。次回は「10m×10球のうち1m以内に何球入ったか」を数えてメモに足してください。',
  },
  {
    key: 'miss',
    words: ['ミス', '曲が', 'スライス', 'フック', 'OB', 'ダフ', 'トップ', '出な'],
    line: 'ミスの内容が書かれています。次に同じミスが出たとき、原因が同じかどうかを比べられます。方向（左右）まで書き足しておくと精度が上がります。',
  },
  {
    key: 'tired',
    words: ['疲', 'だる', '眠', '時間がな', '忙し'],
    line: '疲労や時間の制約は、続けられる分量を決める材料になります。同じ記述が続くようなら、1回の時間を減らす方が結果的に回数は増えます。',
  },
  {
    key: 'good',
    words: ['できた', '確認できた', 'つかめ', '掴め', '安定', '合っ'],
    line: 'うまくいった条件が書かれています。次に同じ状態を作れるかが再現性の確認になります。次回、同じ手順から始めてください。',
  },
];

/** 直近で連続して実施できている日数（休養日はまたいで数える） */
export function currentStreak({ records, today, restWeekdays = null }) {
  const byDate = new Map(records.map((r) => [r.date, r]));
  let streak = 0;
  let date = today;
  // さかのぼって、実施日を数える。休養日は途切れとみなさない。
  for (let i = 0; i < 400; i++) {
    const rec = byDate.get(date);
    const status = rec ? rec.status : null;
    if (status === 'done' || status === 'partial') {
      streak++;
    } else if (isRestWeekday(weekday(date), restWeekdays) || status === 'rest') {
      // 休養日は数にも入れないが、連続も切らない
    } else {
      break;
    }
    date = addDays(date, -1);
  }
  return streak;
}

/** 次に練習がある曜日を探す */
function nextPracticeDay(today, settings) {
  for (let i = 1; i <= 7; i++) {
    const date = addDays(today, i);
    const w = weekday(date);
    if (isRestWeekday(w, settings.restWeekdays)) continue;
    const menu = effectiveMenu(w, {}, settings.weeklyPlan);
    return { date, weekdayLabel: WEEKDAY_LABELS[w], menu };
  }
  return null;
}

/**
 * メモ保存時のコメント。
 * @param {object} input
 * @param {string} input.memo 書かれたメモ
 * @param {object} input.record その日の記録（status, fatigue, pain）
 * @param {object} input.settings ProjectSettings
 * @param {Array} input.records 全日次記録
 * @param {string} input.today
 * @returns {{headline:string, lines:string[]}}
 */
export function memoFeedback({ memo, record = {}, settings = {}, records = [], today }) {
  const text = String(memo || '');
  const lines = [];

  // 1. 保存されたことと、どこで見返せるかを最初に伝える
  const streak = currentStreak({ records, today, restWeekdays: settings.restWeekdays });
  const headline =
    streak >= 2 ? `記録しました（実施が${streak}日続いています）` : '記録しました';

  // 2. 体の状態は他より優先して扱う
  const hasPain = record.pain && record.pain !== 'none';
  if (hasPain) {
    lines.push(
      '痛みありで記録しました。次の練習は内容を減らすか休養に振り替えてください。同じ部位が2回続いたら、練習より先に受診を検討します。'
    );
  }

  // 3. メモの内容から拾えることを1つだけ返す（多く返しても読まれないため）
  if (text.trim()) {
    const cue = CUES.find((c) => c.words.some((w) => text.includes(w)) && !(c.key === 'pain' && hasPain));
    lines.push(
      cue
        ? cue.line
        : '書いた内容は、次に同じメニューをやるときの出発点になります。次回の記録と見比べると、再現できたかどうかが分かります。'
    );
  } else {
    lines.push('メモは空のままでも記録されます。一言でも書いておくと、次に同じ練習をするときの手がかりになります。');
  }

  // 4. 疲労度が高い日は分量の調整を促す
  if (Number(record.fatigue) >= 4) {
    lines.push('疲労度が高い記録です。翌日は内容を軽くするか休養に充てると、週全体の実施率は落ちません。');
  }

  // 5. 次にやることを具体的に示す
  const next = nextPracticeDay(today, settings);
  if (next) {
    lines.push(`次の練習は${next.weekdayLabel}曜「${next.menu.title}」（${next.menu.minutesLabel}）です。`);
  }

  return { headline, lines };
}
