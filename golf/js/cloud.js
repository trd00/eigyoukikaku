// Googleログイン＋クラウド保存（Firebase Authentication / Cloud Firestore）。
//
// 設計方針
// - 設定されていない場合でもアプリは今まで通り動く（端末内保存のみ）。
//   Firebaseの設定が無い／読み込めない／オフラインでも、既存機能を壊さない。
// - SDKはCDNから動的importする。失敗しても例外を外に出さず、ローカル運用へ戻す。
// - 保存単位はユーザーごとの1ドキュメント（users/{uid}）。データ量が小さく、
//   読み書き回数を抑えられるため無料枠に収まる。
// - 通信失敗時の再送はFirestoreのオフライン永続化に任せる（要件14）。
//
// firebaseConfig は秘密情報ではない（公開前提の識別子）。
// 実際の保護はFirestoreのセキュリティルールで行う。firestore.rules を参照。

const SDK_VERSION = '10.14.1';
const CONFIG_KEY = 'trdgolf.firebase.config';

let app = null;
let auth = null;
let db = null;
let modules = null;
let currentUser = null;
const listeners = new Set();

/** 保存済みのFirebase設定を読む。コードに埋め込まれた設定があればそちらを優先。 */
export function loadConfig() {
  try {
    if (typeof window !== 'undefined' && window.TRD_FIREBASE_CONFIG) return window.TRD_FIREBASE_CONFIG;
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CONFIG_KEY) : null;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

export function isConfigured() {
  const c = loadConfig();
  return !!(c && c.apiKey && c.projectId);
}

/**
 * 貼り付けられた設定を検証する。
 * Firebaseコンソールの「構成」をそのまま貼れるよう、JSON以外の形式も受け付ける。
 */
export function parseConfig(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('設定が空です');

  let obj = null;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    // const firebaseConfig = { apiKey: "...", ... }; の形をそのまま受け取る
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('設定の形式が読み取れません');
    const body = match[0]
      .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":') // キーを引用符で囲む
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, '$1'); // 末尾のカンマを削除
    obj = JSON.parse(body);
  }

  if (!obj || !obj.apiKey || !obj.projectId || !obj.appId) {
    throw new Error('apiKey / projectId / appId が見つかりません');
  }
  return obj;
}

/** SDKを読み込んで初期化する。失敗しても例外は投げず false を返す。 */
export async function init() {
  if (app) return true;
  const config = loadConfig();
  if (!config) return false;

  try {
    const base = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
    const [appMod, authMod, storeMod] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`),
    ]);
    modules = { appMod, authMod, storeMod };

    app = appMod.initializeApp(config);
    auth = authMod.getAuth(app);
    // オフラインでも読み書きできるようにする（通信復帰時に自動で再送される）
    try {
      db = storeMod.initializeFirestore(app, { localCache: storeMod.persistentLocalCache({}) });
    } catch {
      db = storeMod.getFirestore(app);
    }

    authMod.onAuthStateChanged(auth, (user) => {
      currentUser = user
        ? { uid: user.uid, name: user.displayName || '', email: user.email || '', photo: user.photoURL || '' }
        : null;
      for (const cb of listeners) cb(currentUser);
    });
    return true;
  } catch (e) {
    console.warn('クラウド機能を読み込めませんでした（端末内保存で動作します）', e);
    app = null;
    return false;
  }
}

export function onUserChange(callback) {
  listeners.add(callback);
  callback(currentUser);
  return () => listeners.delete(callback);
}

export function getUser() {
  return currentUser;
}

export async function signIn() {
  if (!(await init())) throw new Error('クラウド設定が未完了です');
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = modules.authMod;
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // iOSのホーム画面起動ではポップアップが開けないことがあるため画面遷移方式に切り替える
    if (
      e &&
      (e.code === 'auth/popup-blocked' ||
        e.code === 'auth/operation-not-supported-in-this-environment' ||
        e.code === 'auth/cancelled-popup-request')
    ) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}

export async function signOutUser() {
  if (!auth) return;
  await modules.authMod.signOut(auth);
}

function docRef(uid) {
  return modules.storeMod.doc(db, 'users', uid);
}

/** クラウドから読む。未保存なら null */
export async function pull(uid) {
  if (!db) return null;
  const snap = await modules.storeMod.getDoc(docRef(uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return data && data.state ? JSON.parse(data.state) : null;
}

/** クラウドへ書く。オフライン時はSDKが保持し、復帰後に自動送信する。 */
export async function push(uid, state) {
  if (!db) return false;
  const payload = {
    state: JSON.stringify(state),
    updatedAt: new Date().toISOString(),
    profileName: state.profileName || '',
  };
  await modules.storeMod.setDoc(docRef(uid), payload, { merge: true });
  return true;
}

/** 他の端末での変更を受け取る */
export function subscribe(uid, callback) {
  if (!db) return () => {};
  return modules.storeMod.onSnapshot(
    docRef(uid),
    { includeMetadataChanges: false },
    (snap) => {
      if (!snap.exists()) return;
      // 自分が書いた直後の反映（未確定）は無視する
      if (snap.metadata.hasPendingWrites) return;
      const data = snap.data();
      if (data && data.state) callback(JSON.parse(data.state));
    },
    (e) => console.warn('クラウドの購読に失敗しました', e)
  );
}

/** アカウントのクラウドデータを削除する（要件14：データ削除） */
export async function remove(uid) {
  if (!db) return false;
  await modules.storeMod.deleteDoc(docRef(uid));
  return true;
}
