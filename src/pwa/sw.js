// Service worker（建置時由 vite.config.ts 填入版本與檔案清單，輸出成 dist/sw.js）
// 安裝時快取整個程式（含 DWG／PDF 解析元件與 Excel 匯出），之後離線也能開。
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const PREFIX = 'steel-takeoff-';
const CACHE = PREFIX + VERSION;
// 伺服器可能回 Vary: Origin／Accept-Encoding，預先快取的請求沒有這些標頭，比對時要忽略
const MATCH = { ignoreVary: true, ignoreSearch: true };

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))),
  );
  // 不立即接手：舊版頁面還開著時，它延後載入的檔案仍在舊快取裡。
  // 所有舊版視窗關閉後新版才啟用；頁面本身每次開啟都先向網路拿最新版。
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

/** 網路優先（逾時改用快取），給頁面本身用 */
async function networkFirst(req) {
  try {
    return await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
  } catch {
    return (await caches.match('./', MATCH)) || (await caches.match('index.html', MATCH)) || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req));
    return;
  }
  // 其餘檔名都帶雜湊（不會變），快取優先；沒快取到的順手存起來
  e.respondWith(
    (async () => {
      const hit = await caches.match(req, MATCH);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const c = await caches.open(CACHE);
        void c.put(req, res.clone());
      }
      return res;
    })(),
  );
});
