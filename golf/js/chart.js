// 軽量SVG折れ線グラフ。外部ライブラリは使わない（要件17）。
// viewBoxで拡大縮小するため、iPhone幅でも横スクロールを起こさない。

import { formatShort } from './date.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * @param {object} opts
 * @param {{date:string, value:number}[]} opts.series メイン系列
 * @param {{date:string, value:number}[]} [opts.average] 補助線（移動平均）
 * @param {boolean} [opts.lowerIsBetter] 小さいほど良い指標か（スコア）
 * @param {string} [opts.unit]
 * @returns {SVGElement}
 */
export function lineChart({ series, average = [], unit = '', invertHint = false }) {
  const W = 320;
  const H = 180;
  const padL = 30;
  const padR = 8;
  const padT = 12;
  const padB = 26;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart',
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  });

  if (!series.length) {
    const t = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: '#9db3c6', 'font-size': 12 });
    t.textContent = 'データがありません';
    svg.appendChild(t);
    return svg;
  }

  const values = series.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (average.length) {
    min = Math.min(min, ...average.map((p) => p.value));
    max = Math.max(max, ...average.map((p) => p.value));
  }
  if (max === min) {
    max += 1;
    min -= 1;
  }
  const span = max - min;
  min = Math.floor(min - span * 0.12);
  max = Math.ceil(max + span * 0.12);

  const x = (i) => padL + (series.length === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (series.length - 1));
  const y = (v) => padT + ((max - v) / (max - min)) * (H - padT - padB);

  // 目盛り線（3本）
  for (let i = 0; i <= 2; i++) {
    const v = min + ((max - min) * i) / 2;
    const yy = y(v);
    svg.appendChild(
      svgEl('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, stroke: '#294660', 'stroke-width': 1 })
    );
    const label = svgEl('text', {
      x: padL - 5,
      y: yy + 3.5,
      'text-anchor': 'end',
      fill: '#9db3c6',
      'font-size': 9,
    });
    label.textContent = Math.round(v);
    svg.appendChild(label);
  }

  // 移動平均
  if (average.length > 1) {
    svg.appendChild(
      svgEl('polyline', {
        points: average.map((p, i) => `${x(i)},${y(p.value)}`).join(' '),
        fill: 'none',
        stroke: '#59c2f5',
        'stroke-width': 1.6,
        'stroke-linejoin': 'round',
        'stroke-dasharray': '4 3',
      })
    );
  }

  // 本系列
  svg.appendChild(
    svgEl('polyline', {
      points: series.map((p, i) => `${x(i)},${y(p.value)}`).join(' '),
      fill: 'none',
      stroke: '#c8f542',
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    })
  );

  series.forEach((p, i) => {
    const dot = svgEl('circle', { cx: x(i), cy: y(p.value), r: 2.6, fill: '#c8f542' });
    const title = svgEl('title');
    title.textContent = `${formatShort(p.date)} ${p.value}${unit}`;
    dot.appendChild(title);
    svg.appendChild(dot);
  });

  // 最新値だけ数値を出す（狭い画面で重ならないように）
  const lastIndex = series.length - 1;
  const lastLabel = svgEl('text', {
    x: Math.min(x(lastIndex), W - padR - 4),
    y: Math.max(y(series[lastIndex].value) - 7, padT + 8),
    'text-anchor': 'end',
    fill: '#c8f542',
    'font-size': 11,
    'font-weight': 700,
  });
  lastLabel.textContent = `${series[lastIndex].value}${unit}`;
  svg.appendChild(lastLabel);

  // X軸ラベルは最初と最後のみ
  const first = svgEl('text', { x: padL, y: H - 8, fill: '#9db3c6', 'font-size': 9 });
  first.textContent = shortDate(series[0].date);
  svg.appendChild(first);
  if (series.length > 1) {
    const last = svgEl('text', { x: W - padR, y: H - 8, 'text-anchor': 'end', fill: '#9db3c6', 'font-size': 9 });
    last.textContent = shortDate(series[lastIndex].date);
    svg.appendChild(last);
  }

  if (invertHint) {
    const hint = svgEl('text', { x: W - padR, y: padT, 'text-anchor': 'end', fill: '#9db3c6', 'font-size': 9 });
    hint.textContent = '下ほど good';
    svg.appendChild(hint);
  }

  return svg;
}

function shortDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${y.slice(2)}/${m}/${d}`;
}

/** 練習実施率とスコアの散布図 */
export function scatterChart({ points }) {
  const W = 320;
  const H = 180;
  const padL = 32;
  const padR = 10;
  const padT = 12;
  const padB = 28;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });

  if (points.length < 3) {
    const t = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: '#9db3c6', 'font-size': 11 });
    t.textContent = 'ラウンドが3回たまると表示します';
    svg.appendChild(t);
    return svg;
  }

  const scores = points.map((p) => p.score);
  const minY = Math.floor(Math.min(...scores) - 2);
  const maxY = Math.ceil(Math.max(...scores) + 2);
  const x = (rate) => padL + (rate / 100) * (W - padL - padR);
  const y = (s) => padT + ((maxY - s) / (maxY - minY || 1)) * (H - padT - padB);

  for (let i = 0; i <= 2; i++) {
    const v = minY + ((maxY - minY) * i) / 2;
    svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: '#294660' }));
    const label = svgEl('text', { x: padL - 5, y: y(v) + 3.5, 'text-anchor': 'end', fill: '#9db3c6', 'font-size': 9 });
    label.textContent = Math.round(v);
    svg.appendChild(label);
  }

  points.forEach((p) => {
    const dot = svgEl('circle', { cx: x(p.rate), cy: y(p.score), r: 4, fill: '#c8f542', opacity: 0.85 });
    const title = svgEl('title');
    title.textContent = `${formatShort(p.date)} 実施率${p.rate}% / ${p.score}打`;
    dot.appendChild(title);
    svg.appendChild(dot);
  });

  const xl = svgEl('text', { x: W / 2, y: H - 6, 'text-anchor': 'middle', fill: '#9db3c6', 'font-size': 9 });
  xl.textContent = 'ラウンド前2週間の練習実施率(%)';
  svg.appendChild(xl);
  return svg;
}
