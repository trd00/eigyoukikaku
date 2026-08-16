// 相談画面から実際のAI（Anthropic Messages API）へ問い合わせる部分。
//
// 方針:
// - APIキーは利用者本人のもので、この端末のlocalStorageにだけ置く。クラウド同期には載せない。
// - ブラウザから直接叩くため、anthropic-dangerous-direct-browser-access を付ける。
//   （api.anthropic.com は Access-Control-Allow-Origin: * を返し、このヘッダを許可している）
// - 応答はストリーミングで受け取る。待ち時間中に画面が固まらないようにするため。
// - キーが未設定・通信不可のときは、これまでのローカル回答（consult.js）へ黙って戻す。

const STORE_KEY = 'trd-golf-ai-v1';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/** 選べるモデル。料金は 100万トークンあたりの目安（入力／出力）。 */
export const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5（いちばん精度が高い）', price: '入力 $5 / 出力 $25' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5（標準）', price: '入力 $3 / 出力 $15' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5（安い・軽い）', price: '入力 $1 / 出力 $5' },
];

export const DEFAULT_MODEL = 'claude-opus-5';
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
// 設定の保存
// ---------------------------------------------------------------------------

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // プライベートブラウズなどで例外になる場合がある
  }
}

/** @returns {{apiKey: string, model: string}} */
export function loadAiConfig() {
  const store = storage();
  if (!store) return { apiKey: '', model: DEFAULT_MODEL };
  try {
    const raw = store.getItem(STORE_KEY);
    if (!raw) return { apiKey: '', model: DEFAULT_MODEL };
    const parsed = JSON.parse(raw);
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: MODELS.some((m) => m.id === parsed.model) ? parsed.model : DEFAULT_MODEL,
    };
  } catch {
    return { apiKey: '', model: DEFAULT_MODEL };
  }
}

export function saveAiConfig({ apiKey, model }) {
  const store = storage();
  const next = {
    apiKey: String(apiKey || '').trim(),
    model: MODELS.some((m) => m.id === model) ? model : DEFAULT_MODEL,
  };
  if (store) {
    try {
      store.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // 保存できなくても、その場の会話は続けられる
    }
  }
  return next;
}

export function clearAiConfig() {
  const store = storage();
  if (store) {
    try {
      store.removeItem(STORE_KEY);
    } catch {
      // 何もしない
    }
  }
}

export function isAiConfigured() {
  return Boolean(loadAiConfig().apiKey);
}

/** 貼り間違いをその場で気づけるようにする。形式の確認だけで、正しさは通信して初めて分かる。 */
export function looksLikeKey(value) {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(value || '').trim());
}

/** 画面に出すとき用。全部は出さない。 */
export function maskKey(value) {
  const key = String(value || '').trim();
  if (key.length <= 12) return key ? '••••' : '';
  return `${key.slice(0, 11)}…${key.slice(-4)}`;
}

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

/** HTTPステータスと本文から、利用者に見せる種類へ落とす。 */
export function errorFromResponse(status, body) {
  const detail = body?.error?.message ? `（${body.error.message}）` : '';
  if (status === 401 || status === 403) return new AiError('auth', `APIキーが違うか、使えない状態です${detail}`);
  if (status === 400) return new AiError('bad-request', `送った内容をAPIが受け付けませんでした${detail}`);
  if (status === 404) return new AiError('bad-request', `指定したモデルが見つかりません${detail}`);
  if (status === 413) return new AiError('too-large', '送る記録が大きすぎます。メモを減らすか、モデルを変えてください。');
  if (status === 429) return new AiError('rate-limit', '短時間に送りすぎです。1分ほど置いてから、もう一度送ってください。');
  if (status === 529 || status === 503) return new AiError('overloaded', 'AI側が混み合っています。少し待ってから、もう一度送ってください。');
  if (status >= 500) return new AiError('server', `AI側で問題が起きました${detail}`);
  return new AiError('unknown', `応答を受け取れませんでした（${status}）${detail}`);
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
  if (text === '[DONE]') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 画面に出す本文だけを取り出す。思考（thinking）は取り出さない。 */
export function textDelta(event) {
  if (!event || event.type !== 'content_block_delta') return '';
  const delta = event.delta || {};
  return delta.type === 'text_delta' && typeof delta.text === 'string' ? delta.text : '';
}

// ---------------------------------------------------------------------------
// 送信
// ---------------------------------------------------------------------------

/**
 * Messages API へ投げ、本文を少しずつ onDelta へ渡す。
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.model]
 * @param {string} options.system 記録と書き方のルール
 * @param {Array<{role: string, content: string}>} options.messages 会話の履歴
 * @param {number} [options.maxTokens]
 * @param {AbortSignal} [options.signal]
 * @param {(text: string) => void} [options.onDelta]
 * @param {typeof fetch} [options.fetchImpl] テスト用
 * @returns {Promise<string>} 本文全体
 */
export async function streamMessage({
  apiKey,
  model = DEFAULT_MODEL,
  system,
  messages,
  maxTokens = DEFAULT_MAX_TOKENS,
  signal,
  onDelta,
  fetchImpl,
}) {
  if (!apiKey) throw new AiError('no-key', 'APIキーが設定されていません。');
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new AiError('network', 'この環境では通信できません。');

  let response;
  try {
    response = await doFetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        system,
        messages,
      }),
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new AiError('network', '通信できませんでした。');
  }

  if (!response.ok) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // 本文が読めないこともある
    }
    throw errorFromResponse(response.status, body);
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    // ストリームが使えない環境向け。まとめて受け取ってから同じ形に均す。
    const text = await response.text();
    return collectFromSse(text, onDelta);
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
        if (event.type === 'error') throw new AiError('server', event.error?.message || 'AI側が応答を中断しました。');
        const piece = textDelta(event);
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

function collectFromSse(text, onDelta) {
  const parser = createSseParser();
  let full = '';
  for (const event of parser.push(text.endsWith('\n\n') ? text : `${text}\n\n`)) {
    const piece = textDelta(event);
    if (piece) {
      full += piece;
      if (onDelta) onDelta(piece);
    }
  }
  return full;
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
