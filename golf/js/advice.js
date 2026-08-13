// 助言ロジック（要件10）。固定ルールのみ。生成AI連携なし。
// 表現ルール：ユーザーを責めない。「再開できた」「一部でも実施」を肯定的に扱う。

/**
 * @param {{stats:object, latestRound:object|null, practiceRate:number|null, rangeStats:object}} input
 * @returns {Array<{key:string, priority:number, title:string, body:string, tone:'focus'|'good'}>}
 */
export function buildAdvice({ stats, latestRound, practiceRate, rangeStats }) {
  const messages = [];
  const r = latestRound;

  // 練習が空いているときは、まず再開しやすさを最優先で案内する
  if (practiceRate !== null && practiceRate < 50) {
    messages.push({
      key: 'practice-restart',
      priority: 1,
      tone: 'focus',
      title: 'まずは再開しやすさを優先',
      body: '今週はメニューを半分（素振り10回だけでもOK）にして、続けられる形に戻します。一部でも実施できた日は「一部だけ実施」で記録すれば実施日として数えます。',
    });
  }

  const girNow = stats.girRateLast5 ?? stats.girRate;
  const threePuttRate = stats.threePuttAfterGirRateLast5 ?? stats.threePuttAfterGirRate;
  if (girNow !== null && girNow >= 30 && threePuttRate !== null && threePuttRate >= 25) {
    messages.push({
      key: 'long-putt',
      priority: 2,
      tone: 'focus',
      title: 'ロングパットの距離感を最優先',
      body: `パーオン率が${girNow}%まで上がった結果、距離のあるファーストパットが増えています。パット数の増加はパットが悪くなったサインではありません。木曜のパター練習を10m中心に変更し、カップ半径1m以内に寄せることを目標にします。`,
    });
  }

  const carryShorts = (r?.carryShorts ?? 0) + (rangeStats?.carryShortTotal ?? 0);
  if (carryShorts >= 3) {
    messages.push({
      key: 'carry',
      priority: 3,
      tone: 'focus',
      title: '番手選択と安全キャリーの見直し',
      body: 'キャリー不足が続いています。練習画面のキャリー表で「基準キャリー」ではなく「安全キャリー」で番手を決めると、手前のミスが減ります。日曜は番手別キャリー測定15球を必ず入れます。',
    });
  }

  const shortSide = (r?.shortSideMisses ?? 0) + (rangeStats?.shortSideTotal ?? 0);
  if (shortSide >= 2) {
    messages.push({
      key: 'short-side',
      priority: 4,
      tone: 'focus',
      title: 'センター狙いの判断練習',
      body: 'ショートサイドに外す回数が増えています。日曜の仮想グリーン10球で、ピンではなくグリーンセンターと安全側を先に口に出してから打つ手順を固定します。',
    });
  }

  if ((r?.penalties ?? 0) >= 3) {
    messages.push({
      key: 'penalty',
      priority: 5,
      tone: 'focus',
      title: 'ドライバーは「次打可能率」で評価',
      body: '飛距離より、次の一打が普通に打てる位置に置けたかを数えます。日曜のドライバー10球で、次打可能7球以上を目標にします。',
    });
  }

  if ((r?.tripleOrWorse ?? 0) >= 3) {
    messages.push({
      key: 'triple',
      priority: 6,
      tone: 'focus',
      title: '100yd以内とバンカーの最低点を上げる',
      body: 'トリプル以上のホールを1つ減らすとスコアは確実に縮みます。PWの小さい振り幅10球と、バンカーからの「1回で出す」を最優先にします。',
    });
  }

  // 肯定メッセージ（該当が少ないときに表示）
  if (practiceRate !== null && practiceRate >= 80) {
    messages.push({
      key: 'praise-practice',
      priority: 7,
      tone: 'good',
      title: '継続できています',
      body: `直近の実施率は${practiceRate}%。この積み重ねが80台前半を日常にします。今のメニュー量を維持します。`,
    });
  }

  if (stats.averageLast5 !== null && stats.averageScore !== null && stats.averageLast5 < stats.averageScore) {
    messages.push({
      key: 'praise-score',
      priority: 8,
      tone: 'good',
      title: '直近5ラウンドが全期間平均を上回っています',
      body: `直近5R平均 ${stats.averageLast5} は全期間平均 ${stats.averageScore} より良い数値です。方向性は合っています。`,
    });
  }

  if (!messages.length) {
    messages.push({
      key: 'default',
      priority: 9,
      tone: 'good',
      title: '今週はベースを固める週',
      body: 'ボール位置とハンドファーストの確認を、火曜と金曜の素振りで固定します。数値が溜まるほど助言は具体的になります。',
    });
  }

  return messages.sort((a, b) => a.priority - b.priority);
}

/** ホーム画面用：今週の重点テーマ（1件） */
export function weeklyFocus(input) {
  const list = buildAdvice(input);
  const focus = list.find((m) => m.tone === 'focus');
  return focus || list[0];
}
