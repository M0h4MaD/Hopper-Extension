import assert from 'node:assert/strict';
const realST = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => (ms === 2500 ? 0 : realST(fn, ms, ...a));   // skip delayed verify

/* ---------- fake IndexedDB (device key only) ---------- */
const idbMap = new Map();
globalThis.indexedDB = {
  open() { const req = {}; realST(() => { req.result = { createObjectStore() {}, close() {},
    transaction() { const tx = {}; tx.objectStore = () => ({
      get: (k) => { const r = {}; realST(() => { r.result = idbMap.get(k); realST(() => tx.oncomplete && tx.oncomplete()); }); return r; },
      put: (v, k) => { const r = {}; realST(() => { idbMap.set(k, v); realST(() => tx.oncomplete && tx.oncomplete()); }); return r; } }); return tx; } };
    req.onupgradeneeded && req.onupgradeneeded(); req.onsuccess && req.onsuccess(); }); return req; },
  deleteDatabase() { const r = {}; realST(() => { idbMap.clear(); r.onsuccess && r.onsuccess(); }); return r; },
};

/* ---------- fake chrome ---------- */
const mkArea = () => { const m = new Map(); return { m,
  async get(k) { if (k == null) return Object.fromEntries(m); const ks = Array.isArray(k) ? k : [k]; const o = {}; for (const x of ks) if (m.has(x)) o[x] = structuredClone(m.get(x)); return o; },
  async set(o) { for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v)); },
  async remove(k) { for (const x of [].concat(k)) m.delete(x); },
  async clear() { m.clear(); } }; };
const local = mkArea(), session = mkArea();
let jar = [];
const calls = { tabsCreate: [], tabsUpdate: [], reload: [], badge: [] };
let failSet = null;
let msgHandler, tabHandler;
const hostOf = (u) => new URL(u).hostname;
globalThis.chrome = {
  storage: { local, session, sync: { get() { throw new Error('sync used!'); }, set() { throw new Error('sync used!'); } } },
  cookies: {
    async getAll({ domain }) { return jar.filter((c) => c.domain.replace(/^\./, '') === domain || c.domain.endsWith('.' + domain)).map((c) => ({ ...c })); },
    async remove({ url, name }) { jar = jar.filter((c) => !(c.name === name && c.domain.replace(/^\./, '') === hostOf(url))); return {}; },
    async set(d) { if (failSet && failSet(d)) return null; jar = jar.filter((c) => !(c.name === d.name && c.domain.replace(/^\./, '') === (d.domain || hostOf(d.url)).replace(/^\./, '')));
      jar.push({ name: d.name, value: d.value, domain: d.domain || hostOf(d.url), hostOnly: !d.domain, path: d.path, secure: d.secure, httpOnly: d.httpOnly, sameSite: d.sameSite, session: !d.expirationDate, expirationDate: d.expirationDate }); return {}; },
  },
  tabs: { async query() { return []; }, async create(o) { calls.tabsCreate.push(o.url); return { id: 7 }; }, async update(id, o) { calls.tabsUpdate.push(o.url); return { id }; }, reload(id) { calls.reload.push(id); }, onUpdated: { addListener: (f) => { tabHandler = f; } } },
  action: { setBadgeText: (o) => calls.badge.push(o.text), setBadgeBackgroundColor() {}, setTitle() {} },
  i18n: { getMessage: (k, s) => k + (s ? ':' + s : '') },
  runtime: { id: 'test', getURL: (p) => 'chrome-extension://test/' + p, lastError: undefined, getManifest: () => ({ version: 't' }), onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener: (f) => { msgHandler = f; } } },
  commands: { onCommand: { addListener() {} } },
};
const accounts = { TOKA: { email_address: 'alice@example.com', full_name: 'Alice' }, TOKB: { email_address: 'bob@example.com', full_name: 'Bob' } };
globalThis.fetch = async () => { const sid = jar.find((c) => c.name === 'sid'); const body = sid && accounts[sid.value];
  return { status: body ? 200 : 401, ok: !!body, headers: { get: () => 'application/json' }, json: async () => body }; };

