/**
 * Isolated-world relay: validates messages coming from page-hook.js and forwards them to the
 * extension. The page (or anything running in it) could post such a message, so everything is
 * re-validated and size-capped here and again in the background, which only ever treats it as a hint.
 */
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const d = event.data;
  if (!d || d.source !== 'hopper-hook' || d.v !== 1 || !d.payload || d.payload.status !== 429) return;
  const p = d.payload;
  chrome.runtime.sendMessage({
    type: 'limitHit',
    status: 429,
    path: typeof p.path === 'string' ? p.path.slice(0, 200) : '',
    retryAfter: typeof p.retryAfter === 'string' ? p.retryAfter.slice(0, 64) : null,
    body: typeof p.body === 'string' ? p.body.slice(0, 4000) : '',
  }).catch(() => {});
});
