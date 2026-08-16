import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AiError,
  PROVIDERS,
  PROVIDER_LIST,
  buildSystemPrompt,
  createSseParser,
  describeAiError,
  fetchModels,
  looksLikeKey,
  maskKey,
  providerOf,
  streamMessage,
  trimHistory,
} from '../js/ai.js';

// --- キーの形式 -------------------------------------------------------------

test('会社ごとにキーの形を見分ける', () => {
  const anthropic = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
  const google = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  const openai = 'sk-proj-abcdefghijklmnopqrstuvwxyz';

  assert.equal(looksLikeKey(anthropic, 'anthropic'), true);
  assert.equal(looksLikeKey(google, 'anthropic'), false);
  assert.equal(looksLikeKey(google, 'google'), true);
  assert.equal(looksLikeKey(anthropic, 'google'), false);
  assert.equal(looksLikeKey(openai, 'openai'), true);
  assert.equal(looksLikeKey('  ' + openai + '  ', 'openai'), true);
  assert.equal(looksLikeKey('', 'openai'), false);
  assert.equal(looksLikeKey(null, 'google'), false);
});

test('キーは前後だけを見せる', () => {
  const key = 'sk-ant-api03-1234567890abcdef';
  const masked = maskKey(key);
  assert.equal(masked.includes('1234567890'), false);
  assert.ok(masked.endsWith('cdef'));
  assert.equal(maskKey(''), '');
});

test('知らない会社を指定しても落ちない', () => {
  assert.equal(providerOf('unknown').id, 'google');
  assert.equal(PROVIDER_LIST.length, 3);
});

// --- SSEの解読 --------------------------------------------------------------

test('イベントが2つに分かれて届いても本文を取り出せる', () => {
  const parser = createSseParser();
  const first = parser.push('event: content_block_delta\ndata: {"type":"content_block_de');
  assert.equal(first.length, 0, '区切りが来るまでは何も返さない');

  const second = parser.push('lta","index":0,"delta":{"type":"text_delta","text":"パー"}}\n\n');
  assert.equal(second.length, 1);
  assert.equal(PROVIDERS.anthropic.delta(second[0]), 'パー');
});

test('壊れたJSON・コメント行・[DONE] は読み飛ばす', () => {
  const parser = createSseParser();
  const events = parser.push(': ping\n\ndata: {壊れている\n\ndata: [DONE]\n\ndata: {"type":"ping"}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'ping');
});

test('\\r\\n 区切りでも読める', () => {
  const parser = createSseParser();
  const events = parser.push('data: {"choices":[{"delta":{"content":"x"}}]}\r\n\r\n');
  assert.equal(events.length, 1);
  assert.equal(PROVIDERS.openai.delta(events[0]), 'x');
});

// --- 会社ごとの応答の読み方 -------------------------------------------------

test('Claude：本文だけを取り、思考は取らない', () => {
  assert.equal(
    PROVIDERS.anthropic.delta({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'あ' } }),
    'あ'
  );
  assert.equal(
    PROVIDERS.anthropic.delta({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '内心' } }),
    ''
  );
});

test('Gemini：candidates の中の text をつなぐ', () => {
  const event = { candidates: [{ content: { parts: [{ text: '直近5R' }, { text: 'は92.4打' }] } }] };
  assert.equal(PROVIDERS.google.delta(event), '直近5Rは92.4打');
  assert.equal(PROVIDERS.google.delta({ candidates: [{ content: {} }] }), '');
});

test('ChatGPT：choices の delta.content を取る', () => {
  assert.equal(PROVIDERS.openai.delta({ choices: [{ delta: { content: 'は' } }] }), 'は');
  assert.equal(PROVIDERS.openai.delta({ choices: [{ delta: {} }] }), '');
});

// --- エラーの分類 -----------------------------------------------------------

test('HTTPステータスごとに種類を分ける', () => {
  assert.equal(PROVIDERS.anthropic.error(401, { error: { message: 'API key is invalid.' } }).kind, 'auth');
  assert.equal(PROVIDERS.anthropic.error(429, null).kind, 'rate-limit');
  assert.equal(PROVIDERS.anthropic.error(529, null).kind, 'overloaded');
  assert.equal(PROVIDERS.anthropic.error(500, null).kind, 'server');
  assert.equal(PROVIDERS.openai.error(400, null).kind, 'bad-request');
});

test('Geminiはキーの誤りも400で返すので、認証エラーに訳す', () => {
  const error = PROVIDERS.google.error(400, {
    error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' },
  });
  assert.equal(error.kind, 'auth');
});

test('無料枠の上限は、待てばいいと分かる文面にする', () => {
  assert.match(PROVIDERS.google.error(429, null).message, /無料枠|置いて/);
});

test('認証エラーの文面に、直す場所を書く', () => {
  const text = describeAiError(PROVIDERS.anthropic.error(401, { error: { message: 'API key is invalid.' } }));
  assert.match(text, /APIキー/);
  assert.match(text, /分析タブ/);
});

test('通信できないときは、選択式が使えることを伝える', () => {
  assert.match(describeAiError(new AiError('network', '通信できませんでした。')), /選択式/);
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
          index < chunks.length
            ? { value: encoder.encode(chunks[index++]), done: false }
            : { value: undefined, done: true },
        cancel: () => {},
      }),
    },
  };
}

function capture(response) {
  const seen = {};
  return {
    seen,
    fetchImpl: async (url, init) => {
      seen.url = url;
      seen.init = init;
      seen.body = init.body ? JSON.parse(init.body) : null;
      return response;
    },
  };
}

