// 🌟 1. Webアプリの画面を表示する処理
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'index';

  if (page === 'dashboard') {
    return HtmlService.createTemplateFromFile('dashboard').evaluate()
      .setTitle('📊 営業実績ボード')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('✨ 営業報告システム ✨')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 🚀 2. 画面から送られてきたデータを受け取り、シートに書き込む処理
function saveReport(data) {
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(10000); // 10秒待って取れなければ諦める

  if (!hasLock) {
    return { success: false, message: '処理が混み合っています。少し待ってから再度お試しください。' };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('報告データ');

    if (!sheet) {
      return { success: false, message: '「報告データ」シートが見つかりません。シート名を確認してください。' };
    }

    const timestamp = new Date();

    if (data.isNoOrder) {
      // 受注なし：商品情報は空欄、不成約理由の次にキャンペーン名を記録
      const noOrderSheet = ss.getSheetByName('受注なし');
      if (!noOrderSheet) {
        return { success: false, message: '「受注なし」シートが見つかりません。シート名を確認してください。' };
      }

      const row = [
        timestamp, data.reportType, data.occasionType, data.date, data.maker, data.branch, data.staff,
        data.customer, '', '', '', '', '', data.noOrderReason, data.campaignName
      ];

      // ① 報告データシートに記録（履歴・バックアップ用）
      sheet.appendRow(row);
      // ② 受注なし専用シートにも記録
      noOrderSheet.appendRow(row);

    } else {
      // 受注あり：報告種類に応じて転記先シートを切り替える
      const targetSheet = ss.getSheetByName(data.reportType);
      if (!targetSheet) {
        return { success: false, message: `「${data.reportType}」シートが見つかりません。シート名を確認してください。` };
      }

      data.items.forEach(item => {
        // 各アイテム行の末尾にキャンペーン名を追加
        const row = [
          timestamp, data.reportType, data.occasionType, data.date, data.maker, data.branch, data.staff,
          item.customer, item.product, item.productNo, item.quantity, item.price, item.amount, '', data.campaignName
        ];

        // ① 報告データシートに記録（履歴・バックアップ用）
        sheet.appendRow(row);
        // ② 見た目用のフォーマットシートにも、同じ並びで記録
        targetSheet.appendRow(row);
      });
    }

    return { success: true, message: '報告データの登録が完了しました！' };

  } catch (error) {
    return { success: false, message: 'エラーが発生しました：' + error.message };
  } finally {
    lock.releaseLock(); // 必ず最後にロックを解除
  }
}

// 📖 3. 前作と同じく、名簿データを読み込む処理
function getSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('名簿');
  if (!sheet) return {};

  const data = sheet.getDataRange().getValues();
  const settings = {};

  for (let i = 1; i < data.length; i++) {
    const branchName = String(data[i][0] || '').trim();
    const staffName = String(data[i][1] || '').trim();

    if (!branchName || !staffName) continue;

    if (!settings[branchName]) {
      settings[branchName] = [];
    }

    if (!settings[branchName].includes(staffName)) {
      settings[branchName].push(staffName);
    }
  }

  // ★キャンペーン一覧シートからキャンペーン名を取得
  const campaignSheet = ss.getSheetByName('キャンペーン一覧');
  let campaigns = [];
  if (campaignSheet) {
    const campaignData = campaignSheet.getDataRange().getValues();
    campaigns = campaignData
      .map(row => String(row[0] || '').trim())
      .filter(name => name !== '' && name !== 'キャンペーン名' && name !== 'キャンペーン');
  }

  return { branches: settings, campaigns: campaigns };
}
// 📊 3. ダッシュボード用：報告データを集計して返す処理
function getDashboardData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('報告データ');
  if (!sheet) {
    return { error: '「報告データ」シートが見つかりません' };
  }

  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1); // 1行目ヘッダーを飛ばす

  // 今月の範囲（D列=実活動日で判定）
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  const monthRows = rows.filter(function(r) {
    const d = r[3];
    if (!d) return false;
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return false;
    return dt.getFullYear() === y && dt.getMonth() === m;
  });

  const orderRows = monthRows.filter(function(r) {
    return String(r[1]).trim() === '受注';
  });

  // --- KPI ---
  let totalQty = 0;
  orderRows.forEach(function(r) {
    const q = Number(r[10]);
    if (!isNaN(q)) totalQty += q;
  });
  // 訪問キー生成（日付＋客先＋担当者でユニーク化）
  function visitKey(r) {
    const d = r[3];
    const dt = (d instanceof Date) ? d : new Date(d);
    const ymd = dt.getFullYear() + '-' + (dt.getMonth() + 1) + '-' + dt.getDate();
    const cust = String(r[7] || '不明').trim();
    const staff = String(r[6] || '不明').trim();
    return ymd + '|' + cust + '|' + staff;
  }
  // アプローチ件数＝訪問ユニーク数、受注件数＝受注訪問のユニーク数
  const approachSet = {};
  monthRows.forEach(function(r) { approachSet[visitKey(r)] = true; });
  const approach = Object.keys(approachSet).length;

  const orderVisitSet = {};
  orderRows.forEach(function(r) { orderVisitSet[visitKey(r)] = true; });
  const orderCount = Object.keys(orderVisitSet).length;

  const rate = approach > 0 ? Math.round((orderCount / approach) * 100) : 0;

