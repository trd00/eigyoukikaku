// 診断エンジン。直近5ラウンドとコースレートを基準に、事実→読み取り→改善点を組み立てる。
// 文章のトーン：数値と、その数値から言えることだけを書く。
// 励ましも叱責も入れない（「すごい」「最高」「ダメ」等は使わない）。
// 判別できないことは「判別できない」と書き、必要な計測データを提示する。

import { resolveCourse, STANDARD_SLOPE, DEFAULT_PAR } from './courses.js';
import { fullRounds, halfRounds, recent, round1, sortByDateAsc, values } from './stats.js';
import { buildMemoInsights, describeTheme } from './insights.js';

// ---------------------------------------------------------------------------
// コースレート関連
// ---------------------------------------------------------------------------

/** ハンディキャップ・ディファレンシャル =（スコア − コースレート）× 113 ÷ スロープ */
export function differential(score, courseRate, slopeRating) {
  if (score == null || courseRate == null) return null;
  const slope = slopeRating || STANDARD_SLOPE;
  return round1(((score - courseRate) * STANDARD_SLOPE) / slope);
}

/** 採用するディファレンシャルの本数（WHSの表を簡略化） */
function countedDifferentials(n) {
  if (n >= 20) return 8;
  if (n >= 17) return 6;
  if (n >= 15) return 5;
  if (n >= 12) return 4;
  if (n >= 9) return 3;
  if (n >= 7) return 2;
  if (n >= 5) return 1;
  return 0;
}

/** 推定ハンディキャップ（参考値）。ラウンド数が少ないうちは幅を持って見る。 */
export function estimateHandicap(differentials) {
  const values = differentials.filter((d) => d !== null).sort((a, b) => a - b);
  const take = countedDifferentials(values.length);
  if (!take) return null;
  const used = values.slice(0, take);
  return round1(used.reduce((a, b) => a + b, 0) / used.length);
}

/** そのコースで想定されるスコア =コースレート + ハンディ × スロープ/113 */
export function expectedScore(courseRate, slopeRating, handicap) {
  if (courseRate == null || handicap == null) return null;
  const slope = slopeRating || STANDARD_SLOPE;
  return round1(courseRate + (handicap * slope) / STANDARD_SLOPE);
}

/** ラウンド一覧にコース情報とディファレンシャルを付与する */
export function withCourseContext(rounds, courses) {
  return sortByDateAsc(rounds).map((round) => {
    const ctx = resolveCourse(round, courses);
    const holes = round.holes ?? 18;
    // 9ホールはコースレート（18ホール基準）と比較できないため補正しない
    const canRate = holes === 18;
    return {
      ...round,
      holes,
      par: ctx.par,
      courseRate: ctx.courseRate,
      slopeRating: ctx.slopeRating,
      courseVerified: ctx.verified,
      differential: canRate ? differential(round.totalScore, ctx.courseRate, ctx.slopeRating) : null,
      overPar: ctx.par != null ? round.totalScore - ctx.par : null,
    };
  });
}

/** ゴルフ場ごとの成績 */
export function courseStats(rounds, courses) {
  const enriched = withCourseContext(rounds, courses);
  const map = new Map();
  for (const round of enriched) {
    const key = round.courseId || round.course;
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: round.course,
        courseId: round.courseId || null,
        courseRate: round.courseRate,
        slopeRating: round.slopeRating,
        verified: round.courseVerified,
        rounds: [],
      });
    }
    map.get(key).rounds.push(round);
  }

  return [...map.values()]
    .map((entry) => {
      // 平均・ベストは18ホールのラウンドだけで出す（9ホールは別カウント）
      const full = fullRounds(entry.rounds);
      const scores = values(full, 'totalScore');
      const diffs = full.map((r) => r.differential).filter((d) => d !== null);
      const latest = full[full.length - 1] || entry.rounds[entry.rounds.length - 1];
      const previous = full[full.length - 2] || null;
      return {
        ...entry,
        count: full.length,
        halfCount: halfRounds(entry.rounds).length,
        average: scores.length ? round1(avg(scores)) : null,
        best: scores.length ? Math.min(...scores) : null,
        worst: scores.length ? Math.max(...scores) : null,
        averageDifferential: diffs.length ? round1(avg(diffs)) : null,
        latest,
        latestDelta: previous ? latest.totalScore - previous.totalScore : null,
        averagePutts: avgOrNull(values(full, 'putts')),
        averageGir: avgOrNull(values(full, 'greensInRegulation')),
        averagePenalties: avgOrNull(values(full, 'penalties')),
        averageCarryShorts: avgOrNull(values(full, 'carryShorts')),
        averageShortSide: avgOrNull(values(full, 'shortSideMisses')),
        averageTriple: avgOrNull(values(full, 'tripleOrWorse')),
      };
    })
    .sort((a, b) => b.count - a.count || (a.average ?? 999) - (b.average ?? 999));
}

