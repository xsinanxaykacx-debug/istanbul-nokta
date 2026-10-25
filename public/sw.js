self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  // Sadece PWA kurulabilsin diye basit bir fetch dinleyici
});