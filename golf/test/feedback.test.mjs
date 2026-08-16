// node --test golf/test/feedback.test.mjs
// メモ保存時の応答。書いた内容に対して、次にどうするかを返すことを確認する。

import test from 'node:test';
import assert from 'node:assert/strict';

import { memoFeedback, currentStreak } from '../js/feedback.js';
import { buildWeeklyPlan, restDaysOf } from '../js/plan.js';

const TODAY = '2026-08-15'; // 土曜
const SETTINGS = { weeklyPlan: null, restWeekdays: [1] };

function fb(overrides = {}) {
  return memoFeedback({ memo: '', record: {}, settings: SETTINGS, records: [], today: TODAY, ...overrides });
}

test('保存したことと、次の練習日を必ず返す', () => {
  const r = fb({ memo: 'なんとなく調子が良かった' });
  assert.match(r.headline, /記録しました/);
  assert.ok(r.lines.length >= 2);
  assert.ok(r.lines.some((l) => l.includes('次の練習は')));
});

test('メモの内容に応じた返答をする（軌道）', () => {
  const r = fb({ memo: 'ゆっくり素振りする事を意識した そうすると軌道が確認できた' });
  const text = r.lines.join('\n');
  assert.match(text, /軌道/);
  assert.match(text, /動画/); // 確認方法を具体的に示す
});

test('メモの内容に応じた返答をする（ボール位置）', () => {
  const text = fb({ memo: 'ボール位置が右になりやすい' }).lines.join('\n');
  assert.match(text, /クラブを地面に置いて/);
});

test('メモの内容に応じた返答をする（距離感）', () => {
  const text = fb({ memo: '7番のキャリーが思ったより届かない' }).lines.join('\n');
  assert.match(text, /キャリー表/);
});

test('痛みの記録は他より優先して扱う', () => {
  const r = fb({ memo: '腰に違和感', record: { pain: 'back' } });
  // 先頭で扱い、練習量を落とす／受診を検討する、まで示す
  assert.match(r.lines[0], /痛みあり/);
  assert.match(r.lines[0], /休養/);
  assert.match(r.lines[0], /受診/);
});

test('メモにだけ痛みが書かれた場合も拾う', () => {
  const text = fb({ memo: '右肘が少し痛い' }).lines.join('\n');
  assert.match(text, /痛みがある日は/);
});

test('疲労度が高ければ翌日の調整を促す', () => {
  const text = fb({ memo: '疲れた', record: { fatigue: 5 } }).lines.join('\n');
  assert.match(text, /翌日は内容を軽くする/);
});

test('メモが空でも記録された旨を返す', () => {
  const text = fb({ memo: '' }).lines.join('\n');
  assert.match(text, /空のままでも記録されます/);
});

test('心当たりのない内容でも、次に使える形で返す', () => {
  const text = fb({ memo: 'あああ' }).lines.join('\n');
  assert.match(text, /次に同じメニューをやるときの出発点/);
});

test('返答に励ましや評価の表現を入れない', () => {
  const ng = ['すごい', '素晴らしい', '完璧', '最高', 'さすが', '偉い', '頑張って', 'ダメ', 'サボ'];
  const samples = ['軌道が確認できた', '疲れた', '腰が痛い', '', 'パットが入らない'];
  for (const memo of samples) {
    const text = [fb({ memo }).headline, ...fb({ memo }).lines].join('\n');
    for (const word of ng) {
      assert.ok(!text.includes(word), `「${word}」が含まれる（memo: ${memo}）`);
    }
  }
});

test('利用者ごとの週間メニューに合わせて次の練習日を出す', () => {
  // 水曜と土曜だけ練習する設定
  const plan = buildWeeklyPlan({ practiceDays: [3], minutes: 20, rangeDay: 0, focus: ['putt'] });
  const settings = { weeklyPlan: plan, restWeekdays: restDaysOf(plan) };
  const text = fb({ memo: 'パットの距離感', settings }).lines.join('\n');
  // 土曜の次に練習があるのは日曜（打ちっぱなし）
  assert.match(text, /次の練習は日曜/);
});

// ---------------------------------------------------------------------------
// 連続実施日数
// ---------------------------------------------------------------------------

test('連続実施日数：休養日をまたいでも途切れない', () => {
  const records = [
    { date: '2026-08-15', status: 'done' }, // 土
    { date: '2026-08-14', status: 'partial' }, // 金
    { date: '2026-08-13', status: 'done' }, // 木
    // 月曜(8/10)は休養日
    { date: '2026-08-12', status: 'done' }, // 水
    { date: '2026-08-11', status: 'done' }, // 火
    { date: '2026-08-09', status: 'done' }, // 日
  ];
  assert.equal(currentStreak({ records, today: '2026-08-15' }), 6);
});

test('連続実施日数：未実施で途切れる', () => {
  const records = [
    { date: '2026-08-15', status: 'done' },
    { date: '2026-08-14', status: 'missed' },
    { date: '2026-08-13', status: 'done' },
  ];
  assert.equal(currentStreak({ records, today: '2026-08-15' }), 1);
});

test('連続実施日数：記録がなければ0', () => {
  assert.equal(currentStreak({ records: [], today: '2026-08-15' }), 0);
});

test('2日以上続いていれば見出しに日数を出す', () => {
  const records = [
    { date: '2026-08-15', status: 'done' },
    { date: '2026-08-14', status: 'done' },
  ];
  const r = fb({ memo: 'よし', records });
  assert.match(r.headline, /2日続いています/);
});

test('過去形の「〜ていた」を痛みと取り違えない', () => {
  const { lines } = memoFeedback({
    memo: 'ボール位置を右に置きすぎていた。7Iで軌道がインアウトになる感じ。',
    record: { status: 'done', pain: 'none' },
    settings: {},
    records: [],
    today: '2026-08-16',
  });
  const text = lines.join('\n');
  assert.doesNotMatch(text, /違和感|痛み/);
  assert.match(text, /軌道/, '書かれている話題（軌道）を拾う');
});

test('痛みを表す語はこれまでどおり拾う', () => {
  for (const memo of ['右肘が痛い', '腰に張りがある', '手がしびれる感じ']) {
    const { lines } = memoFeedback({
      memo,
      record: { status: 'done', pain: 'none' },
      settings: {},
      records: [],
      today: '2026-08-16',
    });
    assert.match(lines.join('\n'), /体の違和感/, memo);
  }
});
