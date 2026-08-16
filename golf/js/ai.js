// 相談画面から実際のAIへ問い合わせる部分。
//
// 方針:
// - 会社を選べるようにする（Claude / Gemini / ChatGPT）。使う人が自分のキーを貼る。
// - APIキーは利用者本人のもので、この端末のlocalStorageにだけ置く。クラウド同期には載せない。
// - ブラウザから直接叩く。Anthropic は anthropic-dangerous-direct-browser-access が要る。
//   （api.anthropic.com と generativelanguage.googleapis.com は、この用途を許可することを実際に確認済み）
// - 応答はストリーミングで受け取る。待ち時間中に画面が固まらないようにするため。
// - キーが未設定・通信不可のときは、これまでのローカル回答（consult.js）へ黙って戻す。
//
// 注意: サブスク（ChatGPT Plus / Claude Pro など）ではAPIは使えない。APIは別契約。

const STORE_KEY = 'trd-golf-ai-v2';
const OLD_STORE_KEY = 'trd-golf-ai-v1';

export const DEFAULT_MAX_TOKENS = 4000;

/** 相談画面でAIに守らせる書き方。要件どおり、励ましも叱責も入れない。 */
export const TONE_RULES = [
  'あなたは、この相談者のゴルフの練習とスコアを見ているコーチです。',
  '答え方の決まり：',
  '- 「事実 → そこから言えること → 次にやること」の順で書く。',
  '- 励ましも叱責も入れない。「頑張りましょう」「素晴らしい」「もっと真剣に」などは書かない。',
  '- 記録にない数値を作らない。書かれていないことは書かれていないと言う。',
  '- 判別できないことは「この記録では判別できない」と書き、それを確定させるために次のラウンドか練習で何を数えればいいかを1つだけ挙げる。',
  '- コースレートが未登録なら、コース難易度の補正ができていない前提で話す。難易度を推測しない。',
  '- 痛みの記録があるときは、他の助言より先に練習量を落とす案内をする。診断や治療の判断はしない。',
  '- 日本語で、全体で400字程度まで。箇条書きは3項目まで。前置きと結びのあいさつは書かない。',
  '- 相談者は日本のアマチュアゴルファーで、平均は90台。専門用語は説明なしで使ってよい。',
].join('\n');

// ---------------------------------------------------------------------------
// エラー
// ---------------------------------------------------------------------------

export class AiError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
  }
}

function commonError(status, message) {
  const detail = message ? `（${message}）` : '';
  if (status === 401 || status === 403) return new AiError('auth', `APIキーが違うか、使えない状態です${detail}`);
  if (status === 404) return new AiError('bad-request', `指定したモデルが見つかりません${detail}`);
  if (status === 413) return new AiError('too-large', '送る記録が大きすぎます。メモを減らすか、モデルを変えてください。');
  if (status === 429) return new AiError('rate-limit', '短時間に送りすぎか、無料枠の上限です。少し置いてから、もう一度送ってください。');
  if (status === 529 || status === 503) return new AiError('overloaded', 'AI側が混み合っています。少し待ってから、もう一度送ってください。');
  if (status >= 500) return new AiError('server', `AI側で問題が起きました${detail}`);
  if (status === 400) return new AiError('bad-request', `送った内容をAPIが受け付けませんでした${detail}`);
  return new AiError('unknown', `応答を受け取れませんでした（${status}）${detail}`);
}

// ---------------------------------------------------------------------------
// 会社ごとの違い
// ---------------------------------------------------------------------------

/**
 * それぞれの会社について、URL・ヘッダ・本文・応答の読み方だけを差し替える。
 * 共通の流れ（送る→少しずつ受け取る→エラーを訳す）は streamMessage 側に置く。
 */
