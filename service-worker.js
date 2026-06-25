// Study Tracker PWA — Service Worker
const CACHE_NAME = 'study-tracker-v3';
const APP_FILES  = [
  './StudyTracker_v3.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];
const FONT_URL = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap';

// Instala e faz cache dos arquivos do app
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

// Remove caches antigos ao ativar
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Estratégia de cache
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Supabase — sempre network, nunca cache (dados em tempo real)
  if (url.includes('supabase.co')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('{}', {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Google Fonts — cache após primeiro download
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached ||
        fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
          return res;
        })
      )
    );
    return;
  }

  // App files — cache first, depois network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => {
        // Offline fallback — retorna o app principal
        if (e.request.mode === 'navigate') return caches.match('./StudyTracker_v3.html');
      });
    })
  );
});