test('Claude：URL・ヘッダ・本文が仕様どおり', async () => {
  const { seen, fetchImpl } = capture(
    sseResponse([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"直近5R"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"は92.4打です。"}}\n\n',
    ])
  );
  const pieces = [];
  const full = await streamMessage({
    providerId: 'anthropic',
    apiKey: 'sk-ant-test',
    model: 'claude-opus-5',
    system: 'ルール',
    messages: [{ role: 'user', content: '調子は？' }],
    fetchImpl,
    onDelta: (p) => pieces.push(p),
  });

  assert.equal(full, '直近5Rは92.4打です。');
  assert.equal(pieces.length, 2, '届いた分ずつ画面へ渡す');
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'sk-ant-test');
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(seen.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(seen.body.model, 'claude-opus-5');
  assert.equal(seen.body.stream, true);
  assert.equal(seen.body.system, 'ルール');
  // Opus 5 では 400 になるパラメータを送っていないこと
  assert.equal('temperature' in seen.body, false);
  assert.equal('thinking' in seen.body, false);
});

test('Gemini：モデル名がURLに入り、相手役はmodelになる', async () => {
  const { seen, fetchImpl } = capture(
    sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"はい"}]}}]}\n\n'])
  );
  const full = await streamMessage({
    providerId: 'google',
    apiKey: 'AIzaTEST',
    model: 'gemini-2.5-flash',
    system: 'ルール',
    messages: [
      { role: 'user', content: '調子は？' },
      { role: 'assistant', content: '前回の答え' },
      { role: 'user', content: 'その続き' },
    ],
    fetchImpl,
  });

  assert.equal(full, 'はい');
  assert.match(seen.url, /models\/gemini-2\.5-flash:streamGenerateContent\?alt=sse$/);
  assert.equal(seen.init.headers['x-goog-api-key'], 'AIzaTEST');
  assert.equal(seen.body.systemInstruction.parts[0].text, 'ルール');
  assert.deepEqual(
    seen.body.contents.map((c) => c.role),
    ['user', 'model', 'user']
  );
  assert.equal(seen.body.contents[1].parts[0].text, '前回の答え');
});

test('ChatGPT：systemは先頭のメッセージとして送る', async () => {
  const { seen, fetchImpl } = capture(
    sseResponse(['data: {"choices":[{"delta":{"content":"はい"}}]}\n\n', 'data: [DONE]\n\n'])
  );
  const full = await streamMessage({
    providerId: 'openai',
    apiKey: 'sk-test-openai',
    model: 'gpt-5',
    system: 'ルール',
    messages: [{ role: 'user', content: '調子は？' }],
    fetchImpl,
  });

  assert.equal(full, 'はい');
  assert.equal(seen.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(seen.init.headers.authorization, 'Bearer sk-test-openai');
  assert.equal(seen.body.stream, true);
  assert.deepEqual(seen.body.messages[0], { role: 'system', content: 'ルール' });
  assert.equal(seen.body.messages[1].content, '調子は？');
});

test('キーが無ければ通信しない', async () => {
  let called = false;
  await assert.rejects(
    streamMessage({
      providerId: 'google',
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
      providerId: 'openai',
      apiKey: 'sk-test-openai',
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
      providerId: 'anthropic',
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
      providerId: 'anthropic',
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

test('ストリームの途中でエラーが来たら止める', async () => {
  await assert.rejects(
    streamMessage({
      providerId: 'google',
      apiKey: 'AIzaTEST',
      system: 'x',
      messages: [{ role: 'user', content: 'x' }],
      fetchImpl: async () => sseResponse(['data: {"error":{"message":"内部エラー"}}\n\n']),
    }),
    (error) => error instanceof AiError && /内部エラー/.test(error.message)
  );
});

test('ストリームが使えない環境ではまとめて受け取る', async () => {
  const full = await streamMessage({
    providerId: 'anthropic',
    apiKey: 'sk-ant-test',
    system: 'x',
    messages: [{ role: 'user', content: 'x' }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      body: null,
      text: async () => 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"まとめ"}}\n\n',
    }),
  });
  assert.equal(full, 'まとめ');
});

// --- モデル一覧 -------------------------------------------------------------

test('Claude：使えるモデルの一覧を取る', async () => {
  const models = await fetchModels({
    providerId: 'anthropic',
    apiKey: 'sk-ant-test',
    fetchImpl: async (url, init) => {
      assert.match(url, /\/v1\/models/);
      assert.equal(init.headers['x-api-key'], 'sk-ant-test');
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: 'claude-opus-5', display_name: 'Claude Opus 5' },
            { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
          ],
        }),
      };
    },
  });
  assert.deepEqual(models, [
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ]);
});

test('Gemini：文章を作れるモデルだけを残す', async () => {
  const models = await fetchModels({
    providerId: 'google',
    apiKey: 'AIzaTEST',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', displayName: '埋め込み', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-embedding-001', displayName: '埋め込み2', supportedGenerationMethods: ['generateContent'] },
        ],
      }),
    }),
  });
  assert.deepEqual(models, [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }]);
});

test('ChatGPT：会話に使えないモデルを外す', async () => {
  const models = await fetchModels({
    providerId: 'openai',
    apiKey: 'sk-test-openai',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-5' },
          { id: 'gpt-4o-audio-preview' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' },
          { id: 'o3' },
        ],
      }),
    }),
  });
  assert.deepEqual(
    models.map((m) => m.id),
    ['gpt-5', 'o3']
  );
});

test('一覧が取れなくても、既定の名前で送れるよう空を返す', async () => {
  const models = await fetchModels({
    providerId: 'google',
    apiKey: 'AIzaTEST',
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.deepEqual(models, []);
  assert.ok(PROVIDERS.google.fallbackModels.length);
});