// --- 営業所別：受注件数＋アプローチ件数＋販売個数＋担当者内訳 ---
  const branchMap = {};
  function ensureBranch(name) {
    if (!branchMap[name]) branchMap[name] = { count: 0, approach: 0, qty: 0, staff: {} };
    return branchMap[name];
  }
  function ensureStaff(b, staff) {
    if (!b.staff[staff]) b.staff[staff] = { v: 0, a: 0, q: 0 };
    return b.staff[staff];
  }

  // アプローチ件数：訪問ユニークで営業所別・担当者別にカウント
  const seenApproach = {};
  const seenApproachStaff = {};
  monthRows.forEach(function(r) {
    const branch = String(r[5] || '不明').trim();
    const staff = String(r[6] || '不明').trim();
    const key = visitKey(r);
    const b = ensureBranch(branch);
    const s = ensureStaff(b, staff);
    if (!seenApproach[branch + '#' + key]) {
      seenApproach[branch + '#' + key] = true;
      b.approach += 1;
    }
    if (!seenApproachStaff[branch + '#' + staff + '#' + key]) {
      seenApproachStaff[branch + '#' + staff + '#' + key] = true;
      s.a += 1;
    }
  });

  // 受注件数：訪問ユニーク／販売個数：数量合計
  const seenOrder = {};
  const seenOrderStaff = {};
  orderRows.forEach(function(r) {
    const branch = String(r[5] || '不明').trim();
    const staff = String(r[6] || '不明').trim();
    const key = visitKey(r);
    const b = ensureBranch(branch);
    const s = ensureStaff(b, staff);
    if (!seenOrder[branch + '#' + key]) {
      seenOrder[branch + '#' + key] = true;
      b.count += 1;
    }
    if (!seenOrderStaff[branch + '#' + staff + '#' + key]) {
      seenOrderStaff[branch + '#' + staff + '#' + key] = true;
      s.v += 1;
    }
    const q = Number(r[10]);
    if (!isNaN(q)) { b.qty += q; s.q += q; }
  });

  const branches = Object.keys(branchMap).map(function(name) {
    const staffArr = Object.keys(branchMap[name].staff).map(function(sn) {
      return { n: sn, v: branchMap[name].staff[sn].v, a: branchMap[name].staff[sn].a, q: branchMap[name].staff[sn].q };
    }).sort(function(a, b) { return b.v - a.v; });
    return {
      name: name,
      value: branchMap[name].count,
      approach: branchMap[name].approach,
      qty: branchMap[name].qty,
      staff: staffArr
    };
  }).sort(function(a, b) { return b.value - a.value; });

  // --- 売れ筋商品TOP3（登場回数）---
  const prodMap = {};
  orderRows.forEach(function(r) {
    const p = String(r[8] || '').trim();
    if (!p) return;
    prodMap[p] = (prodMap[p] || 0) + 1;
  });
  const products = Object.keys(prodMap).map(function(name) {
    return { name: name, count: prodMap[name] };
  }).sort(function(a, b) { return b.count - a.count; }).slice(0, 3);

  // --- イベント種別（受注件数）---
  const evOrder = ['キャンペーン', '同行販売', '展示会'];
  const evIcon = { 'キャンペーン': '🎯', '同行販売': '🤝', '展示会': '🏢' };
  const evMap = {};
  orderRows.forEach(function(r) {
    const ev = String(r[2] || '').trim();
    if (!ev) return;
    evMap[ev] = (evMap[ev] || 0) + 1;
  });
  const events = evOrder.map(function(name) {
    return { icon: evIcon[name] || '📌', name: name, value: evMap[name] || 0 };
  });
// --- 目標管理シートから今月の目標を読む ---
    let goalSales = 0, goalApproach = 0;
    const goalSheet = ss.getSheetByName('目標管理');
    if (goalSheet) {
      const goalRows = goalSheet.getDataRange().getValues().slice(1);
      goalRows.forEach(function(g) {
        let gy = -1, gm = -1;
        if (g[0] instanceof Date) {
          gy = g[0].getFullYear(); gm = g[0].getMonth() + 1;
        } else {
          const mt = String(g[0]).replace(/^'/, '').trim().match(/(\d{4})\D+(\d{1,2})/);
          if (mt) { gy = Number(mt[1]); gm = Number(mt[2]); }
        }
        if (gy === y && gm === m + 1) {
          goalSales = Number(g[1]) || 0;
          goalApproach = Number(g[2]) || 0;
        }
      });
    }
    const goalSalesPct = goalSales > 0 ? Math.round((totalQty / goalSales) * 100) : 0;
    const goalApproachPct = goalApproach > 0 ? Math.round((approach / goalApproach) * 100) : 0;
  return {
    yearMonth: y + '年' + (m + 1) + '月',
    goal: { sales: goalSales, approach: goalApproach, salesPct: goalSalesPct, approachPct: goalApproachPct },
  kpi: { total: totalQty, approach: approach, orderCount: orderCount, rate: rate },
    branches: branches,
    products: products,
    events: events
  };
}
function testGoal2() {const now2 = new Date();
  const y2 = now2.getFullYear();
  const m2 = now2.getMonth();
  const ym2 = y2 + '-' + ('0' + (m2 + 1)).slice(-2);
  Logger.log('本番と同じ計算のym=[' + ym2 + '] m=' + m2);
  const d = getDashboardData();
  Logger.log('goal=' + JSON.stringify(d.goal));
  Logger.log('kpi=' + JSON.stringify(d.kpi));
}