await import('./background.js');
const EXT = { id: 'test', url: 'chrome-extension://test/popup.html' };
const send = (type, p = {}, sender = EXT) => new Promise((res) => msgHandler({ type, ...p }, sender, res));
const ok = async (type, p) => { const r = await send(type, p); assert.ok(r.ok, `${type} failed: ${JSON.stringify(r)}`); return r.data; };
const err = async (type, p) => { const r = await send(type, p); assert.ok(!r.ok, `${type} should fail`); return r.error.code; };
const login = (tok) => { jar = [
  { name: 'sid', value: tok, domain: '.claude.ai', hostOnly: false, path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: false, expirationDate: Date.now() / 1000 + 86400 },
  { name: '__Host-x', value: 'hx-' + tok, domain: 'claude.ai', hostOnly: true, path: '/', secure: true, httpOnly: false, sameSite: 'strict', session: true } ]; };
const live = () => jar.find((c) => c.name === 'sid')?.value;
let n = 0; const sleep = (ms) => new Promise((r) => realST(r, ms));
const pass = (m) => console.log(`ok ${++n} - ${m}`);

/* 1. setup */
assert.equal((await ok('status')).setupDone, false);
assert.equal(await err('setup', { password: 'short' }), 'WEAK_PASSWORD');
assert.equal(await err('setup', { password: null }), 'WEAK_PASSWORD'); pass('password mandatory');
await ok('setup', { password: 'correct horse' });
assert.equal((await ok('status')).locked, false);

/* 2. save A */
login('TOKA');
let d = await ok('detect'); assert.equal(d.loggedIn, true); assert.equal(d.matchId, null);
const A = (await ok('saveCurrent')).id;
let st = await ok('status'); assert.equal(st.accounts[0].name, 'Alice'); assert.equal(st.activeId, A); pass('save account A');
const raw = JSON.stringify([...local.m]);
for (const s of ['Alice', 'alice@', 'TOKA', 'hx-TOKA']) assert.ok(!raw.includes(s), 'plaintext leak: ' + s);
pass('names, emails and cookies are encrypted at rest');

/* 3. add flow */
await ok('startAdd'); assert.equal(jar.length, 0); assert.ok(calls.tabsCreate.at(-1).endsWith('/login'));
st = await ok('status'); assert.equal(st.pending.phase, 'login'); assert.equal(st.activeId, null);
login('TOKB'); tabHandler(7, { status: 'complete' }, { url: 'https://claude.ai/new' });
await new Promise((r) => realST(r, 50));
st = await ok('status'); assert.equal(st.pending.phase, 'ready'); assert.equal(st.pending.identity.email, 'bob@example.com');
const B = (await ok('saveCurrent')).id; st = await ok('status'); assert.equal(st.accounts.length, 2); assert.equal(st.activeId, B); pass('add-account flow + banner state');

/* 4. switching + rollback + duplicate */
await ok('switch', { id: A }); assert.equal(live(), 'TOKA'); assert.ok(jar.find((c) => c.name === '__Host-x' && c.hostOnly)); pass('switch B->A restores cookies with flags');
failSet = (d) => d.name === 'sid' && d.value === 'TOKB';
assert.equal(await err('switch', { id: B }), 'SWITCH_FAILED'); failSet = null;
assert.equal(live(), 'TOKA'); assert.equal((await ok('status')).activeId, A); pass('failed switch rolls back');
await ok('switch', { id: B }); assert.equal(live(), 'TOKB');
login('TOKA'); const dup = await ok('saveCurrent'); assert.equal(dup.updated, true); assert.equal((await ok('status')).accounts.length, 2); pass('same account is not saved twice');

/* 5. rename persists encrypted */
await ok('rename', { id: A, name: 'Work' }); st = await ok('status'); assert.equal(st.accounts.find((a) => a.id === A).name, 'Work');
assert.ok(!JSON.stringify([...local.m]).includes('Work')); pass('rename works and stays encrypted');

/* 5b. one-click "Sign in again" for an existing account */
accounts.TOKA2 = { email_address: 'alice@example.com', full_name: 'Alice' };
await ok('startAdd', { reloginId: A });
let stp = await ok('status'); assert.equal(stp.pending.reloginId, A); assert.equal(stp.pending.phase, 'login');
login('TOKA2'); tabHandler(7, { status: 'complete' }, { url: 'https://claude.ai/new' }); await sleep(80);
stp = await ok('status'); assert.equal(stp.pending, null); assert.equal(stp.activeId, A); assert.equal(stp.accounts.length, 2);
await ok('switch', { id: B }); await ok('switch', { id: A }); assert.equal(live(), 'TOKA2'); pass('re-login updates the same account automatically (no extra prompt)');
assert.equal(await err('startAdd', { reloginId: 'nope' }), 'NOT_FOUND');
await ok('startAdd', { reloginId: A }); login('TOKB'); tabHandler(7, { status: 'complete' }, { url: 'https://claude.ai/new' }); await sleep(80);
stp = await ok('status'); assert.equal(stp.pending.phase, 'ready'); assert.equal(stp.pending.matchId, B);
await ok('cancelAdd'); assert.equal(live(), 'TOKA2'); pass('signing in as a different account during re-login is NOT auto-saved');

