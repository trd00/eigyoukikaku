// スコアカードの写真・スクリーンショットから、ラウンド1件分を読み取る。
//
// 読み取りそのものはAIに任せ、この場所では
//   「何を聞くか」「返ってきた文字をどう受け取るか」「誰の列を使うか」
// だけを扱う。通信もDOM操作もしないので、そのままテストできる。
//
// 方針:
// - 写っていない項目は必ず null。埋めない。カートの画面はコースごとに作りが違うため、
//   推測で埋めると「入力の手間は減ったが数字が違う」という一番困る状態になる。
// - 読み取った値は必ず人が確認してから保存する。この関数は下書きしか作らない。

/** AIに渡す指示。JSONだけを返させる。 */
export function buildScorecardPrompt({ myName = '', courses = [], today = '' } = {}) {
  const names = courses
    .map((c) => c.name)
    .filter(Boolean)
    .slice(0, 40);
  const lines = [
    'ゴルフのスコアカードの画像です。書かれている数字を読み取って、JSONだけを返してください。',
    '説明文・前置き・コードブロックの記号は書かないでください。',
    '',
    '返す形:',
    '{',
    '  "date": "YYYY-MM-DD",',
    '  "course": "コース名",',
    '  "holes": 18,',
    '  "players": [',
    '    { "name": "表示名", "out": 47, "in": 46, "total": 93, "putts": 34 }',
    '  ],',
    '  "note": "読み取れなかった箇所"',
    '}',
    '',
    '読み取りの決まり:',
    '- 画像に写っていない項目は必ず null にする。推測で埋めない。',
    '- 数字がかすれて確信が持てないものも null にし、note にどの項目かを書く。',
    '- OUT と IN の合計が合計スコアと合わない場合も、画像のとおりの数字を入れ、note に書く。',
    '- プレーヤーが複数いる場合は、写っている全員を players に並べる。名前が読めない列は name を null にする。',
    '- 9ホールだけの場合は holes を 9 にし、in を null にする。',
    '- パット数の欄が無ければ putts は null。',
    '- 日付が画像に無ければ date は null。年が書かれていなければ null にする（想像で年を足さない）。',
  ];
  if (today) lines.push(`- 参考: 今日は ${today} です。ただし画像に日付が無いときに今日の日付を入れてはいけません。`);
  if (myName) lines.push(`- 相談者の名前は「${myName}」です。players の中にあれば、その表記のまま入れてください。`);
  if (names.length) lines.push(`- コース名は、可能なら次のいずれかの表記に合わせる: ${names.join(' / ')}`);
  return lines.join('\n');
}

/** AIの返事からJSONを取り出す。コードブロックや前後の文が混ざっていても拾う。 */
export function parseScorecardReply(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('返事が空でした');
  const json = extractJson(raw);
  if (!json) throw new Error('読み取り結果を受け取れませんでした');

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('読み取り結果の形が壊れていました');
  }

  const players = Array.isArray(parsed.players) ? parsed.players : [];
  return {
    date: isoDateOrNull(parsed.date),
    course: textOrNull(parsed.course),
    holes: parsed.holes === 9 ? 9 : 18,
    players: players.map((p) => ({
      name: textOrNull(p?.name),
      out: scoreOrNull(p?.out),
      in: scoreOrNull(p?.in),
      total: scoreOrNull(p?.total),
      putts: puttsOrNull(p?.putts),
    })),
    note: textOrNull(parsed.note),
  };
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

function textOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed !== 'null' ? trimmed : null;
}

