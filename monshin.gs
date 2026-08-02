/* ============================================================
   まえば小児科 WEB問診システム — サーバー側（Google Apps Script）

   使い方
     1. スプレッドシートを1つ用意する
     2. 拡張機能 → Apps Script でこのファイルを貼り付ける
     3. HTMLファイル（monshin / monshin-admin / monshin-schema）を追加する
        ※ GASでは .js を扱えないため、monshin-schema.js の中身は
          monshin-schema.html に <script> で囲んで貼り付ける
     4. setupMonshinSheets() を1度実行してシートを作る
     5. デプロイ → ウェブアプリ として公開する

   URL
     患者用   : https://.../exec
     医院用   : https://.../exec?page=admin
   ============================================================ */

const MONSHIN_SHEET = '問診データ';
const MONSHIN_LOG_SHEET = '操作履歴';

/* 保存期間（要件11-2）。この日数を過ぎた問診は purgeOldMonshin() で削除する。
   実際の日数は院内の個人情報保護方針に合わせて決める。 */
const RETENTION_DAYS = 180;

const MONSHIN_HEADERS = [
  'ID', '送信日時', '受診区分', '受診区分名',
  '氏名', 'ふりがな', '生年月日', '年齢', '性別',
  '保護者氏名', '続柄', '電話番号', '診察券番号', '住所',
  '主な症状', '要確認', '状態', '回答JSON',
];

/* ---------- 画面の表示 ---------- */
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || 'monshin';

  if (page === 'admin') {
    return HtmlService.createTemplateFromFile('monshin-admin').evaluate()
      .setTitle('まえば小児科 問診管理')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  return HtmlService.createTemplateFromFile('monshin').evaluate()
    .setTitle('まえば小児科 WEB問診')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* HTML側から <?!= include('monshin-schema') ?> で読み込むための関数 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ---------- 初期セットアップ ---------- */
function setupMonshinSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName(MONSHIN_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(MONSHIN_SHEET);
    sheet.appendRow(MONSHIN_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, MONSHIN_HEADERS.length)
         .setFontWeight('bold').setBackground('#e2e8f0');
  }

  let log = ss.getSheetByName(MONSHIN_LOG_SHEET);
  if (!log) {
    log = ss.insertSheet(MONSHIN_LOG_SHEET);
    log.appendRow(['日時', '操作', '対象ID', '職種', '利用者']);
    log.setFrozenRows(1);
    log.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#e2e8f0');
  }

  return 'セットアップが完了しました';
}

/* ---------- 問診の保存（患者側から呼ばれる） ---------- */
function saveMonshin(data) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: '混み合っています。少し待ってからお試しください。' };
  }

  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MONSHIN_SHEET);
    if (!sheet) {
      return { success: false, message: '「' + MONSHIN_SHEET + '」シートがありません。setupMonshinSheets を実行してください。' };
    }

    const err = validateMonshin(data);
    if (err) return { success: false, message: err };

    const p = data.patient || {};
    const flags = data.urgentFlags || [];
    const id = 'M' + Utilities.formatDate(new Date(), 'JST', 'yyyyMMddHHmmss')
             + '-' + Math.floor(Math.random() * 1000);

    sheet.appendRow([
      id, new Date(), data.visitType, data.visitTypeLabel,
      p.name, p.nameKana, p.birthDate, p.age, p.gender,
      p.guardianName, p.relationship, p.phone, p.cardNo, p.address,
      data.summary, flags.map(function (f) { return f.msg; }).join(' / '), '未確認',
      JSON.stringify(data.answers || {}),
    ]);

    writeLog('送信', id, '患者', '');
    return { success: true, id: id };

  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    lock.releaseLock();
  }
}

/* 送信された内容が最低限そろっているかを確認する（要件6-1-4のサーバー側チェック） */
function validateMonshin(data) {
  if (!data || !data.visitType) return '受診区分が選ばれていません。';
  const p = data.patient || {};
  const need = [['name', 'お名前'], ['nameKana', 'ふりがな'], ['birthDate', '生年月日'],
                ['guardianName', '保護者のお名前'], ['phone', '電話番号']];
  for (var i = 0; i < need.length; i++) {
    if (!p[need[i][0]]) return need[i][1] + 'が入力されていません。';
  }
  if (!/^[0-9\-]{10,14}$/.test(String(p.phone))) return '電話番号の形式が正しくありません。';
  return null;
}

/* ---------- 問診の一覧（管理画面から呼ばれる） ---------- */
function listMonshin() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MONSHIN_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getDataRange().getValues().slice(1);

  return values.map(function (r) {
    var answers = {};
    try { answers = JSON.parse(r[17] || '{}'); } catch (e) { answers = {}; }

    return {
      id: r[0],
      submittedAt: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      visitType: r[2],
      visitTypeLabel: r[3],
      patient: {
        name: r[4], nameKana: r[5],
        birthDate: r[6] instanceof Date ? Utilities.formatDate(r[6], 'JST', 'yyyy-MM-dd') : String(r[6]),
        age: r[7], gender: r[8], guardianName: r[9], relationship: r[10],
        phone: String(r[11]), cardNo: String(r[12]), address: r[13],
      },
      summary: r[14],
      // 一覧の表示に必要なのは文言と重症度なので、そこだけ復元する
      urgentFlags: String(r[15] || '').split(' / ').filter(String).map(function (m) {
        return { msg: m, level: isCritical(m) ? 'critical' : 'high' };
      }),
      status: r[16] || '未確認',
      answers: answers,
    };
  }).reverse();
}

/* 至急の対応が必要な文言かどうかを判定する。
   文言は monshin-schema.js 側で定義しているため、キーワードで拾う。 */
function isCritical(msg) {
  const words = ['すぐに', '至急', '脱水', 'けいれんが継続', 'ぐったり', '意識', 'チアノーゼ', '呼吸'];
  for (var i = 0; i < words.length; i++) {
    if (msg.indexOf(words[i]) !== -1) return true;
  }
  return false;
}

/* ---------- 状態の更新（要件7-4） ---------- */
function updateMonshinStatus(id, status, role) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('混み合っています。少し待ってからお試しください。');

  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MONSHIN_SHEET);
    const ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();

    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        sheet.getRange(i + 2, 17).setValue(status);
        writeLog('状態変更→' + status, id, role, Session.getActiveUser().getEmail());
        return { success: true };
      }
    }
    throw new Error('対象の問診が見つかりません。');

  } finally {
    lock.releaseLock();
  }
}

/* ---------- 操作履歴（要件11-1） ---------- */
function writeLog(action, id, role, user) {
  try {
    const log = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MONSHIN_LOG_SHEET);
    if (log) log.appendRow([new Date(), action, id, role, user]);
  } catch (e) {
    // 履歴が残せなくても、問診の保存自体は止めない
  }
}

/* ---------- 保存期間を過ぎた問診の削除（要件11-2）
   トリガーで月1回程度の実行を想定する ---------- */
function purgeOldMonshin() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MONSHIN_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return '対象なし';

  const limit = new Date();
  limit.setDate(limit.getDate() - RETENTION_DAYS);

  const values = sheet.getDataRange().getValues();
  var removed = 0;

  // 行を削除すると添字がずれるため、下から見ていく
  for (var i = values.length - 1; i >= 1; i--) {
    const d = values[i][1];
    const dt = (d instanceof Date) ? d : new Date(d);
    if (!isNaN(dt.getTime()) && dt < limit) {
      sheet.deleteRow(i + 1);
      removed++;
    }
  }

  writeLog('保存期間超過データ削除 ' + removed + '件', '', 'システム', '');
  return removed + '件を削除しました';
}
