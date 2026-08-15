// node --test golf/test/consult.test.mjs
// 相談画面の回答。推測で埋めず、記録が無いことは「無い」と答えることを確認する。

import test from 'node:test';
import assert from 'node:assert/strict';

import { QUESTIONS, answerFor, buildConsultPrompt } from '../js/consult.js';
import { SEED_ROUNDS } from '../js/seed.js';
import { SEED_COURSES } from '../js/courses.js';
import { roundStats, practiceStats } from '../js/stats.js';
import { buildDiagnosis } from '../js/diagnose.js';
import { buildWeeklyPlan, restDaysOf } from '../js/plan.js';

const TODAY = '2026-08-14'; // 金曜

function ctxFor({ rounds = SEED_ROUNDS, records = [], settings = {}, carry = {}, daily = {} } = {}) {
  const state = {
    profileName: 'てらちゃん',
    settings: {
      startDate: '2026-08-01',
      targetScore: 85,
      weeklyPlan: null,
      restWeekdays: [1],
      ...settings,
    },
    carry,
    daily,
    planOverrides: {},
    collectedData: {},
  };
  const practice = practiceStats({
    startDate: state.settings.startDate,
    records,
    today: TODAY,
    restWeekdays: state.settings.restWeekdays,
  });
  return {
    state,
    rounds,
    today: TODAY,
    stats: roundStats(rounds),
    practice,
    diagnosis: buildDiagnosis({ rounds, courses: SEED_COURSES, practice, settings: state.settings }),
    booking: null,
  };
}

test('すべての質問に答えが返る', () => {
  const ctx = ctxFor();
  for (const q of QUESTIONS) {
    const lines = answerFor(q.key, ctx);
    assert.ok(Array.isArray(lines) && lines.length, `${q.key} の回答が空`);
    assert.ok(lines.every((l) => typeof l === 'string' && l.length), `${q.key} に空行が含まれる`);
  }
});

test('今日の質問には、その曜日のメニューを返す', () => {
  const lines = answerFor('today', ctxFor()).join('\n');
  assert.match(lines, /8\/14/);
  assert.match(lines, /素振り/); // 金曜の既定メニュー
});

test('休養日には「練習しなくても達成率は下がらない」と答える', () => {
  const lines = answerFor('today', { ...ctxFor(), today: '2026-08-17' }).join('\n'); // 月曜
  assert.match(lines, /休養/);
  assert.match(lines, /下がりません/);
});

test('利用者ごとの週間メニューが回答に反映される', () => {
  const plan = buildWeeklyPlan({ practiceDays: [5], minutes: 20, rangeDay: 0, focus: ['putt'] });
  const ctx = ctxFor({ settings: { weeklyPlan: plan, restWeekdays: restDaysOf(plan) } });
  const lines = answerFor('today', ctx).join('\n');
  assert.match(lines, /パター/);
  assert.match(lines, /20分/);
});

test('パットの質問：パーオン未記録なら断定せず、判別できないと答える', () => {
  const lines = answerFor('putts', ctxFor()).join('\n');
  assert.match(lines, /パット数だけでは良し悪しを判断できません/);
  assert.match(lines, /判別できません/);
});

test('パットの質問：パーオンが記録されていれば率を示す', () => {
  const rounds = SEED_ROUNDS.map((r) => ({ ...r, greensInRegulation: 5 }));
  const lines = answerFor('putts', ctxFor({ rounds })).join('\n');
  assert.match(lines, /パーオン率/);
});

test('ラウンド記録が無ければ、無いと答える', () => {
  const lines = answerFor('form', ctxFor({ rounds: [] })).join('\n');
  assert.match(lines, /記録がまだありません/);
});

test('予約が無ければ、登録方法を案内する', () => {
  const lines = answerFor('next-round', ctxFor()).join('\n');
  assert.match(lines, /予約が登録されていません/);
});

test('キャリー未登録なら、登録を促す', () => {
  const lines = answerFor('club', ctxFor()).join('\n');
  assert.match(lines, /安全キャリー/);
  assert.match(lines, /登録されていません/);
});

test('キャリー登録済みなら、その値を示す', () => {
  const carry = { '7I': { club: '7I', normalCarry: 138, safeCarry: 130 } };
  const lines = answerFor('club', ctxFor({ carry })).join('\n');
  assert.match(lines, /7I/);
  assert.match(lines, /138/);
});

test('練習が続かない相談では、実施率と減らし方を答える', () => {
  const records = [
    { date: '2026-08-04', status: 'done' },
    { date: '2026-08-05', status: 'missed' },
    { date: '2026-08-06', status: 'missed' },
  ];
  const lines = answerFor('cannot-continue', ctxFor({ records })).join('\n');
  assert.match(lines, /実施率/);
  assert.match(lines, /一部だけ実施/);
});

test('相談の回答に、励ましや叱責の表現を入れない', () => {
  const ng = ['すごい', '素晴らしい', '完璧', '最高', 'さすが', '頑張って', 'サボ', 'ダメ', '怠'];
  const ctx = ctxFor();
  for (const q of QUESTIONS) {
    const text = answerFor(q.key, ctx).join('\n');
    for (const word of ng) {
      assert.ok(!text.includes(word), `${q.key} に禁止表現「${word}」が含まれる`);
    }
  }
});

test('AIに渡す文章に、記録の要約と未記録の断りが入る', () => {
  const ctx = ctxFor();
  const prompt = buildConsultPrompt(ctx);
  assert.match(prompt, /【スコア】/);
  assert.match(prompt, /直近5ラウンド平均/);
  assert.match(prompt, /週間メニュー/);
  assert.match(prompt, /【聞きたいこと】/);
  // コースレート未登録であることを伝える
  assert.match(prompt, /コースレート：未登録/);
  // 直近5ラウンドの実データが含まれる
  assert.match(prompt, /2026-08-12/);
});

test('AIに渡す文章は、記録が無くても生成できる', () => {
  const prompt = buildConsultPrompt(ctxFor({ rounds: [] }));
  assert.match(prompt, /ラウンド記録なし/);
});
