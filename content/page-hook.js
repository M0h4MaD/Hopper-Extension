/**
 * Runs in the PAGE world on claude.ai (document_start). It does one thing: when one of claude.ai's
 * own same-origin /api/ requests comes back with HTTP 429, it copies the status, the Retry-After
 * header and the (size-capped) error body and hands them to relay.js via window.postMessage.
 * It never changes the request or the response the page receives, and ignores every other status.
 */
(() => {
  const FLAG = Symbol.for('hopper.hook');
  if (window[FLAG]) return;
  window[FLAG] = true;

  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;

  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    promise.then((res) => {
      try {
        if (res.status !== 429) return;
        const input = args[0];
        const url = new URL(typeof input === 'string' ? input : (input && input.url) || String(input), location.href);
        if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return;
        const retryAfter = res.headers.get('retry-after');
        res.clone().text().then((text) => {
          window.postMessage({ source: 'hopper-hook', v: 1, payload: { status: 429, path: url.pathname, retryAfter, body: text.slice(0, 4000) } }, location.origin);
        }).catch(() => {});
      } catch { /* never interfere with the page */ }
    }, () => {});
    return promise;   // the page gets the untouched original promise
  };
})();
