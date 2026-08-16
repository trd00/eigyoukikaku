// 相談画面の回答を組み立てる純関数。
//
// ここは「AIが考えて答える」のではなく、本人の記録から計算した事実を返す。
// 分からないことは分からないと答え、推測で埋めない。
// 実際のAIに相談したい場合のために、同じ内容を文章にまとめる関数も用意する。

import { WEEKDAY_LABELS, formatLong, formatShort, diffDays, weekday } from './date.js';
import { effectiveMenu, isRestWeekday, stepsForWeekday } from './menu.js';
import { fullRounds, recent, sortByDateAsc, values } from './stats.js';
import { describeTheme, memoEntries } from './insights.js';

/** 相談画面に並べる質問 */
export const QUESTIONS = [
  { key: 'today', label: '今日は何をすればいい？' },
  { key: 'form', label: '最近の調子は？' },
  { key: 'next-round', label: '次のラウンドの目標は？' },
  { key: 'fix-first', label: '何から直すべき？' },
  { key: 'putts', label: 'パット数が多いのは悪いこと？' },
  { key: 'club', label: '番手はどう選べばいい？' },
  { key: 'cannot-continue', label: '練習が続かない' },
  { key: 'memo', label: 'メモから何が見える？' },
  { key: 'next-data', label: '次に何を記録すればいい？' },
];

/**
 * @param {object} ctx
 * @param {object} ctx.state アプリの状態
 * @param {object} ctx.stats roundStats の結果
 * @param {object} ctx.practice practiceStats の結果
 * @param {object} ctx.diagnosis buildDiagnosis の結果
 * @param {object|null} ctx.booking 予約の事前分析
 * @param {string} ctx.today
 */
export function answerFor(key, ctx) {
  const handler = ANSWERS[key];
  if (!handler) return ['その質問にはまだ答えられません。'];
  const lines = handler(ctx).filter(Boolean);
  return lines.length ? lines : ['答えるだけの記録がまだありません。'];
}