/* 6. auto-lock + throttle */
await ok('setAutoLock', { minutes: 15 });
session.m.set('vkAt', Date.now() - 16 * 60000);
assert.equal((await ok('status')).locked, true); assert.equal((await ok('status')).accounts.length, 0);
assert.equal(await err('switch', { id: B }), 'LOCKED'); pass('idle auto-lock engages');
for (let i = 0; i < 3; i++) assert.equal(await err('unlock', { password: 'wrong' }), 'BAD_PASSWORD');
assert.equal(await err('unlock', { password: 'correct horse' }), 'TOO_MANY'); pass('throttle after 3 failures');
await new Promise((r) => realST(r, 1100));
await ok('unlock', { password: 'correct horse' }); assert.equal((await ok('status')).locked, false); pass('unlock after wait');
session.m.set('vkAt', Date.now() - 10 * 60000); await ok('status'); assert.ok(Date.now() - session.m.get('vkAt') < 5000); pass('activity extends the timer (sliding)');
await ok('setAutoLock', { minutes: 0 }); session.m.set('vkAt', 1); assert.equal((await ok('status')).locked, false); pass('"until browser closes" never idle-locks');

/* 7. swapped records are rejected (AAD) */
const s0 = structuredClone(local.m.get('state')); const t = s0.accounts[0].blob; s0.accounts[0].blob = s0.accounts[1].blob; s0.accounts[1].blob = t;
const good = structuredClone(local.m.get('state')); local.m.set('state', s0);
assert.equal(await err('switch', { id: s0.accounts[0].id === B ? A : B }), 'CORRUPT'); local.m.set('state', good); pass('blobs swapped between accounts are detected');

/* 8. change password re-encrypts everything */
await ok('setPassword', { password: 'new password 1' }); await ok('lock');
assert.equal(await err('unlock', { password: 'correct horse' }), 'BAD_PASSWORD');
await new Promise((r) => realST(r, 1100)); await ok('unlock', { password: 'new password 1' });
login('TOKA'); await ok('switch', { id: B }); assert.equal(live(), 'TOKB'); pass('password change keeps all accounts usable');

/* 9. legacy v1.0 upgrade (device key, plaintext labels, no AAD) */
const cv = await import('./crypto-vault.js');
local.m.clear(); session.m.clear();
const dk = await cv.getDeviceKey(); const lid = 'legacy-1';
const legacyBlob = await cv.encryptJSON(dk, [{ name: 'sid', value: 'TOKA', domain: '.claude.ai', hostOnly: false, path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: false, expirationDate: Date.now() / 1000 + 9999 }]); delete legacyBlob.v;
local.m.set('state', { v: 1, setupDone: true, vault: { mode: 'none' }, activeId: null, accounts: [{ id: lid, name: 'Old Alice', color: '#4f46e5', email: 'alice@example.com', sfp: 'x', createdAt: 1, lastUsed: 2, status: 'ok', blob: legacyBlob }] });
st = await ok('status'); assert.equal(st.needsUpgrade, true); assert.equal(st.accounts.length, 0);
assert.equal(await err('switch', { id: lid }), 'NOT_SETUP');
await ok('setPassword', { password: 'upgrade pass 1' }); st = await ok('status');
assert.equal(st.needsUpgrade, false); assert.equal(st.accounts[0].name, 'Old Alice');
assert.ok(!JSON.stringify([...local.m]).includes('Old Alice')); assert.equal(local.m.get('state').accounts[0].blob.v, 2);
jar = []; await ok('switch', { id: lid }); assert.equal(live(), 'TOKA'); pass('legacy data upgraded, re-encrypted, still works');