export const PROVIDERS = {
  anthropic: {
    id: 'anthropic',
    label: 'Claude（Anthropic）',
    keyPlaceholder: 'sk-ant-...',
    keySite: 'console.anthropic.com',
    keyHelp: 'console.anthropic.com でアカウントを作り、「API keys」から発行します。',
    costNote: '無料枠なし。使った分だけ自分のアカウントに請求されます（Opus 5 で 入力$5／出力$25 per 1Mトークン）。',
    subscriptionNote: 'Claude Pro / Max のサブスクとは別契約です。サブスクではAPIは使えません。',
    fallbackModels: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    validateKey: (value) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(value),
    modelsRequest: (apiKey) => ({
      url: 'https://api.anthropic.com/v1/models?limit=100',
      init: {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      },
    }),
    parseModels: (json) =>
      (json?.data || [])
        .map((m) => ({ id: m.id, label: m.display_name || m.id }))
        .filter((m) => m.id),
    // 画像は本文より前に置く（そのほうが読み取りが安定する）
    toMessages: (messages) =>
      messages.map((m) => ({
        role: m.role,
        content: m.images?.length
          ? [
              ...m.images.map((img) => ({
                type: 'image',
                source: { type: 'base64', media_type: img.mediaType, data: img.data },
              })),
              { type: 'text', text: m.content },
            ]
          : m.content,
      })),
    request: ({ apiKey, model, system, messages, maxTokens }) => ({
      url: 'https://api.anthropic.com/v1/messages',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          stream: true,
          system,
          messages: PROVIDERS.anthropic.toMessages(messages),
        }),
      },
    }),
    delta: (event) => {
      if (event?.type !== 'content_block_delta') return '';
      const d = event.delta || {};
      // thinking_delta（内部の考え）は画面に出さない
      return d.type === 'text_delta' && typeof d.text === 'string' ? d.text : '';
    },
    streamError: (event) => (event?.type === 'error' ? event.error?.message || null : null),
    error: (status, body) => commonError(status, body?.error?.message),
  },

  google: {
    id: 'google',
    label: 'Gemini（Google）',
    keyPlaceholder: 'AIza...',
    keySite: 'aistudio.google.com',
    keyHelp: 'aistudio.google.com にGoogleアカウントで入り、「Get API key」から発行します。カード登録なしで作れます。',
    costNote:
      '無料枠があります（1分あたり・1日あたりの回数に上限あり）。上限を超えると、待つか有料に切り替えることになります。',
    subscriptionNote:
      '無料枠では、送った内容がGoogleの製品改善に使われる場合があるとGoogleは説明しています。気になる場合は有料枠か他社を選んでください。',
    fallbackModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    validateKey: (value) => /^AIza[A-Za-z0-9_-]{20,}$/.test(value),
    modelsRequest: (apiKey) => ({
      url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      init: { headers: { 'x-goog-api-key': apiKey } },
    }),
    parseModels: (json) =>
      (json?.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || m.name }))
        .filter((m) => m.id && !/embedding|aqa/i.test(m.id)),
    // Geminiは相手役を model と呼ぶ
    toMessages: (messages) =>
      messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          ...(m.images || []).map((img) => ({
            inlineData: { mimeType: img.mediaType, data: img.data },
          })),
          { text: m.content },
        ],
      })),
    request: ({ apiKey, model, system, messages, maxTokens }) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: PROVIDERS.google.toMessages(messages),
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      },
    }),
    delta: (event) => {
      const parts = event?.candidates?.[0]?.content?.parts || [];
      return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
    },
    streamError: (event) => event?.error?.message || null,
    error: (status, body) => {
      const message = body?.error?.message;
      // Googleはキーの誤りも400で返す
      if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(message || '')) {
        return new AiError('auth', 'APIキーが違うか、使えない状態です');
      }
      if (status === 400 && /quota|billing/i.test(message || '')) {
        return new AiError('rate-limit', '無料枠の上限に達しています。時間を置くか、有料に切り替えてください。');
      }
      return commonError(status, message);
    },
  },

  openai: {
    id: 'openai',
    label: 'ChatGPT（OpenAI）',
    keyPlaceholder: 'sk-...',
    keySite: 'platform.openai.com',
    keyHelp: 'platform.openai.com でアカウントを作り、「API keys」から発行します。',
    costNote: '無料枠なし。先に金額をチャージするか、支払い方法の登録が要ります。',
    subscriptionNote: 'ChatGPT Plus / Pro のサブスクとは別契約です。サブスクではAPIは使えません。',
    fallbackModels: ['gpt-5', 'gpt-5-mini', 'gpt-4o'],
    validateKey: (value) => /^sk-[A-Za-z0-9_-]{20,}$/.test(value),
    modelsRequest: (apiKey) => ({
      url: 'https://api.openai.com/v1/models',
      init: { headers: { authorization: `Bearer ${apiKey}` } },
    }),
    parseModels: (json) =>
      (json?.data || [])
        .map((m) => ({ id: m.id, label: m.id }))
        .filter(
          (m) =>
            m.id &&
            /^(gpt-|o\d)/.test(m.id) &&
            !/audio|realtime|image|embedding|tts|whisper|moderation|transcribe|search|instruct/i.test(m.id)
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
    toMessages: (messages) =>
      messages.map((m) =>
        m.images?.length
          ? {
              role: m.role,
              content: [
                ...m.images.map((img) => ({
                  type: 'image_url',
                  image_url: { url: `data:${img.mediaType};base64,${img.data}` },
                })),
                { type: 'text', text: m.content },
              ],
            }
          : { role: m.role, content: m.content }
      ),
    request: ({ apiKey, model, system, messages, maxTokens }) => ({
      url: 'https://api.openai.com/v1/chat/completions',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          stream: true,
          max_completion_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, ...PROVIDERS.openai.toMessages(messages)],
        }),
      },
    }),
    delta: (event) => {
      const piece = event?.choices?.[0]?.delta?.content;
      return typeof piece === 'string' ? piece : '';
    },
    streamError: (event) => event?.error?.message || null,
    error: (status, body) => commonError(status, body?.error?.message),
  },
};

