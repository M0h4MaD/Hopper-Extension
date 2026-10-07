// Tests for content/page-hook.js and content/relay.js with minimal browser stand-ins.
// Run from the repo root:  node tests/content-scripts.test.mjs
import assert from 'node:assert/strict';

const posted = [], listeners = [], sent = [];
const win = { postMessage: (m, o) => posted.push({ m, o }), addEventListener: (t, f) => listeners.push(f) };
let nextResponse;
win.fetch = async () => nextResponse;
globalThis.window = win;
globalThis.location = { origin: 'https://claude.ai', href: 'https://claude.ai/new' };
globalThis.chrome = { runtime: { sendMessage: async (m) => { sent.push(m); } } };

await import('../content/page-hook.js');
await import('../content/relay.js');
const tick = () => new Promise((r) => setTimeout(r, 20));

// 429 on a same-origin /api/ call: page still gets an intact, readable response; a copy is reported
nextResponse = new Response('{"error":{"resetsAt":1700000000}}', { status: 429, headers: { 'retry-after': '3600' } });
const res = await win.fetch('/api/organizations/x/completion');
assert.equal(res.status, 429);
assert.equal(await res.text(), '{"error":{"resetsAt":1700000000}}');   // body not consumed by the hook
await tick();
assert.equal(posted.length, 1);
assert.equal(posted[0].m.payload.retryAfter, '3600');
assert.equal(posted[0].o, 'https://claude.ai');

// everything else is ignored
for (const [status, url] of [[200, '/api/a'], [500, '/api/a'], [429, '/static/app.js'], [429, 'https://example.com/api/a']]) {
  nextResponse = new Response('x', { status });
  await win.fetch(url); await tick();
}
assert.equal(posted.length, 1);
console.log('ok - page hook: passes responses through untouched, reports only same-origin /api/ 429s');

// relay: forwards valid messages, drops forged/invalid ones
const [onMessage] = listeners;
const good = { source: 'hopper-hook', v: 1, payload: { status: 429, path: '/api/x', retryAfter: '60', body: 'b'.repeat(9000) } };
onMessage({ source: win, origin: 'https://claude.ai', data: good });
onMessage({ source: {}, origin: 'https://claude.ai', data: good });                       // wrong window
onMessage({ source: win, origin: 'https://evil.example', data: good });                   // wrong origin
onMessage({ source: win, origin: 'https://claude.ai', data: { ...good, v: 2 } });         // wrong version
onMessage({ source: win, origin: 'https://claude.ai', data: { ...good, payload: { status: 200 } } });
assert.equal(sent.length, 1);
assert.equal(sent[0].type, 'limitHit');
assert.equal(sent[0].body.length, 4000);                                                  // size-capped
console.log('ok - relay: validates origin/source/shape and caps sizes');