const ANSWERS = {
  today({ state, today, practice }) {
    const w = weekday(today);
    const menu = effectiveMenu(w, state.planOverrides, state.settings.weeklyPlan);
    const steps = stepsForWeekday(w, state.planOverrides, state.settings.weeklyPlan);
    const rest = isRestWeekday(w, state.settings.restWeekdays);
    const done = state.daily?.[today]?.status;

    const lines = [`${formatShort(today)}は「${menu.title}」の日です（${menu.minutesLabel}）。`];
    if (rest) {
      lines.push('完全休養日なので、練習しなくても達成率は下がりません。ストレッチと睡眠を優先してください。');
      return lines;
    }
    lines.push(`目的：${menu.purpose}`);
    if (steps.length) lines.push(`やること：\n・${steps.join('\n・')}`);
    if (done === 'done') lines.push('今日はすでに「完了」で記録済みです。');
    else if (done === 'partial') lines.push('今日は「一部だけ実施」で記録済みです。追加でやれば「完了」に変えられます。');
    else if (practice && practice.achievementRate !== null && practice.achievementRate < 50) {
      lines.push('時間が取れない日は、最初の1項目だけでも構いません。「一部だけ実施」で記録すれば実施日として数えます。');
    }
    return lines;
  },

  form({ stats, diagnosis }) {
    if (!stats.count) return ['ラウンドの記録がまだありません。1件登録すると比較できるようになります。'];
    const lines = [];
    const last5 = stats.averageLast5;
    const all = stats.averageScore;
    lines.push(
      `直近5ラウンドの平均は ${last5}打、18ホール全${stats.count}ラウンドの平均は ${all}打です（ベスト ${stats.bestScore}／ワースト ${stats.worstScore}）。`
    );
    if (last5 !== null && all !== null) {
      const diff = Math.round((last5 - all) * 10) / 10;
      if (diff <= -1) lines.push(`直近は全期間より ${Math.abs(diff)}打 良い側にあります。`);
      else if (diff >= 1) lines.push(`直近は全期間より ${diff}打 悪い側にあります。`);
      else lines.push('直近と全期間の差は1打以内で、横ばいです。');
    }
    if (diagnosis?.sample?.spread != null) {
      lines.push(
        `直近5ラウンドのレンジは ${diagnosis.sample.spread}打です。平均より、この幅が縮むかどうかを見ると変化が分かります。`
      );
    }
    if (diagnosis?.sample?.avgDiff5 == null) {
      lines.push('コースレートが未登録のため、コースの難易度差を補正した比較はまだできていません。');
    }
    return lines;
  },

  'next-round'({ booking, stats }) {
    if (!booking) {
      return [
        '予約が登録されていません。スコア画面の「次のラウンドの予約」で日付とゴルフ場を入れると、そのコースの過去成績から目標を出します。',
        stats.averageLast5 !== null
          ? `参考までに、直近5ラウンドの平均は ${stats.averageLast5}打です。`
          : null,
      ];
    }
    const lines = [`次は ${formatLong(booking.booking.date)}、${booking.booking.courseName} です。`];
    if (booking.targetRange) {
      lines.push(`想定スコアは ${booking.targetRange[0]}〜${booking.targetRange[1]}打です（推定ハンディ基準）。`);
    }
    for (const note of booking.notes) lines.push(note);
    lines.push('当日は、ピンではなくグリーンセンターを基準に番手を決めると、大きく外す回数が減ります。');
    return lines;
  },

  'fix-first'({ diagnosis }) {
    const improve = (diagnosis?.findings || []).filter((f) => f.level === 'improve');
    if (!improve.length) {
      const watch = (diagnosis?.findings || []).filter((f) => f.level === 'watch');
      if (watch.length) {
        return [
          `今の記録から断定できる改善点はありません。観察中の項目が ${watch.length} 件あります。`,
          `${watch[0].fact}`,
          `${watch[0].reading}`,
          `→ ${watch[0].action}`,
        ];
      }
      return ['今の記録では、優先順位を決められるだけの内訳がありません。パーオン数や3パット数を記録すると判断できるようになります。'];
    }
    const top = improve[0];
    const lines = [`${top.area}が最優先です。`, top.fact, top.reading, `→ ${top.action}`];
    if (improve.length > 1) lines.push(`次に大きいのは「${improve[1].area}」です。1つ目が動いてから着手してください。`);
    return lines;
  },

  putts({ stats }) {
    const lines = [];
    if (stats.averagePutts === null) return ['パット数の記録がありません。'];
    lines.push(`平均パットは全期間 ${stats.averagePutts}、直近5ラウンドは ${stats.averagePuttsLast5} です。`);
    lines.push(
      'パット数だけでは良し悪しを判断できません。グリーンに乗る回数が増えると、長い1stパットが残るためパット数は増えます。逆に、乗らずに寄せワンで拾うとパット数は減ります。'
    );
    if (stats.girRate === null) {
      lines.push('パーオン数が未記録のため、今の増減がどちらの理由かは判別できません。次のラウンドでパーオン数を数えると切り分けられます。');
    } else {
      lines.push(`パーオン率は ${stats.girRate}%（直近5R ${stats.girRateLast5}%）です。ここが上がっている間はパット数の増加を悪化とは見ません。`);
    }
    lines.push('見るべきは「3パットの数」と「1stパットの残り距離」です。');
    return lines;
  },

  club({ state }) {
    const carry = Object.values(state.carry || {}).filter((c) => c.normalCarry || c.safeCarry);
    const lines = [
      '番手は「基準キャリー（よく飛ぶ時の距離）」ではなく「安全キャリー（悪くてもこれくらいは飛ぶ距離）」で選びます。',
      '基準で選ぶと、平均的な当たりでは手前に落ちます。グリーン手前に池やバンカーがあるときは、さらに1番手上げてセンターを狙います。',
    ];
    if (!carry.length) {
      lines.push('番手別キャリーがまだ登録されていません。練習画面のキャリー表に、実測した距離を入れてください。');
      return lines;
    }
    const sample = carry
      .slice(0, 4)
      .map((c) => `${c.club}：基準${c.normalCarry ?? '—'} / 安全${c.safeCarry ?? '—'}yd`)
      .join('\n・');
    lines.push(`登録済みの値：\n・${sample}`);
    lines.push('実測は10球打って「中央値」と「最短」を記録し、安全キャリーは最短寄りに設定すると外しが減ります。');
    return lines;
  },

  'cannot-continue'({ practice, state }) {
    const rate = practice?.achievementRate;
    const lines = [];
    if (rate === null || rate === undefined) {
      lines.push('まだ集計できる期間がありません。');
    } else {
      lines.push(`直近の実施率は ${rate}%（実施 ${practice.doneDays}日／未実施 ${practice.missedDays}日）です。`);
    }
    lines.push(
      '続かないときは、内容ではなく分量の問題であることが多いです。1回の時間を半分にして、素振り10回だけでも「一部だけ実施」で記録してください。実施日として数えます。'
    );
    const restCount = (state.settings.restWeekdays || [1]).length;
    lines.push(
      `今の設定では週${7 - restCount}日が練習日です。多すぎる場合は、分析画面の「利用者を選び直す」から曜日を減らせます。休養日は達成率の分母に入りません。`
    );
    return lines;
  },

  memo({ diagnosis, state }) {
    const insights = diagnosis?.memoInsights;
    if (!insights || insights.totalMemos === 0) {
      return [
        'メモがまだありません。',
        'ホーム画面の「メモ・疲労度・痛みを記録する」に、その日に意識したことと、その結果どうなったかを1行ずつ書いてください。3件を超えたあたりから、繰り返している課題が見えるようになります。',
      ];
    }

    const lines = [`メモは${insights.totalMemos}件です。`];
    if (!insights.hasEnough) {
      lines.push('傾向として読むには件数が足りません。今は1件ごとの記述として扱います。');
      if (insights.latest) {
        lines.push(`直近（${formatShort(insights.latest.date)}）：${insights.latest.memo}`);
      }
      return lines;
    }

    if (insights.recurring.length) {
      lines.push(`直近${insights.windowDays}日で繰り返している話題です。`);
      for (const theme of insights.recurring.slice(0, 3)) lines.push(`・${describeTheme(theme)}`);
      const top = insights.recurring[0];
      lines.push(
        top.trend === 'down'
          ? `${top.label}を書く回数は減っています。次のラウンドで結果を確認する段階です。`
          : `同じ話題を繰り返し書いている場合、その項目はまだ身についていないと考えます。次の1週間は、練習の最初の3分を${top.label}の確認だけに固定してください。`
      );
    } else {
      lines.push('同じ話題が繰り返し出てはいません。日によって書く内容が変わっている状態です。');
    }

    const follow = insights.focusFollowUp;
    if (follow) {
      lines.push(
        follow.matchedCount === 0
          ? `前回のラウンドで決めた課題「${follow.focusText}」は、その後のメモに現れていません。今日の練習の1項目目をこの課題に置き換えてください。`
          : `前回のラウンドで決めた課題「${follow.focusText}」に触れたメモが${follow.matchedCount}件あります。次のラウンドで結果を確認できます。`
      );
    }

    if (insights.bestFeelings.length) {
      const best = insights.bestFeelings[insights.bestFeelings.length - 1];
      lines.push(`ラウンドで良かった感覚（${formatShort(best.date)}）：${best.text}`);
    }
    return lines;
  },

  'next-data'({ diagnosis, state }) {
    const requests = diagnosis?.dataRequests || [];
    const notCollected = requests.filter((r) => !state.collectedData?.[r.key]);
    if (!notCollected.length) return ['今のところ、追加で取ってほしいデータはありません。'];
    const top = notCollected[0];
    const lines = [
      `優先は「${top.title}」です。`,
      `取り方：${top.how}`,
      `目的：${top.why}`,
    ];
    if (notCollected.length > 1) {
      lines.push(`他に ${notCollected.length - 1} 件あります（分析画面の「次に取りたいデータ」に一覧があります）。`);
    }
    return lines;
  },
};