function avg(list) {
  const nums = list.map(Number).filter((n) => Number.isFinite(n));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/** 平均。値が1つもなければ null（未入力と0を区別する） */
function avgOrNull(list) {
  return list.length ? round1(avg(list)) : null;
}

function pct(part, whole) {
  if (!whole) return null;
  return round1((part / whole) * 100);
}

function sum(list) {
  return list.reduce((a, b) => a + (Number(b) || 0), 0);
}

// ---------------------------------------------------------------------------
// 追加で取りたい計測データ
// ---------------------------------------------------------------------------

export const DATA_REQUESTS = {
  'first-putt-distance': {
    title: '1stパットの残り距離（1ラウンド18ホール）',
    how: 'グリーンに乗った時点の残り距離を m で、3パットしたかを○×でスコアカードの余白に記録する。',
    why: '3パットが「距離感」由来か「3〜5mの外し」由来かは、残り距離がないと判別できないため。',
  },
  'carry-median': {
    title: '主要番手のキャリー実測（各10球の中央値と最短）',
    how: '練習場で7I・8I・PW・52°を各10球。距離表示のマットか計測器で、中央値と最短の2つを記録する。',
    why: '安全キャリーを「中央値」ではなく「最短寄り」で設定し直すため。',
  },
  'driver-dispersion': {
    title: 'ドライバー10球の左右分布と次打可能数',
    how: '目標線に対して左／中央／右のどこへ出たかと、次打が普通に打てるかを10球分記録する。',
    why: 'ペナルティ数の実測値と、ティーショットの持ち球の傾向を確認するため。',
  },
  'ball-position-video': {
    title: '正面からのアドレス静止画・動画（7I／3球）',
    how: 'スマホをボールの正面（飛球線に対して直角）に置き、アドレスとインパクトを3球撮る。',
    why: 'ボール位置が右寄りかどうか、ハンドファーストの量を数値ではなく画像で確認するため。',
  },
  'down-the-line-video': {
    title: '飛球線後方からの動画（7I・ドライバー各3球）',
    how: '後方2m・腰の高さにスマホを固定して撮影する。',
    why: 'カット軌道の量を確認し、素振りメニューの内容が効いているかを見るため。',
  },
  'triple-cause': {
    title: 'トリプル以上のホールの原因',
    how: 'OB／林・池／バンカー／3パット／アプローチのミス のどれかを、そのホールで1つ記録する。',
    why: '大叩きの主因が判明しないと、練習の優先順位を決められないため。',
  },
  'approach-precision': {
    title: '100yd以内の距離別ワンピン率',
    how: '50・70・90ydを各5球。ピンから5m以内に止まった球数を記録する。',
    why: 'パーオンを外した後にボギーで収める確率を上げるため。',
  },
  'bunker-out-rate': {
    title: 'ガードバンカーの1回脱出率（10球）',
    how: '練習場のバンカーで10球。1回で出た球数を記録する。',
    why: 'トリプル以上のホールにバンカーが絡んでいる場合、最短の改善箇所になるため。',
  },
  'memo-detail': {
    title: '練習メモに「どうなったか」まで書く',
    how: '「何を意識したか」に加えて、「その結果どうなったか（球筋・距離・方向）」を1行足す。例：ゆっくり振った → 右へのブレが減った。',
    why: '意識した内容だけでは、それが効いたのか偶然かを後から判別できないため。',
  },
  'round-detail': {
    title: 'ラウンド中のパーオン数・ボギーオン数・3パット数',
    how: 'スコアカードに「◯＝パーオン」「△＝ボギーオン以内」「3＝3パット」を書き、終了後にアプリのスコア登録で合計を入れる。1ホールにつき記号1つで済む。',
    why: 'スコアの内訳が分からないと、打数がどこで増えているか（ショット・アプローチ・パット）を特定できないため。',
  },
  'course-rating': {
    title: '予約コースのコースレート・スロープ・パー',
    how: 'スコアカードまたは倶楽部の公式ページで、使用するティーの値を確認して登録する。',
    why: 'コースレートが正しくないと、難易度補正後の比較ができないため。',
  },
};

// ---------------------------------------------------------------------------
// 診断本体
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {Array} input.rounds すべてのラウンド
 * @param {Array} input.courses コースマスタ
 * @param {object} input.practice practiceStats の結果
 * @param {object} input.rangeStats rangeSessionStats の結果
 * @param {object} input.settings ProjectSettings
 */
export function buildDiagnosis({
  rounds,
  courses,
  practice = null,
  rangeStats = null,
  settings = {},
  records = [],
  today = null,
}) {
  const enriched = withCourseContext(rounds, courses);
  const full = fullRounds(enriched);
  const last5 = recent(full, 5);
  const findings = [];
  const watchPoints = [];
  const planChanges = [];
  const dataKeys = [];

  const targetScore = settings.targetScore ?? 85;

  if (!full.length) {
    return {
      sample: { count: 0 },
      findings: [],
      watchPoints: [{ title: 'ラウンド記録がありません', body: 'スコアを1件登録すると診断を開始します。' }],
      planChanges: [],
      dataRequests: [],
      courseStats: [],
    };
  }

  // --- 基礎数値 -------------------------------------------------------------
  // 未入力（null）は 0 として扱わない。値が無い指標は null のまま扱い、指摘を出さない。
  const scores5 = values(last5, 'totalScore');
  const avgScore5 = avgOrNull(scores5);
  const avgScoreAll = avgOrNull(values(full, 'totalScore'));
  const spread = scores5.length ? Math.max(...scores5) - Math.min(...scores5) : null;

  const diffs5 = last5.map((r) => r.differential).filter((d) => d !== null);
  const avgDiff5 = diffs5.length ? round1(avg(diffs5)) : null;
  const bestDiff5 = diffs5.length ? Math.min(...diffs5) : null;
  const handicap = estimateHandicap(full.map((r) => r.differential));

  const gir5List = values(last5, 'greensInRegulation');
  const girAllList = values(full, 'greensInRegulation');
  const girRate5 = gir5List.length ? pct(sum(gir5List), gir5List.length * 18) : null;
  const girRateAll = girAllList.length ? pct(sum(girAllList), girAllList.length * 18) : null;
  const bogey5List = values(last5, 'bogeyOn');
  const bogeyRate5 = bogey5List.length ? pct(sum(bogey5List), bogey5List.length * 18) : null;
  const putts5 = avgOrNull(values(last5, 'putts'));
  const puttsAll = avgOrNull(values(full, 'putts'));
  const gir5 = sum(gir5List);
  const withGirAndPutt = last5.filter((r) => r.greensInRegulation != null && r.threePuttsAfterGIR != null);
  const tpAfterGir5 = sum(withGirAndPutt.map((r) => r.threePuttsAfterGIR));
  const tpAfterGirRate5 = withGirAndPutt.length
    ? pct(tpAfterGir5, sum(withGirAndPutt.map((r) => r.greensInRegulation)))
    : null;
  const penalties5 = avgOrNull(values(last5, 'penalties'));
  const triple5 = avgOrNull(values(last5, 'tripleOrWorse'));
  const carryShort5 = avgOrNull(values(last5, 'carryShorts'));
  const shortSide5 = avgOrNull(values(last5, 'shortSideMisses'));
  const strategy5 = avgOrNull(values(last5, 'strategyErrors'));

  const withNines = last5.filter((r) => r.outScore != null && r.inScore != null);
  const nineGap = withNines.length ? round1(avg(withNines.map((r) => r.inScore - r.outScore))) : null;

  const sample = {
    count: full.length,
    halfCount: halfRounds(enriched).length,
    recentCount: last5.length,
    from: last5[0]?.date ?? null,
    to: last5[last5.length - 1]?.date ?? null,
    avgScore5,
    avgScoreAll,
    avgDiff5,
    bestDiff5,
    handicap,
    girRate5,
    bogeyRate5,
    putts5,
    tpAfterGirRate5,
    penalties5,
    triple5,
    spread,
    nineGap,
  };

  // --- 1. 難易度補正後の現在地 ---------------------------------------------
  if (avgDiff5 !== null) {
    const avgRate5 = round1(avg(last5.filter((r) => r.courseRate !== null).map((r) => r.courseRate)));
    const neededDiff = round1(targetScore - avgRate5);
    findings.push({
      key: 'baseline',
      level: 'baseline',
      area: '現在地',
      fact: `直近${last5.length}R 平均 ${avgScore5}打／平均コースレート ${avgRate5}。ディファレンシャル平均 ${avgDiff5}、ベスト ${bestDiff5}。推定ハンディキャップ ${handicap ?? '—'}。`,
      reading: `コース難易度で補正しても、スクラッチ基準に対して平均 +${avgDiff5} の位置にいる。ベストとの差が ${round1(avgDiff5 - bestDiff5)} あり、良い日の再現性が課題。目標 ${targetScore} は、このコースレート帯（${avgRate5}前後）ではディファレンシャル ${neededDiff} 相当。`,
      action: `平均を下げる前に、ばらつき（レンジ ${spread}打）を縮める方向で組む。`,
    });
  } else {
    findings.push({
      key: 'baseline-no-rate',
      level: 'baseline',
      area: '現在地',
      fact: `直近${last5.length}R 平均 ${avgScore5}打（18ホール全${full.length}R平均 ${avgScoreAll}打／ベスト ${Math.min(
        ...values(full, 'totalScore')
      )}／スコアのレンジ ${spread}打）。`,
      reading:
        'コースレートが未登録のため、難易度を補正した比較ができていない。今の数値は「行ったコースの難易度差込み」の平均で、易しいコースで出た数字と難しいコースで出た数字が同じ重みで混ざっている。',
      action: 'スコア画面下部のゴルフ場一覧で、よく行くコースのコースレートとスロープを登録する。3〜4コース入れるだけでも精度が変わる。',
      dataNeeded: ['course-rating'],
    });
    dataKeys.push('course-rating');
  }

  // --- 2. パーオン後の3パット ----------------------------------------------
  if (tpAfterGirRate5 !== null && tpAfterGirRate5 >= 25) {
    findings.push({
      key: 'three-putt-after-gir',
      level: 'improve',
      area: 'パット',
      fact: `直近${last5.length}Rのパーオン後3パット ${tpAfterGir5}/${gir5}（${tpAfterGirRate5}%）。平均パット ${putts5}（全期間 ${puttsAll}）。`,
      reading: `パーオン率は全期間 ${girRateAll}% に対し直近 ${girRate5}%。乗る回数が増えた分、1stパットの平均距離も伸びている可能性が高い。ただし残り距離を記録していないため、距離感の問題か3〜5mの外しかは現時点では判別できない。パット数の増加だけを見て悪化と判断はしない。`,
      action: '木曜のパター練習を10m中心に変更し、カップ半径1m以内に寄った本数を毎回記録する。次のラウンドで1stパットの残り距離を記録する。',
      dataNeeded: ['first-putt-distance'],
    });
    dataKeys.push('first-putt-distance');
    planChanges.push({
      day: 4,
      title: 'ロングパット（距離感）',
      minutes: 15,
      purpose: '10m前後の1stパットを1m以内に収める',
      steps: [
        '10m×10球：カップ半径1m以内に入った本数を記録',
        '15m×5球：ショート／オーバーの傾向を記録',
        '1m×10球：最後にカップインで終える',
      ],
      reason: `パーオン後3パット率 ${tpAfterGirRate5}%`,
    });
  }

  // --- 2b. パット数の変化（パーオン数が無くても言える範囲だけ言う） ---------
  if (tpAfterGirRate5 === null && putts5 !== null && puttsAll !== null && putts5 - puttsAll >= 1.5) {
    findings.push({
      key: 'putts-up-unknown-cause',
      level: 'watch',
      area: 'パット',
      fact: `直近${last5.length}Rの平均パット ${putts5}（18ホール全${full.length}R平均 ${puttsAll}）。同じ期間の平均スコアは ${avgScore5}（全期間 ${avgScoreAll}）。`,
      reading:
        'パット数は増えているが、スコアは同程度に収まっている。これは「グリーンに乗る回数が増えて長い1stパットが残っている」場合にも、「距離感が合っていない」場合にも起きる。パーオン数を記録していないため、現時点ではどちらか判別できない。パット数が多いこと自体を悪化とは判断しない。',
      action: '次のラウンドからパーオン数と、1stパットの残り距離を記録する。2ラウンド分あれば切り分けられる。',
      dataNeeded: ['round-detail', 'first-putt-distance'],
    });
    dataKeys.push('round-detail', 'first-putt-distance');
    // 木曜のパター練習は内容を変えず、結果を数える形にする（原因が判明するまでの措置）
    planChanges.push({
      day: 4,
      title: 'パター（本数を記録する）',
      minutes: 15,
      purpose: '距離感の現在地を数値で残す',
      steps: [
        '10m×10球：カップ半径1m以内に入った本数を記録',
        '5m×10球：ショート／オーバーのどちらに外れたかを記録',
        '1m×10球：カップインで終える',
      ],
      reason: `平均パット ${puttsAll} → ${putts5}（原因は未判別）`,
    });
  }

  // --- 3. パーオン率の変化 --------------------------------------------------
  if (girRate5 !== null && girRateAll !== null && girRate5 - girRateAll >= 5) {
    findings.push({
      key: 'gir-up',
      level: 'keep',
      area: 'アイアン',
      fact: `パーオン率 全期間 ${girRateAll}% → 直近${last5.length}R ${girRate5}%。ボギーオン以内 ${bogeyRate5}%。`,
      reading: 'グリーンに届く回数は増えている。ここは現状の方向を変える理由がない。',
      action: 'アイアンの練習量は現状維持。増やすならパットとアプローチ側に配分する。',
    });
  } else if (girRate5 !== null && girRate5 < 20) {
    findings.push({
      key: 'gir-low',
      level: 'improve',
      area: 'アイアン',
      fact: `直近${last5.length}Rのパーオン率 ${girRate5}%（18ホール中 約${round1((girRate5 / 100) * 18)}ホール）。`,
      reading: 'グリーンに乗る回数が少ない状態。距離不足と方向のどちらが主因かは、番手別キャリーの実測がないと切り分けられない。',
      action: '日曜の番手別キャリー測定を15球から20球に増やし、中央値と最短を記録する。',
      dataNeeded: ['carry-median'],
    });
    dataKeys.push('carry-median');
  }

  // --- 4. キャリー不足 ------------------------------------------------------
  if (carryShort5 !== null && carryShort5 >= 1.5) {
    const extra = [
      shortSide5 !== null ? `ショートサイド ${shortSide5}回` : null,
      strategy5 !== null ? `判断ミス ${strategy5}回` : null,
    ]
      .filter(Boolean)
      .join('、');
    findings.push({
      key: 'carry-short',
      level: 'improve',
      area: '番手選択',
      fact: `直近${last5.length}Rのキャリー不足 1ラウンド平均 ${carryShort5}回。${extra}`,
      reading: '手前に落ちる回数が一定数ある。番手選択を基準キャリー（中央値）で行っている場合、実際の平均はそれより手前に出るため、構造的に足りなくなる。',
      action: '番手選択を「安全キャリー」基準に切り替える。グリーン手前にハザードがある場合は1番手上げてセンター狙いに固定する。',
      dataNeeded: ['carry-median'],
    });
    dataKeys.push('carry-median');
  }

  // --- 5. ペナルティ --------------------------------------------------------
  if (penalties5 !== null && penalties5 >= 2) {
    findings.push({
      key: 'penalty',
      level: 'improve',
      area: 'ティーショット',
      fact: `直近${last5.length}RのOB・1ペナ 1ラウンド平均 ${penalties5}回。`,
      reading: 'ペナルティ1回はおおよそ2打の損失。平均で見ると、ここだけでスコアの4打前後を占める計算になる。',
      action: '日曜のドライバー10球を「飛距離」ではなく「次打可能数」で評価する。7球以上を基準にし、届かない日は1番手短いクラブでティーショットする。',
      dataNeeded: ['driver-dispersion'],
    });
    dataKeys.push('driver-dispersion');
  }

  // --- 6. トリプル以上 ------------------------------------------------------
  if (triple5 !== null && triple5 >= 1.5) {
    findings.push({
      key: 'triple',
      level: 'improve',
      area: '大叩き',
      fact: `直近${last5.length}Rのトリプル以上 1ラウンド平均 ${triple5}ホール。スコアのレンジは ${spread}打。`,
      reading: `トリプル以上を1ホール減らすと平均は約1打下がる。ばらつきの大きさもここに連動している可能性が高いが、原因（OB／バンカー／3パット／林）の記録がないため、どこから手を付けるべきかは特定できない。`,
      action: '次のラウンドで、トリプル以上のホールの原因を1つだけ記録する。原因が判明するまでは、100yd以内とバンカーの最低点を上げる練習を優先する。',
      dataNeeded: ['triple-cause', 'approach-precision'],
    });
    dataKeys.push('triple-cause', 'approach-precision');
  }

  // --- 7. 前半・後半の差 ----------------------------------------------------
  if (nineGap !== null && Math.abs(nineGap) >= 2) {
    const worseLater = nineGap > 0;
    findings.push({
      key: 'nine-gap',
      level: 'watch',
      area: 'ラウンド構成',
      fact: `直近${withNines.length}Rの OUT と IN の差は平均 ${nineGap > 0 ? '+' : ''}${nineGap}打（${worseLater ? '後半が多い' : '前半が多い'}）。`,
      reading: worseLater
        ? '後半に打数が増える傾向。体力・集中の低下、または後半のコースの難易度差のどちらかで、現状のデータでは区別できない。'
        : '前半に打数が多い傾向。スタート前の準備（練習グリーン・素振りの量）が影響している可能性がある。',
      action: worseLater
        ? '水曜の下半身メニューを継続し、ラウンド後半は1番手上げてセンター狙いに固定する。同じコースで再度OUT/INを記録して比較する。'
        : 'スタート1時間前に到着し、パター10分・素振り5分を固定手順にする。',
    });
  }

  // --- 8. 練習の実施状況 ----------------------------------------------------
  if (practice && practice.achievementRate !== null) {
    const rate = practice.achievementRate;
    if (rate < 50) {
      findings.push({
        key: 'practice-low',
        level: 'improve',
        area: '練習',
        fact: `練習実施率 ${rate}%（実施 ${practice.doneDays}日／未実施 ${practice.missedDays}日）。`,
        reading: '現在のメニュー量は、生活の中で回りきっていない。内容よりも、継続できる分量に合わせる段階。',
        action: '平日のメニューを15分から7〜8分に落とす。素振り10回だけでも「一部だけ実施」で記録し、実施日として数える。',
      });
      planChanges.push({
        day: 2,
        title: 'アドレス＋素振り（短縮版）',
        minutes: 8,
        purpose: '継続できる分量に合わせる',
        steps: ['ボール位置の確認（クラブを置く）', 'ゆっくり素振り10回'],
        reason: `練習実施率 ${rate}%`,
      });
    } else if (rate >= 80) {
      findings.push({
        key: 'practice-high',
        level: 'keep',
        area: '練習',
        fact: `練習実施率 ${rate}%（実施 ${practice.doneDays}日／未実施 ${practice.missedDays}日）。`,
        reading: '頻度は確保できている。次に効くのは量ではなく配分。',
        action: '合計時間は変えず、パットとアプローチの比率を上げる。',
      });
    }
  }

  // --- 9. 練習メモとラウンドの記述 -----------------------------------------
  // メモはこのアプリで最も情報量が多い記録。傾向として読めるときだけ扱う。
  const memoInsights = today ? buildMemoInsights({ records, rounds, today }) : null;

  if (memoInsights) {
    const top = memoInsights.topTheme;
    if (memoInsights.hasEnough && top && top.count >= 3) {
      findings.push({
        key: 'memo-recurring',
        level: top.trend === 'down' ? 'keep' : 'improve',
        area: '練習メモ',
        fact: `直近${memoInsights.windowDays}日のメモで、${describeTheme(top)}`,
        reading:
          top.trend === 'down'
            ? '同じ話題を書く回数が減っています。意識しなくてもできるようになったか、単に触れていないかのどちらかです。'
            : '同じ話題を繰り返し書いている状態です。気づきが毎回リセットされている（定着していない）可能性があります。まだ身についていない項目と考えて扱います。',
        action:
          top.trend === 'down'
            ? `${top.label}は、次のラウンドで結果を確認します。ラウンド後のメモに結果を1行書いてください。`
            : `次の1週間は、練習の最初の3分を${top.label}の確認だけに固定します。毎回同じ手順から入ると、再現できたかどうかが判定できます。`,
        dataNeeded: ['memo-detail'],
      });
      dataKeys.push('memo-detail');
    }

    const follow = memoInsights.focusFollowUp;
    if (follow && follow.daysSince >= 3) {
      if (follow.matchedCount === 0 && follow.memosSince >= 2) {
        findings.push({
          key: 'focus-not-practiced',
          level: 'improve',
          area: '課題の引き継ぎ',
          fact: `前回のラウンド（${follow.round.date}）で決めた課題は「${follow.focusText}」。その後${follow.daysSince}日でメモは${follow.memosSince}件ありますが、この課題に触れた記述は0件です。`,
          reading:
            'ラウンドで決めた課題が、日々の練習に繋がっていません。ラウンド直後の気づきは時間が経つほど薄れるため、次のラウンドでも同じ結果になりやすい状態です。',
          action: '今日の練習の1項目目を、この課題そのものに置き換えてください。5分で構いません。',
        });
      } else if (follow.matchedCount >= 2) {
        findings.push({
          key: 'focus-practiced',
          level: 'keep',
          area: '課題の引き継ぎ',
          fact: `前回の課題「${follow.focusText}」に触れたメモが${follow.matchedCount}件あります（直近 ${follow.lastMatchedDate}）。`,
          reading: 'ラウンドで決めた課題が練習に繋がっています。次のラウンドで結果を確認できる状態です。',
          action: '次のラウンド後、この課題がどうなったかを「今日もっとも良かった感覚」に1行書いてください。',
        });
      }
    }
  }

  // --- 気になるポイント -----------------------------------------------------
  if (last5.length < 5) {
    watchPoints.push({
      title: `直近ラウンドが${last5.length}件`,
      body: '5ラウンド分たまるまでは、1回のスコアが平均を大きく動かす。傾向としては読まない。',
    });
  }

  // 未入力の項目を明示する。0として扱うと診断が実態とずれるため。
  const missing = [
    girAllList.length ? null : 'パーオン数',
    values(full, 'bogeyOn').length ? null : 'ボギーオン数',
    values(full, 'threePutts').length ? null : '3パット数',
    values(full, 'carryShorts').length ? null : 'キャリー不足',
    values(full, 'tripleOrWorse').length ? null : 'トリプル以上',
  ].filter(Boolean);
  if (missing.length) {
    watchPoints.push({
      title: `${missing.join('・')}が未入力`,
      body: `楽天GORAのラウンド履歴一覧には スコア・パット・OB しか出ないため、これらは取り込めていない。0回ではなく「記録なし」として扱っており、この項目を根拠にした指摘は出していない。スコア一覧の各ラウンドを開いて入力するか、次のラウンドから記録すると診断に反映される。`,
    });
    dataKeys.push('round-detail');
  }

  const unverified = courseStats(rounds, courses).filter((c) => c.courseRate === null || !c.verified);
  if (unverified.length) {
    const noRate = unverified.filter((c) => c.courseRate === null);
    watchPoints.push({
      title: noRate.length ? 'コースレートが未登録のゴルフ場がある' : 'コースレートが未確認のゴルフ場がある',
      body: `${unverified
        .slice(0, 6)
        .map((c) => c.name)
        .join('、')}${unverified.length > 6 ? ` ほか${unverified.length - 6}件` : ''}。コースレートが入るまで、難易度を補正した比較（ディファレンシャル・推定ハンディ）は計算できない。よく行くコースから順に登録すると効果が大きい。`,
    });
    dataKeys.push('course-rating');
  }

  if (sample.halfCount) {
    watchPoints.push({
      title: `9ホールのラウンドが${sample.halfCount}件ある`,
      body: '9ホールのスコアを18ホールと同じ平均に混ぜると数値が壊れるため、平均・ベスト・推移グラフからは除外している。一覧には「9H」として残している。',
    });
  }

  if (penalties5 !== null && penalties5 === 0 && last5.length >= 3) {
    watchPoints.push({
      title: 'ペナルティ0が続いている',
      body: 'OB・1ペナが本当に0なら問題はない。楽天GORA側の未入力をそのまま取り込んでいる場合は、この項目を根拠にした判断ができない。次のラウンドで実数を確認する。',
    });
  }

  if (putts5 !== null && puttsAll !== null && avgScore5 !== null && avgScoreAll !== null && putts5 - puttsAll >= 2 && avgScore5 <= avgScoreAll) {
    watchPoints.push({
      title: 'パット数は増えているがスコアは悪化していない',
      body: `平均パット ${puttsAll} → ${putts5}、平均スコア ${avgScoreAll} → ${avgScore5}。ショットでグリーンに近づいた分をパットで戻している状態。パット数だけを指標にすると判断を誤る。`,
    });
  }

  if (girRate5 !== null && bogeyRate5 !== null && bogeyRate5 - girRate5 < 35 && last5.length >= 3) {
    watchPoints.push({
      title: 'パーオンを外したホールのボギーオン率が低い',
      body: `直近のパーオン率 ${girRate5}% に対しボギーオン以内 ${bogeyRate5}%。差が小さいほど、外した後に2打目・3打目で寄せきれていないことを示す。100yd以内の精度を確認する価値がある。`,
    });
    dataKeys.push('approach-precision');
  }

  if (memoInsights && memoInsights.totalMemos === 0) {
    watchPoints.push({
      title: '練習メモが未記録',
      body: 'スコアの数値だけでは、その日に何を意識したかまでは残りません。一言でも書いておくと、繰り返している課題や、ラウンドで決めた課題が練習に繋がっているかを判定できます。',
    });
  } else if (memoInsights && !memoInsights.hasEnough) {
    watchPoints.push({
      title: `メモが${memoInsights.totalMemos}件`,
      body: '3件を超えたあたりから、繰り返している課題が見えるようになります。それまでは1件ごとの記述として扱い、傾向としては読みません。',
    });
  }

  if (rangeStats && rangeStats.count === 0) {
    watchPoints.push({
      title: '打ちっぱなしの記録が未入力',
      body: 'ラウンドのデータだけでは、ミスの原因が技術・番手選択・判断のどれなのかを切り分けられない。日曜の80球分だけでも記録すると、次の診断から使える。',
    });
  }

  // スイングの根本（カット軌道・ボール位置）は本人課題として常時1件出す
  dataKeys.push('ball-position-video');

  const dataRequests = [...new Set(dataKeys)]
    .filter((key) => DATA_REQUESTS[key])
    .map((key) => ({ key, ...DATA_REQUESTS[key] }));

  return {
    sample,
    findings,
    watchPoints,
    planChanges,
    dataRequests,
    courseStats: courseStats(rounds, courses),
    memoInsights,
  };
}

/**
 * 予約したラウンドに対する事前分析。
 * @param {{booking:object, rounds:Array, courses:Array, settings:object}} input
 */
export function analyzeBooking({ booking, rounds, courses, settings = {} }) {
  if (!booking || !booking.date) return null;
  const stats = courseStats(rounds, courses);
  const enriched = withCourseContext(rounds, courses);
  const history = stats.find((c) => c.courseId === booking.courseId || c.name === booking.courseName) || null;
  const course = courses.find((c) => c.id === booking.courseId) || null;
  const handicap = estimateHandicap(enriched.map((r) => r.differential));
  const expected = expectedScore(course?.courseRate ?? null, course?.slopeRating ?? null, handicap);

  const notes = [];
  if (history && history.count) {
    const detail = [
      history.averagePutts !== null ? `平均パット ${history.averagePutts}` : null,
      history.averageCarryShorts !== null ? `キャリー不足 ${history.averageCarryShorts}回` : null,
      history.averageShortSide !== null ? `ショートサイド ${history.averageShortSide}回` : null,
      history.averageTriple !== null ? `トリプル以上 ${history.averageTriple}ホール` : null,
    ].filter(Boolean);
    notes.push(
      `このコースは18ホールで${history.count}回。平均 ${history.average}／ベスト ${history.best}／ワースト ${history.worst}。` +
        (detail.length ? `1ラウンド平均で ${detail.join('、')}。` : '')
    );
    if (history.latestDelta !== null) {
      notes.push(
        `前回は${history.latest.totalScore}打（前々回比 ${history.latestDelta > 0 ? '+' : ''}${history.latestDelta}）。`
      );
    }
  } else {
    notes.push('このコースの記録はまだない。初見のコースでは、ピンではなくグリーンセンターを基準にする。');
  }

  if (course?.courseRate != null) {
    notes.push(
      `コースレート ${course.courseRate}／スロープ ${course.slopeRating ?? '—'}${course.verified ? '' : '（要確認：仮の値）'}。`
    );
  } else {
    notes.push('コースレートが未登録。スコアカードで確認して登録すると、当日の目標が数値で決まる。');
  }

  return {
    booking,
    course,
    history,
    handicap,
    expectedScore: expected,
    targetRange: expected !== null ? [Math.floor(expected - 2), Math.ceil(expected + 2)] : null,
    notes,
  };
}