/* 9b. long idle windows: 1 day, 3 days, 1 week */
for (const m of [1440, 4320, 10080]) {
  await ok('setAutoLock', { minutes: m });
  session.m.set('vkAt', Date.now() - (m - 60) * 60000); assert.equal((await ok('status')).locked, false);
  session.m.set('vkAt', Date.now() - (m + 60) * 60000); assert.equal((await ok('status')).locked, true);
  await ok('unlock', { password: 'upgrade pass 1' });
}
assert.equal(await err('setAutoLock', { minutes: 999 }), 'GENERIC'); pass('1 day / 3 days / 1 week windows lock only after their own limit; invalid values rejected');

/* 9c. optional: stay unlocked across browser restarts */
await ok('setAutoLock', { minutes: 1440 });
await ok('setRemember', { enabled: true });
assert.ok(local.m.has('remember')); assert.ok(!JSON.stringify([...local.m]).includes(session.m.get('vk')), 'raw key must not be stored in the clear');
session.m.clear();                                                // simulate quitting and restarting the browser
st = await ok('status'); assert.equal(st.locked, false); assert.ok(st.accounts.length > 0); assert.equal(st.remember, true); pass('remembered key survives a browser restart');
session.m.clear(); const rem = local.m.get('remember'); rem.lastActive = Date.now() - 25 * 3600 * 1000; local.m.set('remember', rem);
st = await ok('status'); assert.equal(st.locked, true); assert.ok(!local.m.has('remember')); pass('remembered key expires after the idle window (even across restarts)');
await ok('unlock', { password: 'upgrade pass 1' }); assert.ok(local.m.has('remember'));
await ok('lock'); assert.ok(!local.m.has('remember')); assert.equal((await ok('status')).locked, true); pass('manual lock clears the remembered key');
await ok('unlock', { password: 'upgrade pass 1' }); assert.equal(await err('setAutoLock', { minutes: 0 }), 'GENERIC'); pass('"until browser closes" is rejected while remembering');
await ok('setRemember', { enabled: false }); assert.ok(!local.m.has('remember')); session.m.clear();
assert.equal((await ok('status')).locked, true); await ok('unlock', { password: 'upgrade pass 1' }); pass('turning remember off requires the password after restart');

/* 9d. limit-reset reminder (manual, encrypted, auto-hiding) */
const LID = 'legacy-1';
const until = Date.now() + 3 * 3600000;
await ok('setLimit', { id: LID, until });
st = await ok('status'); assert.equal(st.accounts.find((a) => a.id === LID).limitUntil, until);
assert.ok(!JSON.stringify([...local.m]).includes('limitUntil') && !JSON.stringify([...local.m]).includes(String(until))); pass('limit reminder is saved and stored encrypted');
for (const bad of [Date.now() - 1000, Date.now() + 9 * 24 * 3600000, 'soon', NaN, undefined]) assert.equal(await err('setLimit', { id: LID, until: bad }), 'BAD_TIME');
assert.equal(await err('setLimit', { id: 'nope', until }), 'NOT_FOUND'); pass('invalid reminder times are rejected');
await ok('setLimit', { id: LID, until: null }); st = await ok('status'); assert.equal(st.accounts.find((a) => a.id === LID).limitUntil, null); pass('limit reminder can be cleared');
await ok('setLimit', { id: LID, until: Date.now() + 150 }); await sleep(250);
st = await ok('status'); assert.equal(st.accounts.find((a) => a.id === LID).limitUntil, null); pass('reminder disappears by itself after the reset time');

