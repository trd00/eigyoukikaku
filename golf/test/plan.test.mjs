// node --test golf/test/plan.test.mjs
// 利用者ごとの週間メニュー生成。てらちゃん以外が使うときの土台になる。

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWeeklyPlan, restDaysOf, describePlan, FOCUS_OPTIONS } from '../js/plan.js';
import { effectiveMenu, stepsForWeekday, isRestWeekday, WEEKLY_MENU } from '../js/menu.js';
import { practiceStats } from '../js/stats.js';

test('選んだ曜日だけが練習日になり、残りは休養になる', () => {
  const plan = buildWeeklyPlan({ practiceDays: [2, 4], minutes: 15, rangeDay: 6, focus: ['putt'] });
  assert.equal(plan[2].type, 'putt');
  assert.equal(plan[4].type, 'putt');
  assert.equal(plan[6].type, 'range');
  for (const day of [0, 1, 3, 5]) {
    assert.equal(plan[day].type, 'rest', `${day}曜が休養になっていない`);
  }
});

test('練習時間の指定がメニューに反映される', () => {
  const plan = buildWeeklyPlan({ practiceDays: [2], minutes: 30, rangeDay: null, focus: ['direction'] });
  assert.equal(plan[2].minutes, 30);
  assert.equal(plan[2].minutesLabel, '30分');
});

test('課題を複数選ぶと練習日に順番に割り当てる', () => {
  const plan = buildWeeklyPlan({
    practiceDays: [1, 2, 3, 4],
    minutes: 15,
    rangeDay: 0,
    focus: ['putt', 'approach'],
  });
  const titles = [1, 2, 3, 4].map((d) => plan[d].title);
  assert.equal(new Set(titles).size, 2, '2種類のメニューが交互に入るべき');
  assert.notEqual(titles[0], titles[1], '同じ内容が続いている');
});

test('課題を選ばなくてもメニューは成立する', () => {
  const plan = buildWeeklyPlan({ practiceDays: [2, 5], minutes: 15, rangeDay: null, focus: [] });
  assert.ok(plan[2].title);
  assert.ok(plan[2].steps.length > 0);
});

test('打ちっぱなしの日は課題に応じて球数メニューが変わる', () => {
  const withDriver = buildWeeklyPlan({ practiceDays: [], minutes: 15, rangeDay: 0, focus: ['bigmiss'] });
  const withoutDriver = buildWeeklyPlan({ practiceDays: [], minutes: 15, rangeDay: 0, focus: ['putt'] });
  assert.ok(withDriver[0].steps.some((s) => s.includes('ドライバー')));
  assert.ok(!withoutDriver[0].steps.some((s) => s.includes('ドライバー')));
  assert.ok(withoutDriver[0].steps.some((s) => s.includes('ロングパット')));
});

test('休養日は達成率の分母から外れる', () => {
  const plan = buildWeeklyPlan({ practiceDays: [2, 4], minutes: 15, rangeDay: 6, focus: ['putt'] });
  const rest = restDaysOf(plan);
  assert.deepEqual(rest.sort(), [0, 1, 3, 5]);

  // 火曜だけ実施、他は記録なし → 分母は火・木のみ（木は未実施）
  const stats = practiceStats({
    startDate: '2026-08-11', // 火
    today: '2026-08-16', // 日
    records: [{ date: '2026-08-11', status: 'done' }],
    restWeekdays: rest,
  });
  assert.equal(stats.doneDays, 1); // 火
  assert.equal(stats.missedDays, 2); // 木・土（打ちっぱなし日）
  assert.equal(stats.restDays, 3); // 水・金・日（月は開始前）
  assert.equal(stats.achievementRate, 33);
});

test('てらちゃんの既定メニューは変わらない（月曜のみ休養）', () => {
  assert.equal(isRestWeekday(1), true);
  assert.equal(isRestWeekday(3), false);
  const stats = practiceStats({
    startDate: '2026-08-10',
    today: '2026-08-12',
    records: [{ date: '2026-08-11', status: 'done' }],
  });
  assert.equal(stats.restDays, 1);
  assert.equal(stats.doneDays, 1);
});

test('利用者の週間メニューが既定より優先される', () => {
  const plan = buildWeeklyPlan({ practiceDays: [3], minutes: 20, rangeDay: null, focus: ['approach'] });
  // 水曜はてらちゃんの既定では筋トレ
  assert.equal(WEEKLY_MENU[3].title, '軽い下半身筋トレ');
  const menu = effectiveMenu(3, {}, plan);
  assert.equal(menu.title, 'アプローチの振り幅');
  assert.equal(menu.minutesLabel, '20分');
  const steps = stepsForWeekday(3, {}, plan);
  assert.ok(steps.some((s) => s.includes('50yd')));
});

test('診断からの変更は利用者のメニューより優先される', () => {
  const plan = buildWeeklyPlan({ practiceDays: [4], minutes: 15, rangeDay: null, focus: ['approach'] });
  const overrides = { 4: { title: 'ロングパット（距離感）', minutes: 15, steps: ['10m×10球'] } };
  const menu = effectiveMenu(4, overrides, plan);
  assert.equal(menu.title, 'ロングパット（距離感）');
  assert.equal(menu.customized, true);
  assert.deepEqual(stepsForWeekday(4, overrides, plan), ['10m×10球']);
});

test('週間メニューの一覧は7日分そろう', () => {
  const plan = buildWeeklyPlan({ practiceDays: [2, 4], minutes: 15, rangeDay: 6, focus: ['putt'] });
  const rows = describePlan(plan);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((r) => r.label), ['日', '月', '火', '水', '木', '金', '土']);
});

test('課題の選択肢は重複せず、すべてラベルを持つ', () => {
  const keys = FOCUS_OPTIONS.map((o) => o.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(FOCUS_OPTIONS.every((o) => o.label && o.short));
});