export const PROVIDER_LIST = [PROVIDERS.google, PROVIDERS.anthropic, PROVIDERS.openai];
export const DEFAULT_PROVIDER = 'google';

export function providerOf(id) {
  return PROVIDERS[id] || PROVIDERS[DEFAULT_PROVIDER];
}

// ---------------------------------------------------------------------------
// 設定の保存
// ---------------------------------------------------------------------------

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // プライベートブラウズなどで例外になる場合がある
  }
}

function emptyConfig() {
  return { provider: DEFAULT_PROVIDER, keys: {}, models: {}, modelLists: {} };
}

/** @returns {{provider: string, keys: object, models: object, modelLists: object}} */
export function loadAiConfig() {
  const store = storage();
  if (!store) return emptyConfig();
  try {
    const raw = store.getItem(STORE_KEY);
    if (raw) return normalizeConfig(JSON.parse(raw));
    // v1（Anthropic専用）で保存されていたものを引き継ぐ
    const old = store.getItem(OLD_STORE_KEY);
    if (old) {
      const parsed = JSON.parse(old);
      if (parsed?.apiKey) {
        return normalizeConfig({
          provider: 'anthropic',
          keys: { anthropic: parsed.apiKey },
          models: { anthropic: parsed.model },
        });
      }
    }
  } catch {
    // 壊れていたら初期状態として扱う
  }
  return emptyConfig();
}

function normalizeConfig(parsed) {
  const config = emptyConfig();
  if (PROVIDERS[parsed?.provider]) config.provider = parsed.provider;
  for (const id of Object.keys(PROVIDERS)) {
    const key = parsed?.keys?.[id];
    if (typeof key === 'string' && key) config.keys[id] = key;
    const model = parsed?.models?.[id];
    if (typeof model === 'string' && model) config.models[id] = model;
    const list = parsed?.modelLists?.[id];
    if (Array.isArray(list)) config.modelLists[id] = list.filter((m) => m && m.id);
  }
  return config;
}

export function saveAiConfig(config) {
  const next = normalizeConfig(config);
  const store = storage();
  if (store) {
    try {
      store.setItem(STORE_KEY, JSON.stringify(next));
      store.removeItem(OLD_STORE_KEY);
    } catch {
      // 保存できなくても、その場の会話は続けられる
    }
  }
  return next;
}

/** 今使う会社のキー・モデルを取り出す */
export function activeConfig(config = loadAiConfig()) {
  const provider = providerOf(config.provider);
  const models = modelChoices(config, provider.id);
  const saved = config.models[provider.id];
  return {
    provider,
    apiKey: config.keys[provider.id] || '',
    model: saved || models[0]?.id || provider.fallbackModels[0],
    models,
  };
}

/** APIから取れた一覧を優先し、取れていなければ既定の名前を出す */
export function modelChoices(config, providerId) {
  const list = config.modelLists?.[providerId];
  if (Array.isArray(list) && list.length) return list;
  return providerOf(providerId).fallbackModels.map((id) => ({ id, label: id }));
}

export function clearAiConfig(providerId) {
  const config = loadAiConfig();
  if (!providerId) {
    const store = storage();
    if (store) {
      try {
        store.removeItem(STORE_KEY);
        store.removeItem(OLD_STORE_KEY);
      } catch {
        // 何もしない
      }
    }
    return emptyConfig();
  }
  delete config.keys[providerId];
  delete config.models[providerId];
  delete config.modelLists[providerId];
  return saveAiConfig(config);
}

export function isAiConfigured() {
  return Boolean(activeConfig().apiKey);
}

/** 貼り間違いをその場で気づけるようにする。形式の確認だけで、正しさは通信して初めて分かる。 */
export function looksLikeKey(value, providerId) {
  return providerOf(providerId).validateKey(String(value || '').trim());
}

/** 画面に出すとき用。全部は出さない。 */
export function maskKey(value) {
  const key = String(value || '').trim();
  if (key.length <= 12) return key ? '••••' : '';
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// SSE（ストリーミング応答）の解読
// ---------------------------------------------------------------------------

/**
 * 受信した文字列の断片を渡すと、区切りの揃ったイベントだけを返す。
 * 断片は行の途中で切れることがあるため、状態を持たせる。
 */
export function createSseParser() {
  let buffer = '';
  return {
    push(chunk) {
      buffer += String(chunk).replace(/\r\n/g, '\n');
      const events = [];
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = parseSseBlock(raw);
        if (event) events.push(event);
      }
      return events;
    },
  };
}

