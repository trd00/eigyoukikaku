import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScorecardPrompt,
  describeDraft,
  matchCourse,
  normalizeName,
  parseScorecardReply,
  pickPlayer,
  toDraft,
} from '../js/scorecard.js';

const COURSES = [
  { id: 'c-ube72', name: '宇部72カントリークラブ' },
  { id: 'c-yuda', name: '湯田カントリークラブ' },
];

// --- 指示文 -----------------------------------------------------------------

test('指示文に、推測させないための決まりが入る', () => {
  const prompt = buildScorecardPrompt({ myName: '寺戸', courses: COURSES, today: '2026-08-16' });
  assert.match(prompt, /JSONだけを返して/);
  assert.match(prompt, /写っていない項目は必ず null/);
  assert.match(prompt, /推測で埋めない/);
  assert.match(prompt, /寺戸/);
  assert.match(prompt, /宇部72カントリークラブ/);
  // 日付が無いときに今日の日付で埋めさせない
  assert.match(prompt, /今日の日付を入れてはいけません/);
});

// --- 返事の読み取り ---------------------------------------------------------

const REPLY = JSON.stringify({
  date: '2026-08-12',
  course: '宇部72カントリークラブ',
  holes: 18,
  players: [
    { name: '寺戸', out: 47, in: 46, total: 93, putts: 34 },
    { name: '田中', out: 50, in: 52, total: 102, putts: null },
  ],
  note: null,
});

test('素のJSONを読める', () => {
  const parsed = parseScorecardReply(REPLY);
  assert.equal(parsed.date, '2026-08-12');
  assert.equal(parsed.players.length, 2);
  assert.equal(parsed.players[0].total, 93);
  assert.equal(parsed.players[1].putts, null);
});

test('コードブロックや前置きが混ざっていても読める', () => {
  const parsed = parseScorecardReply(`読み取りました。\n\`\`\`json\n${REPLY}\n\`\`\`\nご確認ください。`);
  assert.equal(parsed.course, '宇部72カントリークラブ');
  assert.equal(parsed.players[0].out, 47);
});

test('日付の表記ゆれを揃え、ありえない日付は捨てる', () => {
  assert.equal(parseScorecardReply('{"date":"2026/8/2","players":[]}').date, '2026-08-02');
  assert.equal(parseScorecardReply('{"date":"2026-13-40","players":[]}').date, null);
  assert.equal(parseScorecardReply('{"date":"8月2日","players":[]}').date, null);
});

test('ありえない数値はnullにする（読み違いをそのまま保存させない）', () => {
  const parsed = parseScorecardReply(
    '{"players":[{"name":"寺戸","out":470,"in":46,"total":516,"putts":340}]}'
  );
  assert.equal(parsed.players[0].out, null);
  assert.equal(parsed.players[0].total, null);
  assert.equal(parsed.players[0].putts, null);
  assert.equal(parsed.players[0].in, 46);
});

test('返事が空・形が壊れているときは、はっきり失敗させる', () => {
  assert.throws(() => parseScorecardReply(''), /空/);
  assert.throws(() => parseScorecardReply('読み取れませんでした'), /受け取れませんでした/);
  assert.throws(() => parseScorecardReply('{"date": }'), /壊れて/);
});

// --- 自分の列を選ぶ ---------------------------------------------------------

test('表記ゆれがあっても名前で自分の列を当てる', () => {
  assert.equal(normalizeName(' 寺戸 　康晴 '), '寺戸康晴');
  assert.equal(normalizeName('ＴＥＲＡ'), 'tera');

  const players = [{ name: '田中' }, { name: '寺戸 康晴' }];
  assert.equal(pickPlayer(players, '寺戸康晴').index, 1);
  assert.equal(pickPlayer(players, '寺戸').index, 1, '一部だけ一致でも当てる');
});

test('1人しか写っていなければ、その人を使う', () => {
  assert.deepEqual(pickPlayer([{ name: null }], ''), { index: 0, reason: 'only-one' });
});

test('複数いて名前が当たらなければ、決めずに返す', () => {
  assert.equal(pickPlayer([{ name: '田中' }, { name: '佐藤' }], '寺戸'), null);
  assert.equal(pickPlayer([], '寺戸'), null);
});

