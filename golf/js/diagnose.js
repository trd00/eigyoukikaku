// 診断エンジン。直近5ラウンドとコースレートを基準に、事実→読み取り→改善点を組み立てる。
// 文章のトーン：数値と、その数値から言えることだけを書く。
// 励ましも叱責も入れない（「すごい」「最高」「ダメ」等は使わない）。
// 判別できないことは「判別できない」と書き、必要な計測データを提示する。

import { resolveCourse, STANDARD_SLOPE, DEFAULT_PAR } from './courses.js';
import { recent, round1, sortByDateAsc } from './stats.js';

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
    return {
      ...round,
      par: ctx.par ?? DEFAULT_PAR,
      courseRate: ctx.courseRate,
      slopeRating: ctx.slopeRating,
      courseVerified: ctx.verified,
      differential: differential(round.totalScore, ctx.courseRate, ctx.slopeRating),
      overPar: round.totalScore - (ctx.par ?? DEFAULT_PAR),
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
      const scores = entry.rounds.map((r) => r.totalScore);
      const diffs = entry.rounds.map((r) => r.differential).filter((d) => d !== null);
      const latest = entry.rounds[entry.rounds.length - 1];
      const previous = entry.rounds[entry.rounds.length - 2] || null;
      return {
        ...entry,
        count: entry.rounds.length,
        average: round1(scores.reduce((a, b) => a + b, 0) / scores.length),
        best: Math.min(...scores),
        worst: Math.max(...scores),
        averageDifferential: diffs.length ? round1(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null,
        latest,
        latestDelta: previous ? latest.totalScore - previous.totalScore : null,
        averagePutts: round1(avg(entry.rounds.map((r) => r.putts))),
        averageGir: round1(avg(entry.rounds.map((r) => r.greensInRegulation))),
        averagePenalties: round1(avg(entry.rounds.map((r) => r.penalties))),
        averageCarryShorts: round1(avg(entry.rounds.map((r) => r.carryShorts))),
        averageShortSide: round1(avg(entry.rounds.map((r) => r.shortSideMisses))),
        averageTriple: round1(avg(entry.rounds.map((r) => r.tripleOrWorse))),
      };
    })
    .sort((a, b) => b.count - a.count || a.average - b.average);
}

function avg(list) {
  const nums = list.map(Number).filter((n) => Number.isFinite(n));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
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
export function buildDiagnosis({ rounds, courses, practice = null, rangeStats = null, settings = {} }) {
  const enriched = withCourseContext(rounds, courses);
  const last5 = recent(enriched, 5);
  const findings = [];
  const watchPoints = [];
  const planChanges = [];
  const dataKeys = [];

  const targetScore = settings.targetScore ?? 85;

  if (!enriched.length) {
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
  const scores5 = last5.map((r) => r.totalScore);
  const avgScore5 = round1(avg(scores5));
  const avgScoreAll = round1(avg(enriched.map((r) => r.totalScore)));
  const spread = Math.max(...scores5) - Math.min(...scores5);

  const diffs5 = last5.map((r) => r.differential).filter((d) => d !== null);
  const avgDiff5 = diffs5.length ? round1(avg(diffs5)) : null;
  const bestDiff5 = diffs5.length ? Math.min(...diffs5) : null;
  const handicap = estimateHandicap(enriched.map((r) => r.differential));

  const holes5 = last5.length * 18;
  const girRate5 = pct(sum(last5.map((r) => r.greensInRegulation)), holes5);
  const girRateAll = pct(sum(enriched.map((r) => r.greensInRegulation)), enriched.length * 18);
  const bogeyRate5 = pct(sum(last5.map((r) => r.bogeyOn)), holes5);
  const putts5 = round1(avg(last5.map((r) => r.putts)));
  const puttsAll = round1(avg(enriched.map((r) => r.putts)));
  const gir5 = sum(last5.map((r) => r.greensInRegulation));
  const tpAfterGir5 = sum(last5.map((r) => r.threePuttsAfterGIR));
  const tpAfterGirRate5 = pct(tpAfterGir5, gir5);
  const threePutts5 = round1(avg(last5.map((r) => r.threePutts)));
  const penalties5 = round1(avg(last5.map((r) => r.penalties)));
  const triple5 = round1(avg(last5.map((r) => r.tripleOrWorse)));
  const carryShort5 = round1(avg(last5.map((r) => r.carryShorts)));
  const shortSide5 = round1(avg(last5.map((r) => r.shortSideMisses)));
  const strategy5 = round1(avg(last5.map((r) => r.strategyErrors)));

  const withNines = last5.filter((r) => r.outScore != null && r.inScore != null);
  const nineGap = withNines.length ? round1(avg(withNines.map((r) => r.inScore - r.outScore))) : null;

  const sample = {
    count: enriched.length,
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
      fact: `直近${last5.length}R 平均 ${avgScore5}打（全${enriched.length}R平均 ${avgScoreAll}打）。`,
      reading: 'コースレートが未登録のため、難易度を補正した比較ができていない。コースごとの難易度差がそのままスコア差に見えている状態。',
      action: 'スコア画面のゴルフ場管理で、使用ティーのコースレートとスロープを登録する。',
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
  if (carryShort5 >= 1.5) {
    findings.push({
      key: 'carry-short',
      level: 'improve',
      area: '番手選択',
      fact: `直近${last5.length}Rのキャリー不足 1ラウンド平均 ${carryShort5}回。ショートサイド ${shortSide5}回、判断ミス ${strategy5}回。`,
      reading: '手前に落ちる回数が一定数ある。番手選択を基準キャリー（中央値）で行っている場合、実際の平均はそれより手前に出るため、構造的に足りなくなる。',
      action: '番手選択を「安全キャリー」基準に切り替える。グリーン手前にハザードがある場合は1番手上げてセンター狙いに固定する。',
      dataNeeded: ['carry-median'],
    });
    dataKeys.push('carry-median');
  }

  // --- 5. ペナルティ --------------------------------------------------------
  if (penalties5 >= 2) {
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
  if (triple5 >= 1.5) {
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

  // --- 気になるポイント -----------------------------------------------------
  if (last5.length < 5) {
    watchPoints.push({
      title: `直近ラウンドが${last5.length}件`,
      body: '5ラウンド分たまるまでは、1回のスコアが平均を大きく動かす。傾向としては読まない。',
    });
  }

  const unverified = courseStats(rounds, courses).filter((c) => c.courseRate === null || !c.verified);
  if (unverified.length) {
    watchPoints.push({
      title: 'コースレートが未確認のゴルフ場がある',
      body: `${unverified.map((c) => c.name).join('、')}。初期値は一般的な相場から置いた仮の値で、実際と異なる可能性がある。スコアカードの値に更新すると、難易度補正後の比較が正確になる。`,
    });
    dataKeys.push('course-rating');
  }

  if (sum(last5.map((r) => r.penalties)) === 0 && last5.length >= 3) {
    watchPoints.push({
      title: 'ペナルティ0が続いている',
      body: 'OB・1ペナが本当に0なら問題はない。楽天GORA側の未入力をそのまま取り込んでいる場合は、この項目を根拠にした判断ができない。次のラウンドで実数を確認する。',
    });
  }

  if (putts5 - puttsAll >= 2 && avgScore5 <= avgScoreAll) {
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
  if (history) {
    notes.push(
      `このコースは${history.count}回。平均 ${history.average}／ベスト ${history.best}。1ラウンド平均で、キャリー不足 ${history.averageCarryShorts}回、ショートサイド ${history.averageShortSide}回、トリプル以上 ${history.averageTriple}ホール。`
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
