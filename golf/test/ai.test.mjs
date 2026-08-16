import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AiError,
  DEFAULT_MODEL,
  MODELS,
  buildSystemPrompt,
  createSseParser,
  describeAiError,
  errorFromResponse,
  looksLikeKey,
  maskKey,
  streamMessage,
  textDelta,
  trimHistory,
} from '../js/ai.js';

// --- キーの形式 -------------------------------------------------------------

test('sk-ant- で始まる十分な長さのキーだけを受け付ける', () => {
  assert.equal(looksLikeKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), true);
  assert.equal(looksLikeKey('  sk-ant-api03-abcdefghijklmnopqrstuvwxyz  '), true);
  assert.equal(looksLikeKey('sk-ant-short'), false);
  assert.equal(looksLikeKey('sk-proj-abcdefghijklmnopqrstuvwxyz'), false);
  assert.equal(looksLikeKey(''), false);
  assert.equal(looksLikeKey(null), false);
});

test('キーは前後だけを見せる', () => {
  const key = 'sk-ant-api03-1234567890abcdef';
  const masked = maskKey(key);
  assert.equal(masked.includes('1234567890'), false);
  assert.ok(masked.startsWith('sk-ant-api'));
  assert.ok(masked.endsWith('cdef'));
  assert.equal(maskKey(''), '');
});

// --- SSEの解読 --------------------------------------------------------------

test('イベントが2つに分かれて届いても本文を取り出せる', () => {
  const parser = createSseParser();
  const first = parser.push('event: content_block_delta\ndata: {"type":"content_block_de');
  assert.equal(first.length, 0, '区切りが来るまでは何も返さない');

  const second = parser.push('lta","index":0,"delta":{"type":"text_delta","text":"パー"}}\n\n');
  assert.equal(second.length, 1);
  assert.equal(textDelta(second[0]), 'パー');
});

test('複数のイベントが1回で届いても順番に返す', () => {
  const parser = createSseParser();
  const chunk =
    'event: message_start\ndata: {"type":"message_start"}\n\n' +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"あ"}}\n\n' +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"い"}}\n\n';
  const events = parser.push(chunk);
  assert.equal(events.length, 3);
  assert.equal(events.map(textDelta).join(''), 'あい');
});

test('思考（thinking_delta）は本文として取り出さない', () => {
  const event = {
    type: 'content_block_delta',
    delta: { type: 'thinking_delta', thinking: '内部の考え' },
  };
  assert.equal(textDelta(event), '');
});

test('壊れたJSONやコメント行は無視する', () => {
  const parser = createSseParser();
  const events = parser.push(': ping\n\ndata: {壊れている\n\ndata: {"type":"ping"}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'ping');
});

test('\\r\\n 区切りでも読める', () => {
  const parser = createSseParser();
  const events = parser.push('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}\r\n\r\n');
  assert.equal(events.length, 1);
  assert.equal(textDelta(events[0]), 'x');
});

// --- エラーの分類 -----------------------------------------------------------

test('HTTPステータスごとに種類を分ける', () => {
  assert.equal(errorFromResponse(401, { error: { message: 'API key is invalid.' } }).kind, 'auth');
  assert.equal(errorFromResponse(429, null).kind, 'rate-limit');
  assert.equal(errorFromResponse(529, null).kind, 'overloaded');
  assert.equal(errorFromResponse(500, null).kind, 'server');
  assert.equal(errorFromResponse(400, null).kind, 'bad-request');
});

test('認証エラーの文面に、直す場所を書く', () => {
  const text = describeAiError(errorFromResponse(401, { error: { message: 'API key is invalid.' } }));
  assert.match(text, /APIキー/);
  assert.match(text, /分析タブ/);
});

test('通信できないときは、選択式が使えることを伝える', () => {
  const text = describeAiError(new AiError('network', '通信できませんでした。'));
  assert.match(text, /選択式/);
});

test('中断は失敗として扱わない', () => {
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  assert.equal(describeAiError(abort), '送信を止めました。');
});

// --- 会話履歴 ---------------------------------------------------------------

test('履歴は直近だけ残し、必ずuserから始める', () => {
  const history = [];
  for (let i = 0; i < 12; i++) {
    history.push({ role: 'user', content: `質問${i}` });
    history.push({ role: 'assistant', content: `回答${i}` });
  }
  const trimmed = trimHistory(history, 3);
  assert.equal(trimmed.length, 6);
  assert.equal(trimmed[0].role, 'user');
  assert.equal(trimmed[0].content, '質問9');
  assert.equal(trimmed[trimmed.length - 1].content, '回答11');
});

test('空の発言は送らない', () => {
  const trimmed = trimHistory([
    { role: 'user', content: '  ' },
    { role: 'user', content: '調子は？' },
  ]);
  assert.deepEqual(trimmed, [{ role: 'user', content: '調子は？' }]);
});

// --- システムプロンプト -----------------------------------------------------

test('システムプロンプトに、書き方のルールと記録の両方が入る', () => {
  const prompt = buildSystemPrompt('【スコア】\n- 平均 93', { today: '2026-08-16' });
  assert.match(prompt, /励ましも叱責も入れない/);
  assert.match(prompt, /判別できない/);
  assert.match(prompt, /2026-08-16/);
  assert.match(prompt, /平均 93/);
  assert.match(prompt, /ここに無い数値は使わない/);
});

// --- 送信 -------------------------------------------------------------------

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length ? { value: encoder.encode(chunks[index++]), done: false } : { value: undefined, done: true },
        cancel: () => {},
      }),
    },
  };
}

