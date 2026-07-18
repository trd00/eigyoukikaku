/**
 * 車検 事前カルテ Webアプリ ― GASバックエンド
 *
 * 【設計方針】
 *  ・システム本体もスプレッドシートも当社が1つだけ持つ（マルチテナント）。
 *  ・工場ごとにコピーは作らない。工場の区別は URL の ?shop=xxx だけで行う。
 *  ・工場が増えたら「工場マスタ」に1行足す＋QRを1枚作るだけ。コードは触らない。
 *
 * 【画面の出し分け（doGet）】
 *  ・お客さま入力画面 : ?shop=xxx            → form.html
 *  ・フロント確認画面 : ?shop=xxx&view=desk  → desk.html
 *
 * 【個人情報の方針】
 *  ・重い個人情報は持たない。氏名は任意・呼び名でOK・空欄可。
 *  ・ナンバーは下4桁のみ。フルのナンバーは取らない。
 *  ・その場の提案に使うためのツールであり、長期名簿としては使わない。
 *
 * 既存「スマート営業報告システム」と同じ作法：
 *  doGet でパラメータ分岐 → google.script.run でサーバー通信 → スプレッドシートに追記。
 */

// シート名・ヘッダー定義（1か所にまとめておく）
const SHEET_ANSWER = '回答';
const SHEET_SHOP   = '工場マスタ';
const ANSWER_HEADERS = ['タイムスタンプ', '工場ID', '氏名', '車種', 'ナンバー下4桁', '走行距離', '困りごと', '自由記入'];
const TZ = 'Asia/Tokyo';


// 🌟 1. Webアプリの画面を表示する処理（?shop / ?view で出し分け）
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const shop = String(params.shop || '').trim();
  const view = String(params.view || '').trim();

  // フロント確認画面
  if (view === 'desk') {
    const t = HtmlService.createTemplateFromFile('desk');
    t.shop = shop;
    t.shopName = getShopName(shop);
    return t.evaluate()
      .setTitle('🔧 車検カルテ｜フロント確認')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // お客さま入力画面（デフォルト）
  const t = HtmlService.createTemplateFromFile('form');
  t.shop = shop;
  t.shopName = getShopName(shop);
  return t.evaluate()
    .setTitle('車検 事前カルテ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}


// 📖 工場ID → 工場名 を「工場マスタ」から引く
function getShopName(shopId) {
  const id = String(shopId || '').trim();
  if (!id) return '';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SHOP);
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === id) {
      return String(data[i][1] || '').trim();
    }
  }
  return '';
}


// 🚀 2. お客さま入力画面から送られてきたデータを「回答」シートに追記
function saveKarte(data) {
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(10000); // 10秒待って取れなければ諦める
  if (!hasLock) {
    return { success: false, message: '少し混み合っています。もう一度お試しください。' };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ensureAnswerSheet(ss);

    // 困りごとは項目IDの配列で受け取り、カンマ区切りで保存（例：ac,power）
    const troubles = Array.isArray(data.troubles) ? data.troubles.filter(Boolean) : [];

    sheet.appendRow([
      new Date(),                       // タイムスタンプ
      String(data.shop || '').trim(),   // 工場ID
      String(data.name || '').trim(),   // 氏名（任意）
      String(data.carModel || '').trim(),// 車種（任意）
      String(data.plate || '').trim(),  // ナンバー下4桁（任意）
      String(data.mileage || '').trim(),// 走行距離（任意）
      troubles.join(','),               // 困りごと（IDカンマ区切り）
      String(data.freeText || '').trim()// 自由記入（任意）
    ]);

    return { success: true, message: 'ありがとうございます' };

  } catch (error) {
    return { success: false, message: 'エラーが発生しました：' + error.message };
  } finally {
    lock.releaseLock(); // 必ず最後にロックを解除
  }
}


// 📊 3. フロント確認画面用：その工場の「当日ぶん」を新しい順に返す
function getKarteList(shop) {
  const id = String(shop || '').trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_ANSWER);
  if (!sheet) return { shopName: getShopName(id), items: [] };

  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1); // ヘッダーを飛ばす

  // 「当日」の判定（サーバー時刻の年月日）
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();

  const items = [];
  rows.forEach(function(r) {
    // 工場IDが一致しないものは除外（各工場は自分のぶんしか見えない）
    if (String(r[1]).trim() !== id) return;

    const ts = r[0];
    const dt = (ts instanceof Date) ? ts : new Date(ts);
    if (isNaN(dt.getTime())) return;
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return; // 当日のみ

    items.push({
      ts: dt.getTime(),
      time: Utilities.formatDate(dt, TZ, 'HH:mm'),
      name: String(r[2] || '').trim(),
      carModel: String(r[3] || '').trim(),
      plate: String(r[4] || '').trim(),
      mileage: String(r[5] || '').trim(),
      troubles: String(r[6] || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean),
      freeText: String(r[7] || '').trim()
    });
  });

  items.sort(function(a, b){ return b.ts - a.ts; }); // 新しい順
  return { shopName: getShopName(id), items: items };
}


// 「回答」シートが無ければヘッダー付きで作る
function ensureAnswerSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_ANSWER);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ANSWER);
    sheet.appendRow(ANSWER_HEADERS);
    sheet.getRange(1, 1, 1, ANSWER_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}


/**
 * 🛠 初回セットアップ用（GASエディタから1回だけ手動実行）
 *  ・「回答」シートをヘッダー付きで用意
 *  ・「工場マスタ」シートをサンプル1行付きで用意
 * 実行後、スプレッドシートに2つのシートができていればOK。
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureAnswerSheet(ss);

  let shopSheet = ss.getSheetByName(SHEET_SHOP);
  if (!shopSheet) {
    shopSheet = ss.insertSheet(SHEET_SHOP);
    shopSheet.appendRow(['工場ID', '工場名']);
    shopSheet.appendRow(['tanaka', '田中モータース']); // サンプル
    shopSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
    shopSheet.setFrozenRows(1);
  }
  SpreadsheetApp.getUi && Logger.log('セットアップ完了：「回答」「工場マスタ」シートを確認してください。');
}
