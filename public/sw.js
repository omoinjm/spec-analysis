// Service worker: precache the app shell; cache the OCR engine + language data on first use
// so scanning works offline afterwards.
const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'src/app.js',
  'src/decoder.js',
  'src/ocr.js',
  'src/quality.js',
  'src/scanner.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'tessdata.projectnaptha.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === location.origin) {
    // Network-first for our own files so updates show up; fall back to cache offline.
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(request, copy)); }
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
    );
    return;
  }

  if (RUNTIME_HOSTS.includes(url.hostname)) {
    // Versioned CDN assets never change: cache-first.
    e.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(request, copy)); }
        return res;
      })),
    );
  }
});