/**
 * 外部のAIに相談するための文章を組み立てる。
 * 数値だけを渡し、指示はユーザーが自分で書ける形にしておく。
 */
export function buildConsultPrompt(
  { state, stats, practice, diagnosis, booking, today, rounds = [] },
  { includeQuestionSlot = true } = {}
) {
  const lines = [];
  lines.push('ゴルフのスコアについて相談します。以下は私の記録です。');
  lines.push('');
  lines.push(`【基本】`);
  lines.push(`- 日付：${today}`);
  if (state.profileName) lines.push(`- 名前：${state.profileName}`);
  lines.push(`- 目標スコア：${state.settings.targetScore}`);
  lines.push('');
  lines.push('【スコア】');
  if (stats.count) {
    lines.push(`- 18ホール ${stats.count}ラウンド：平均 ${stats.averageScore}／ベスト ${stats.bestScore}／ワースト ${stats.worstScore}`);
    lines.push(`- 直近5ラウンド平均：${stats.averageLast5}（直近3ラウンド ${stats.averageLast3}）`);
    lines.push(`- 平均パット：全期間 ${stats.averagePutts}／直近5R ${stats.averagePuttsLast5}`);
    if (stats.girRate !== null) lines.push(`- パーオン率：全期間 ${stats.girRate}%／直近5R ${stats.girRateLast5}%`);
    else lines.push('- パーオン率：未記録');
    if (stats.averagePenalties !== null) lines.push(`- OB・1ペナ：1ラウンド平均 ${stats.averagePenalties}回`);
    if (diagnosis?.sample?.avgDiff5 != null) {
      lines.push(`- ディファレンシャル平均（直近5R）：${diagnosis.sample.avgDiff5}／推定ハンディ ${diagnosis.sample.handicap}`);
    } else {
      lines.push('- コースレート：未登録（難易度補正なし）');
    }
  } else {
    lines.push('- ラウンド記録なし');
  }

  const last5 = recent(sortByDateAsc(fullRounds(rounds)), 5);
  if (last5.length) {
    lines.push('');
    lines.push('【直近5ラウンドの内訳】');
    for (const r of last5) {
      lines.push(`- ${r.date} ${r.course}：${r.totalScore}打／パット${r.putts ?? '—'}／OB${r.penalties ?? '—'}`);
    }
  }

  lines.push('');
  lines.push('【練習】');
  if (practice && practice.achievementRate !== null) {
    lines.push(`- 実施率 ${practice.achievementRate}%（実施 ${practice.doneDays}日／未実施 ${practice.missedDays}日）`);
  } else {
    lines.push('- 記録なし');
  }
  const plan = [];
  for (let day = 0; day <= 6; day++) {
    const menu = effectiveMenu(day, state.planOverrides, state.settings.weeklyPlan);
    plan.push(`${WEEKDAY_LABELS[day]}:${menu.title}(${menu.minutesLabel})`);
  }
  lines.push(`- 週間メニュー：${plan.join(' / ')}`);

  if (booking && booking.booking) {
    lines.push('');
    lines.push('【次のラウンド】');
    lines.push(`- ${booking.booking.date} ${booking.booking.courseName}（あと${diffDays(booking.booking.date, today)}日）`);
    if (booking.targetRange) lines.push(`- 想定スコア ${booking.targetRange[0]}〜${booking.targetRange[1]}`);
  }

  const watch = diagnosis?.watchPoints || [];
  if (watch.length) {
    lines.push('');
    lines.push('【未記録・注意点】');
    for (const w of watch.slice(0, 4)) lines.push(`- ${w.title}`);
  }

  const memos = memoEntries(Object.values(state.daily || {}), 8);
  if (memos.length) {
    lines.push('');
    lines.push('【練習メモ（新しい順）】');
    for (const m of memos) {
      const extra = [];
      if (m.status) extra.push(m.status === 'done' ? '完了' : m.status === 'partial' ? '一部' : m.status === 'rest' ? '休養' : '未実施');
      if (m.fatigue) extra.push(`疲労${m.fatigue}`);
      if (m.pain && m.pain !== 'none') extra.push('痛みあり');
      lines.push(`- ${m.date}${extra.length ? `（${extra.join('・')}）` : ''}：${String(m.memo).replace(/\n/g, ' / ')}`);
    }
  }

  const withNotes = sortByDateAsc(fullRounds(rounds)).filter((r) => (r.bestFeeling || '').trim() || (r.nextFocus || '').trim());
  if (withNotes.length) {
    lines.push('');
    lines.push('【ラウンドでの気づき】');
    for (const r of withNotes.slice(-3)) {
      if ((r.bestFeeling || '').trim()) lines.push(`- ${r.date} 良かった感覚：${r.bestFeeling.trim()}`);
      if ((r.nextFocus || '').trim()) lines.push(`- ${r.date} 次回の課題：${r.nextFocus.trim()}`);
    }
  }

  const insights = diagnosis?.memoInsights;
  if (insights?.recurring?.length) {
    lines.push('');
    lines.push('【繰り返している話題】');
    for (const t of insights.recurring.slice(0, 3)) {
      lines.push(`- ${t.label}：直近${insights.windowDays}日で${t.count}回（その前の期間は${t.previousCount}回）`);
    }
  }

  if (includeQuestionSlot) {
    lines.push('');
    lines.push('【聞きたいこと】');
    lines.push('（ここに質問を書いてください。例：この数値から、次の1か月で何を優先すべきですか）');
  }
  return lines.join('\n');
}