/* 9e. automatic limit detection */
const { parseLimit, shapeOf } = await import('./limit-parser.js');
const NOW = 1_700_000_000_000, SEC = Math.floor(NOW / 1000);
const P = (o) => parseLimit({ status: 429, now: NOW, ...o });
assert.equal(P({ retryAfter: '3600', body: '' }).until, NOW + 3600000);
assert.equal(P({ retryAfter: new Date(NOW + 7200000).toUTCString(), body: '' }).until, NOW + 7200000);
assert.equal(P({ body: JSON.stringify({ error: { resetsAt: SEC + 5400 } }) }).until, (SEC + 5400) * 1000);
assert.equal(P({ body: JSON.stringify({ resets_at: (SEC + 5400) * 1000 }) }).until, (SEC + 5400) * 1000);
assert.equal(P({ body: JSON.stringify({ windows: { five_hour: { resets_at: new Date((SEC + 6000) * 1000).toISOString() } } }) }).until, (SEC + 6000) * 1000);
const emb = JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: JSON.stringify({ type: 'exceeded_limit', resetsAt: SEC + 9000 }) } });
assert.equal(P({ body: emb }).until, (SEC + 9000) * 1000);
assert.equal(P({ body: JSON.stringify({ a: { resetsAt: SEC + 90000 }, b: { resetsAt: SEC + 7000 } }) }).until, (SEC + 7000) * 1000);
assert.equal(P({ retryAfter: '30', body: '{"error":{"type":"rate_limit_error"}}' }).isLimit, false);
assert.equal(P({ body: '{"error":{"type":"overloaded_error"}}' }).isLimit, false);
assert.equal(P({ retryAfter: String(30 * 86400), body: '' }).isLimit, false);
const unk = P({ body: '{"error":{"message":"You have reached your usage limit"}}' }); assert.equal(unk.isLimit, true); assert.equal(unk.until, null);
assert.equal(parseLimit({ status: 500, retryAfter: '3600', body: '', now: NOW }).isLimit, false);
const sh = shapeOf(JSON.stringify({ error: { type: 'rate_limit_error', message: 'secret user text here' } }));
assert.equal(sh.error.type, 'rate_limit_error'); assert.ok(sh.error.message.startsWith('<string:')); pass('limit parser: header, body, embedded JSON, multiple windows; ignores ordinary throttling');

const TAB = { id: 'test', url: 'https://claude.ai/chat/abc', tab: { id: 1 } };
const hit = (body, ra = null, sender = TAB) => send('limitHit', { status: 429, path: '/api/organizations/1234abcd-0000-0000-0000-000000000000/chat_conversations/x/completion', retryAfter: ra, body }, sender);
const acct = async () => (await ok('status')).accounts.find((a) => a.id === LID);
await ok('setLimit', { id: LID, until: null });
let r = await hit(JSON.stringify({ error: { resetsAt: Math.floor(Date.now() / 1000) + 7200 } })); assert.ok(r.ok);
let a9 = await acct(); assert.ok(a9.limitUntil > Date.now() + 3600000); assert.equal(a9.limitGuess, false); pass('a 429 with a reset time marks the active account automatically');
await ok('setLimit', { id: LID, until: null });
await hit('{"error":{"message":"You have reached your usage limit"}}'); a9 = await acct();
assert.equal(a9.limitGuess, true); assert.ok(a9.limitUntil > Date.now()); pass('a limit without a reset time is marked as "time unknown"');
await ok('setLimit', { id: LID, until: Date.now() + 2 * 3600000 }); a9 = await acct(); assert.equal(a9.limitGuess, false);
await hit('{"error":{"message":"You have reached your usage limit"}}'); a9 = await acct(); assert.equal(a9.limitGuess, false); pass('an unknown-time event never overwrites a known reset time');
await ok('setLimit', { id: LID, until: null }); await hit('{"error":{"type":"rate_limit_error"}}', '20'); a9 = await acct(); assert.equal(a9.limitUntil, null); pass('ordinary request throttling is ignored');
assert.equal((await send('switch', { id: LID }, TAB)).ok, false);
assert.equal((await send('limitHit', { status: 429, body: 'x' }, EXT)).ok, false);
assert.equal((await send('status', {}, { id: 'test', url: 'https://evil.example/' })).ok, false); pass('content scripts can only call limitHit; popup cannot; foreign origins rejected');
await ok('lock'); r = await hit(JSON.stringify({ error: { resetsAt: Math.floor(Date.now() / 1000) + 3 * 3600 } })); assert.equal(r.data.queued, true);
await ok('unlock', { password: 'upgrade pass 1' }); await ok('detect'); a9 = await acct(); assert.ok(a9.limitUntil > Date.now() + 2.5 * 3600000); pass('a limit hit while locked is applied after unlock');
const diag = JSON.parse(await ok('limitDiag')); assert.ok(diag.path.includes(':id')); assert.ok(!JSON.stringify(diag).includes('1234abcd')); assert.ok(!JSON.stringify([...local.m]).includes('limitGuess')); pass('diagnostics are structure-only; limit data stays encrypted at rest');
await ok('setLimit', { id: LID, until: null });

/* 10. delete all, and no sync usage */
await ok('deleteAll'); assert.equal(local.m.size, 0); assert.equal(session.m.size, 0); assert.equal((await ok('status')).setupDone, false); pass('delete all data');
console.log('\nALL', n, 'CHECKS PASSED');
process.exit(0);