// --- コースの照合 -----------------------------------------------------------

test('コース名は多少違っても登録済みのものに当てる', () => {
  assert.equal(matchCourse('宇部72カントリークラブ', COURSES).id, 'c-ube72');
  assert.equal(matchCourse('宇部72', COURSES).id, 'c-ube72');
  assert.equal(matchCourse('知らないゴルフ場', COURSES), null);
  assert.equal(matchCourse(null, COURSES), null);
});

// --- 下書き -----------------------------------------------------------------

test('自分の列の数字がフォームの下書きになる', () => {
  const draft = toDraft(parseScorecardReply(REPLY), { courses: COURSES, myName: '寺戸' });
  assert.deepEqual(draft.values, {
    date: '2026-08-12',
    courseId: 'c-ube72',
    courseName: '宇部72カントリークラブ',
    holes: 18,
    outScore: 47,
    inScore: 46,
    totalScore: 93,
    putts: 34,
  });
  assert.equal(draft.playerIndex, 0);
  assert.equal(draft.matchedByName, true);
  assert.deepEqual(draft.warnings, []);
});

test('列を指定すれば、その人の数字になる', () => {
  const draft = toDraft(parseScorecardReply(REPLY), { playerIndex: 1, courses: COURSES, myName: '寺戸' });
  assert.equal(draft.values.totalScore, 102);
  assert.equal(draft.playerName, '田中');
  assert.match(draft.warnings.join('\n'), /パット数は読み取れませんでした/);
});

test('OUT+INと合計が食い違えば、直させる', () => {
  const parsed = parseScorecardReply('{"players":[{"name":"寺戸","out":47,"in":46,"total":95,"putts":34}]}');
  const draft = toDraft(parsed, { courses: COURSES, myName: '寺戸' });
  assert.equal(draft.values.totalScore, 95, '画像のとおりの数字を残す');
  assert.match(draft.warnings.join('\n'), /OUT\+IN（93）と合計（95）が合いません/);
});

test('合計が無ければ OUT+IN から埋める', () => {
  const parsed = parseScorecardReply('{"players":[{"name":"寺戸","out":47,"in":46,"total":null,"putts":null}]}');
  const draft = toDraft(parsed, { courses: COURSES, myName: '寺戸' });
  assert.equal(draft.values.totalScore, 93);
});

test('9ホールならINを持たせない', () => {
  const parsed = parseScorecardReply('{"holes":9,"players":[{"name":"寺戸","out":46,"in":null,"total":null,"putts":18}]}');
  const draft = toDraft(parsed, { courses: COURSES, myName: '寺戸' });
  assert.equal(draft.values.holes, 9);
  assert.equal(draft.values.inScore, null);
  assert.equal(draft.values.totalScore, 46);
});

test('日付・コース・自分の列が決まらなければ、全部言う', () => {
  const parsed = parseScorecardReply(
    '{"date":null,"course":"知らないゴルフ場","players":[{"name":"田中","total":102},{"name":"佐藤","total":98}]}'
  );
  const draft = toDraft(parsed, { courses: COURSES, myName: '寺戸' });
  const text = draft.warnings.join('\n');
  assert.equal(draft.playerIndex, null);
  assert.match(text, /どの列が自分か決められませんでした/);
  assert.match(text, /日付が読み取れませんでした/);
  assert.match(text, /「知らないゴルフ場」は登録済みのゴルフ場に見つかりません/);
});

test('読み取り側のメモも画面に出す', () => {
  const parsed = parseScorecardReply(
    '{"date":"2026-08-12","course":"湯田カントリークラブ","players":[{"name":"寺戸","out":47,"in":46,"total":93,"putts":34}],"note":"IN の 7番がかすれていました"}'
  );
  const draft = toDraft(parsed, { courses: COURSES, myName: '寺戸' });
  assert.match(draft.warnings.join('\n'), /読み取り側のメモ：IN の 7番がかすれていました/);
});

test('まとめの1行に、確認すべきものが並ぶ', () => {
  const draft = toDraft(parseScorecardReply(REPLY), { courses: COURSES, myName: '寺戸' });
  assert.equal(describeDraft(draft), '2026-08-12 / 宇部72カントリークラブ / 93打 / 34パット / （寺戸の列）');
});