function parseSseBlock(raw) {
  const data = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  const text = data.join('\n');
  if (text === '[DONE]') return null; // OpenAIの終わりの合図
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 送信
// ---------------------------------------------------------------------------

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * 選んだ会社のAPIへ投げ、本文を少しずつ onDelta へ渡す。
 * @returns {Promise<string>} 本文全体
 */
export async function streamMessage({
  providerId,
  apiKey,
  model,
  system,
  messages,
  maxTokens = DEFAULT_MAX_TOKENS,
  signal,
  onDelta,
  fetchImpl,
}) {
  const provider = providerOf(providerId);
  if (!apiKey) throw new AiError('no-key', 'APIキーが設定されていません。');
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new AiError('network', 'この環境では通信できません。');

  const { url, init } = provider.request({
    apiKey,
    model: model || provider.fallbackModels[0],
    system,
    messages,
    maxTokens,
  });

  let response;
  try {
    response = await doFetch(url, { ...init, signal });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new AiError('network', '通信できませんでした。');
  }

  if (!response.ok) throw provider.error(response.status, await readJson(response));

  if (!response.body || typeof response.body.getReader !== 'function') {
    // ストリームが使えない環境向け。まとめて受け取ってから同じ形に均す。
    const text = await response.text();
    return collect(provider, text.endsWith('\n\n') ? text : `${text}\n\n`, onDelta);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  let full = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        const failure = provider.streamError(event);
        if (failure) throw new AiError('server', failure);
        const piece = provider.delta(event);
        if (piece) {
          full += piece;
          if (onDelta) onDelta(piece);
        }
      }
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      // 中断済みなら何もしない
    }
  }
  return full;
}

function collect(provider, text, onDelta) {
  const parser = createSseParser();
  let full = '';
  for (const event of parser.push(text)) {
    const piece = provider.delta(event);
    if (piece) {
      full += piece;
      if (onDelta) onDelta(piece);
    }
  }
  return full;
}

/** 1回だけ聞いて、返事を全部まとめて受け取る（画像の読み取りなど、途中経過が要らない用途） */
export function askOnce(options) {
  return streamMessage({ ...options, onDelta: undefined });
}

/**
 * 使えるモデルの一覧をAPIから取る。取れなければ空を返し、呼び出し側は既定の名前を使う。
 */
export async function fetchModels({ providerId, apiKey, fetchImpl }) {
  const provider = providerOf(providerId);
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!doFetch || !apiKey) return [];
  const { url, init } = provider.modelsRequest(apiKey);
  let response;
  try {
    response = await doFetch(url, init);
  } catch {
    return [];
  }
  if (!response.ok) throw provider.error(response.status, await readJson(response));
  const json = await readJson(response);
  try {
    return provider.parseModels(json) || [];
  } catch {
    return [];
  }
}

/** 画面に出す1行。原因ごとに、次にやることまで書く。 */
export function describeAiError(error) {
  if (!error) return '原因の分からない失敗です。';
  if (error.name === 'AbortError') return '送信を止めました。';
  if (error instanceof AiError) {
    if (error.kind === 'no-key') return 'AIのキーが設定されていません。分析タブの「AIに相談する設定」から登録してください。';
    if (error.kind === 'auth') return `${error.message} 分析タブの「AIに相談する設定」でキーを入れ直してください。`;
    if (error.kind === 'network')
      return '通信できませんでした。電波の届く場所で、もう一度送ってください。オフラインのときは選択式の質問だけ使えます。';
    return error.message;
  }
  const text = String(error.message || error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(text)) {
    return '通信できませんでした。電波の届く場所で、もう一度送ってください。';
  }
  return `送信に失敗しました（${text}）`;
}

/**
 * 記録の要約に、書き方のルールを足してシステムプロンプトにする。
 * @param {string} recordText buildConsultPrompt の出力
 */
export function buildSystemPrompt(recordText, { today } = {}) {
  const head = today ? `${TONE_RULES}\n- 今日は ${today} です。` : TONE_RULES;
  return `${head}\n\n以下がこの相談者の記録です。ここに無い数値は使わないでください。\n\n${recordText}`;
}

/**
 * 会話の履歴を、APIへ送れる形に整える。
 * 長くなりすぎないよう、直近の往復だけ残す。
 */
export function trimHistory(messages, keepTurns = 8) {
  const cleaned = (messages || []).filter((m) => m && m.content && String(m.content).trim());
  const kept = cleaned.slice(-keepTurns * 2);
  // 先頭は必ず user から始める（API の制約）
  while (kept.length && kept[0].role !== 'user') kept.shift();
  return kept.map((m) => ({ role: m.role, content: String(m.content) }));
}
