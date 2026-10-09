// Buddy on iPhone: starts everything. So far, the service worker, which keeps the app's files for opening it without
// the network.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app' }).catch((err) => console.warn('[buddy] no offline copy', err));
}
