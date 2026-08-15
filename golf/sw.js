// 通信が不安定な場所（打ちっぱなし・ゴルフ場）でも起動できるようにする。
// 個人データはService Workerを経由せず、localStorageだけに保持する。

const CACHE = 'trd-golf-v5';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/chart.js',
  './js/cloud.js',
  './js/consult.js',
  './js/plan.js',
  './js/merge.js',
  './js/courses.js',
  './js/date.js',
  './js/diagnose.js',
  './js/menu.js',
  './js/seed.js',
  './js/stats.js',
  './js/store.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 更新を取り込みつつオフラインでも動くよう network-first + cache fallback
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
