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
const PATIENT_SHEET = '患者マスタ';

/* 保存期間（要件11-2）。この日数を過ぎた問診は purgeOldMonshin() で削除する。
   実際の日数は院内の個人情報保護方針に合わせて決める。 */
const RETENTION_DAYS = 180;

const MONSHIN_HEADERS = [
  'ID', '送信日時', '受診区分', '受診区分名',
  '氏名', 'ふりがな', '生年月日', '年齢', '性別',
  '保護者氏名', '続柄', '電話番号', '診察券番号', '住所',
  '主な症状', '要確認', '状態', '回答JSON',
];

/* 受付で登録済みの患者情報（要件6-1-2）。
   電子カルテからCSVで書き出したものを貼り付けて使う。
   ※「生年月日」「電話番号」の列は、書式を「書式なしテキスト」にしておく。
     数値として扱われると、電話番号の先頭の0が消える。 */
const PATIENT_HEADERS = [
  '診察券番号', '氏名', 'ふりがな', '生年月日', '性別',
  '保護者氏名', '続柄', '電話番号', '郵便番号', '住所',
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

  let master = ss.getSheetByName(PATIENT_SHEET);
  if (!master) {
    master = ss.insertSheet(PATIENT_SHEET);
    master.appendRow(PATIENT_HEADERS);
    master.setFrozenRows(1);
    master.getRange(1, 1, 1, PATIENT_HEADERS.length)
          .setFontWeight('bold').setBackground('#e2e8f0');
    // 先頭の0が消えないよう、番号と日付の列は文字列として扱う
    master.getRange(2, 1, master.getMaxRows() - 1, 1).setNumberFormat('@');   // 診察券番号
    master.getRange(2, 4, master.getMaxRows() - 1, 1).setNumberFormat('@');   // 生年月日
    master.getRange(2, 8, master.getMaxRows() - 1, 2).setNumberFormat('@');   // 電話番号・郵便番号
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

/* ============================================================
   登録情報の呼び出し（要件6-1-2）

   患者マスタから、受付で登録済みの氏名などを引き当てて返す。

   診察券番号「だけ」で名前が返る作りにはしない。
   問診のURLは誰でも開けるため、番号を1つずつ試すだけで
   患者名と住所を集められてしまう。
   診察券番号と生年月日の2つが一致した場合だけ返す。

   マイナンバー（個人番号）は扱わない。番号法が定める利用範囲は
   社会保障・税・災害対策の事務に限られており、問診での本人確認は
   そこに含まれない。12桁の数字が入力された場合は照会せずに止める。
   ============================================================ */

/* 番号を順に試されるのを防ぐ。同じ診察券番号への照会は10分に5回まで。 */
const LOOKUP_MAX_PER_CARD = 5;
/* 医院全体でも上限を設ける。通常の来院数では届かない値にしておく。 */
const LOOKUP_MAX_TOTAL = 200;
const LOOKUP_WINDOW_SEC = 600;

function lookupPatient(cardNo, birthDate) {
  const no = normCardNo(cardNo);
  const bd = normDate(birthDate);

  if (/^[0-9]{12}$/.test(no)) {
    return { success: false, message: 'マイナンバー（12桁の番号）は問診では使用しません。診察券番号をご入力ください。' };
  }
  if (!no || !bd) {
    return { success: false, message: '診察券番号と生年月日の両方をご入力ください。' };
  }
  if (!lookupAllowed(no)) {
    return { success: false, message: '照会の回数が上限に達しました。お手数ですが、そのまま下の欄へご入力ください。' };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PATIENT_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return { success: false, message: '登録情報を呼び出せませんでした。そのまま下の欄へご入力ください。' };
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, PATIENT_HEADERS.length).getValues();

  for (var i = 0; i < values.length; i++) {
    const r = values[i];
    if (normCardNo(r[0]) === no && normDate(r[3]) === bd) {
      writeLog('登録情報の照会（一致）', no, '患者', '');
      return {
        success: true,
        patient: {
          cardNo: String(r[0]).trim(),
          name: String(r[1]).trim(),
          nameKana: String(r[2]).trim(),
          birthDate: bd,
          gender: String(r[4]).trim(),
          guardianName: String(r[5]).trim(),
          relationship: String(r[6]).trim(),
          phone: String(r[7] == null ? '' : r[7]).replace(/[^0-9\-]/g, ''),
          address: String(r[9]).trim(),
        },
      };
    }
  }

  // 番号が存在するかどうかを悟られないよう、不一致の理由は分けない
  writeLog('登録情報の照会（不一致）', no, '患者', '');
  return { success: false, message: '登録が見つかりませんでした。番号と生年月日をご確認ください。' };
}

function lookupAllowed(no) {
  try {
    const cache = CacheService.getScriptCache();

    const perCard = Number(cache.get('lk_' + no) || 0) + 1;
    cache.put('lk_' + no, String(perCard), LOOKUP_WINDOW_SEC);
    if (perCard > LOOKUP_MAX_PER_CARD) return false;

    const total = Number(cache.get('lk_total') || 0) + 1;
    cache.put('lk_total', String(total), LOOKUP_WINDOW_SEC);
    if (total > LOOKUP_MAX_TOTAL) {
      writeLog('照会が医院全体の上限に達しました', '', 'システム', '');
      return false;
    }
    return true;

  } catch (e) {
    return true;   // キャッシュが使えない環境では照会自体は通す
  }
}

/* 全角の英数字を半角にし、空白とハイフンを取り除く。
   「０１２３４」「01234」「0-1234」を同じものとして扱うため。 */
function normCardNo(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    })
    .replace(/[\s\-ー－]/g, '')
    .toUpperCase();
}

/* 日付を yyyy-MM-dd にそろえる。
   シートの値が日付型でも「2020/4/1」のような文字列でも同じ結果にする。 */
function normDate(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'JST', 'yyyy-MM-dd');
  const m = String(v).trim().replace(/[\/\.]/g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
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