function isoDateOrNull(value) {
  const text = textOrNull(value);
  if (!text) return null;
  const m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function numberOrNull(value, min, max) {
  const n = typeof value === 'string' ? Number(value.replace(/[^\d.-]/g, '')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= min && rounded <= max ? rounded : null;
}

// ありえない値はnullに落とす。読み違いをそのまま保存させないため。
const scoreOrNull = (v) => numberOrNull(v, 18, 160);
const puttsOrNull = (v) => numberOrNull(v, 8, 60);

/** 名前の表記ゆれを吸収する（空白・全角半角・大文字小文字） */
export function normalizeName(value) {
  return String(value || '')
    .replace(/[\s　]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/**
 * 自分の列を選ぶ。決められないときは null を返し、画面で選んでもらう。
 * @returns {{index: number, reason: string} | null}
 */
export function pickPlayer(players, myName) {
  const list = Array.isArray(players) ? players : [];
  if (!list.length) return null;

  const target = normalizeName(myName);
  if (target) {
    const exact = list.findIndex((p) => normalizeName(p.name) === target);
    if (exact !== -1) return { index: exact, reason: 'name' };
    const partial = list.findIndex((p) => {
      const name = normalizeName(p.name);
      return name && (name.includes(target) || target.includes(name));
    });
    if (partial !== -1) return { index: partial, reason: 'name-partial' };
  }

  if (list.length === 1) return { index: 0, reason: 'only-one' };
  return null;
}

/** 読み取ったコース名を、登録済みのゴルフ場に当てる */
export function matchCourse(name, courses) {
  const target = normalizeName(name);
  if (!target) return null;
  const list = courses || [];
  const exact = list.find((c) => normalizeName(c.name) === target);
  if (exact) return exact;
  return (
    list.find((c) => {
      const known = normalizeName(c.name);
      return known && (known.includes(target) || target.includes(known));
    }) || null
  );
}

/**
 * 読み取り結果を、スコア登録フォームに入れる下書きにする。
 * 足りない項目・食い違いは warnings に入れ、画面で必ず見せる。
 */
export function toDraft(parsed, { playerIndex = null, courses = [], myName = '' } = {}) {
  const picked = playerIndex === null ? pickPlayer(parsed.players, myName) : { index: playerIndex, reason: 'chosen' };
  const player = picked ? parsed.players[picked.index] : null;
  const course = matchCourse(parsed.course, courses);
  const warnings = [];

  if (!player) {
    warnings.push(
      parsed.players.length
        ? 'どの列が自分か決められませんでした。下から選んでください。'
        : 'スコアの行を読み取れませんでした。撮り直すか、手で入力してください。'
    );
  }
  if (!parsed.date) warnings.push('日付が読み取れませんでした。入力してください。');
  if (!course) {
    warnings.push(
      parsed.course
        ? `「${parsed.course}」は登録済みのゴルフ場に見つかりませんでした。下で選ぶか、ゴルフ場管理から追加してください。`
        : 'コース名が読み取れませんでした。下で選んでください。'
    );
  }

  const holes = parsed.holes === 9 ? 9 : 18;
  const out = player?.out ?? null;
  const inn = holes === 9 ? null : player?.in ?? null;
  let total = player?.total ?? null;

  if (out !== null && inn !== null) {
    const sum = out + inn;
    if (total === null) total = sum;
    else if (total !== sum) warnings.push(`OUT+IN（${sum}）と合計（${total}）が合いません。数字を確認してください。`);
  } else if (total === null && out !== null && holes === 9) {
    total = out;
  }
  if (total === null) warnings.push('合計スコアが読み取れませんでした。入力してください。');
  if (player && player.putts === null) warnings.push('パット数は読み取れませんでした（空のままでも登録できます）。');
  if (parsed.note) warnings.push(`読み取り側のメモ：${parsed.note}`);

  return {
    playerIndex: picked ? picked.index : null,
    playerName: player?.name ?? null,
    matchedByName: picked?.reason === 'name' || picked?.reason === 'name-partial',
    values: {
      date: parsed.date,
      courseId: course?.id ?? '',
      courseName: course?.name ?? parsed.course ?? null,
      holes,
      outScore: out,
      inScore: inn,
      totalScore: total,
      putts: player?.putts ?? null,
    },
    warnings,
  };
}

/** 確認画面に出す1行のまとめ */
export function describeDraft(draft) {
  const v = draft.values;
  const parts = [];
  parts.push(v.date || '日付なし');
  parts.push(v.courseName || 'コース未選択');
  if (v.holes === 9) parts.push('9H');
  parts.push(v.totalScore === null ? 'スコア未読取' : `${v.totalScore}打`);
  if (v.putts !== null) parts.push(`${v.putts}パット`);
  if (draft.playerName) parts.push(`（${draft.playerName}の列）`);
  return parts.join(' / ');
}