test('本文を少しずつ渡しながら、全体を返す', async () => {
  let captured = null;
  const full = await streamMessage({
    apiKey: 'sk-ant-test',
    system: 'ルール',
    messages: [{ role: 'user', content: '調子は？' }],
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"直近5R"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"は92.4打です。"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]);
    },
    onDelta: () => {},
  });

  assert.equal(full, '直近5Rは92.4打です。');
  assert.equal(captured.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(captured.options.headers['x-api-key'], 'sk-ant-test');
  assert.equal(captured.options.headers['anthropic-version'], '2023-06-01');
  assert.equal(captured.options.headers['anthropic-dangerous-direct-browser-access'], 'true');

  const body = JSON.parse(captured.options.body);
  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(body.stream, true);
  assert.equal(body.system, 'ルール');
  assert.ok(body.max_tokens > 0);
  // Opus 5 では 400 になるパラメータを送っていないこと
  assert.equal('temperature' in body, false);
  assert.equal('top_p' in body, false);
  assert.equal('thinking' in body, false);
});

test('選んだモデルをそのまま送る', async () => {
  let body = null;
  await streamMessage({
    apiKey: 'sk-ant-test',
    model: MODELS[2].id,
    system: 'ルール',
    messages: [{ role: 'user', content: 'x' }],
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      return sseResponse(['data: {"type":"message_stop"}\n\n']);
    },
  });
  assert.equal(body.model, MODELS[2].id);
});

test('キーが無ければ通信しない', async () => {
  let called = false;
  await assert.rejects(
    streamMessage({
      apiKey: '',
      system: 'x',
      messages: [],
      fetchImpl: async () => {
        called = true;
        return sseResponse([]);
      },
    }),
    (error) => error instanceof AiError && error.kind === 'no-key'
  );
  assert.equal(called, false);
});

test('エラー応答はAiErrorに変換する', async () => {
  await assert.rejects(
    streamMessage({
      apiKey: 'sk-ant-test',
      system: 'x',
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'rate limited' } }),
      }),
    }),
    (error) => error instanceof AiError && error.kind === 'rate-limit'
  );
});

test('通信そのものが失敗したらnetworkとして扱う', async () => {
  await assert.rejects(
    streamMessage({
      apiKey: 'sk-ant-test',
      system: 'x',
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    }),
    (error) => error instanceof AiError && error.kind === 'network'
  );
});

test('中断はそのままAbortErrorとして投げ直す', async () => {
  await assert.rejects(
    streamMessage({
      apiKey: 'sk-ant-test',
      system: 'x',
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl: async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      },
    }),
    (error) => error.name === 'AbortError'
  );
});

test('ストリームが使えない環境ではまとめて受け取る', async () => {
  const full = await streamMessage({
    apiKey: 'sk-ant-test',
    system: 'x',
    messages: [{ role: 'user', content: 'x' }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      body: null,
      text: async () =>
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"まとめ"}}\n\n',
    }),
  });
  assert.equal(full, 'まとめ');
});
