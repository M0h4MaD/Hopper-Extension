/**
 * Hopper — background service worker (Manifest V3, ES module).
 *
 * Responsibilities: cookie snapshots, encrypted storage, account switching,
 * add-account flow, keyboard shortcuts, toolbar badge, auto-lock.
 * The popup is a thin UI that talks to this file through runtime messages.
 *
 * Privacy rules enforced here:
 *  - The only network requests go to https://claude.ai (session probe).
 *  - Cookie values are never logged. Only error codes are logged.
 *  - Everything is stored in chrome.storage.local (never .sync).
 *  - Cookies AND account labels (name/email/...) are encrypted; each record is
 *    bound to its account id with AES-GCM additional authenticated data.
 *  - A master password is mandatory. The unlocked key lives only in
 *    chrome.storage.session (memory) and expires after the idle time.
 */

import {
  PBKDF2_ITERATIONS, b64, unb64, newSalt, deriveKeyFromPassword, exportRaw, importRaw,
  encryptJSON, decryptJSON, sha256Hex, getDeviceKey, wipeDeviceKey,
} from './crypto-vault.js';

const ORIGIN = 'https://claude.ai';
const HOST = 'claude.ai';
const STATE_KEY = 'state';
const MIN_PASSWORD = 8;
const MAX_ACCOUNTS = 20;
const AUTOLOCK_DEFAULT = 240;                 // minutes of inactivity
const AUTOLOCK_CHOICES = [15, 60, 240, 0];    // 0 = until the browser closes
const PALETTE = ['#4f46e5', '#0891b2', '#0d9488', '#16a34a', '#ca8a04', '#ea580c', '#db2777', '#9333ea'];

class AppError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/* ------------------------------------------------------------------ *
 * Serial queue: every mutating operation runs one at a time so cookie
 * swaps and storage writes can never interleave.
 * (Not re-entrant: ops call each other directly, only handlers use it.)
 * ------------------------------------------------------------------ */
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

/* ------------------------------ state ------------------------------ */
/*
 * Stored shape (chrome.storage.local["state"]):
 *   { v, setupDone, vault, settings:{autoLockMin}, activeId,
 *     accounts:[ { id, meta:{iv,ct}, blob:{iv,ct} } ] }
 *   meta  = encrypted { name,color,email,sfp,createdAt,lastUsed,status }
 *   blob  = encrypted cookie snapshot
 * "Hydrated" state (in memory only) has accounts as plain
 *   { id, name, color, ..., blob } objects; persist() re-encrypts them.
 */

const defaultState = () => ({
  v: 2, setupDone: false, vault: { mode: 'password' }, settings: { autoLockMin: AUTOLOCK_DEFAULT },
  accounts: [], activeId: null,
});

async function loadState() {
  const { [STATE_KEY]: s } = await chrome.storage.local.get(STATE_KEY);
  return s || defaultState();
}
const saveRaw = (s) => chrome.storage.local.set({ [STATE_KEY]: s });

async function getPending() {
  return (await chrome.storage.session.get('pending')).pending || null;
}
const setPending = (p) => (p ? chrome.storage.session.set({ pending: p }) : chrome.storage.session.remove('pending'));

/** Setup finished AND a master password exists. (v1.0 "no password" data must be upgraded first.) */
function ensureReady(state) {
  if (!state.setupDone || state.vault.mode !== 'password') throw new AppError('NOT_SETUP');
}

const autoLockMin = (state) => (state.settings && state.settings.autoLockMin !== undefined ? state.settings.autoLockMin : AUTOLOCK_DEFAULT);

/**
 * Returns the AES key, or throws LOCKED. With `touch` the idle timer restarts
 * (sliding window), so normal use never asks for the password again.
 */
async function getKey(state, { touch = true } = {}) {
  if (state.vault.mode === 'none') return getDeviceKey();   // legacy, only used by the upgrade path
  const { vk, vkAt } = await chrome.storage.session.get(['vk', 'vkAt']);
  if (!vk) throw new AppError('LOCKED');
  const limit = autoLockMin(state) * 60000;
  if (limit && Date.now() - (vkAt || 0) > limit) {
    await chrome.storage.session.remove(['vk', 'vkAt']);
    throw new AppError('LOCKED');
  }
  if (touch) await chrome.storage.session.set({ vkAt: Date.now() });
  return importRaw(vk);
}

async function safeDecrypt(key, blob, aad) {
  try { return await decryptJSON(key, blob, aad); } catch { throw new AppError('CORRUPT'); }
}

/** Decrypt account labels into plain objects (legacy plaintext labels are accepted). */
async function hydrate(state, key) {
  const out = [];
  for (const a of state.accounts) {
    if (a.meta) {
      const m = await safeDecrypt(key, a.meta, `${a.id}:meta`);
      out.push({ ...m, id: a.id, blob: a.blob });
    } else {
      out.push(a);
    }
  }
  state.accounts = out;
}

/** Encrypt labels and write. Never mutates `state`. */
async function persist(state, key) {
  const raw = { ...state, accounts: [] };
  for (const a of state.accounts) {
    const { id, blob, ...meta } = a;
    raw.accounts.push({ id, blob, meta: await encryptJSON(key, meta, `${id}:meta`) });
  }
  await saveRaw(raw);
}

/** Load + unlock + hydrate in one step. */
async function openState({ touch = true } = {}) {
  const state = await loadState();
  ensureReady(state);
  const key = await getKey(state, { touch });
  await hydrate(state, key);
  return { state, key };
}

const encCookies = (key, id, list) => encryptJSON(key, list, `${id}:cookies`);

const publicAccount = (a) => ({
  id: a.id, name: a.name, color: a.color, email: a.email || null,
  createdAt: a.createdAt, lastUsed: a.lastUsed || null, status: a.status,
});

/* ------------------------------ cookies ----------------------------- */

const cookieHost = (c) => c.domain.replace(/^\./, '').toLowerCase();
const cookieUrl = (c) => `https://${cookieHost(c)}${c.path || '/'}`;

/** All cookies we are allowed to touch (exactly claude.ai, not subdomains). */
async function readLiveCookies() {
  const all = await chrome.cookies.getAll({ domain: HOST });
  return all.filter((c) => cookieHost(c) === HOST);
}

/** Keep every flag so the restored cookie behaves like the original. */
function serialize(c) {
  const out = {
    name: c.name, value: c.value, domain: c.domain, hostOnly: !!c.hostOnly,
    path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly,
    sameSite: c.sameSite || 'unspecified', session: !!c.session,
  };
  if (!c.session && c.expirationDate) out.expirationDate = c.expirationDate;
  return out;
}

async function clearCookies(cookies) {
  await Promise.all(cookies.map((c) => chrome.cookies.remove({ url: cookieUrl(c), name: c.name })));
  void chrome.runtime.lastError;
}

async function applyCookies(list) {
  const now = Date.now() / 1000;
  let count = 0;
  for (const c of list) {
    if (!c.session && c.expirationDate && c.expirationDate <= now) continue; // already expired
    const details = {
      url: cookieUrl(c), name: c.name, value: c.value, path: c.path || '/',
      secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite || 'unspecified',
    };
    if (!c.hostOnly) details.domain = c.domain;   // host-only cookies must NOT carry a domain
    if (!c.session && c.expirationDate) details.expirationDate = c.expirationDate;
    const res = await chrome.cookies.set(details);
    void chrome.runtime.lastError;
    if (!res) throw new AppError('SWITCH_FAILED');
    count++;
  }
  return count;
}

const hasUsableCookies = (list) =>
  Array.isArray(list) && list.length > 0 &&
  list.some((c) => c.session || !c.expirationDate || c.expirationDate > Date.now() / 1000);

/** Hash of the most "session-like" httpOnly cookie. Fallback identity when no email is detectable. */
async function sessionFingerprint(cookies) {
  const http = cookies.filter((c) => c.httpOnly);
  if (!http.length) return null;
  const pick = http.find((c) => /session/i.test(c.name)) ||
    [...http].sort((a, b) => (b.expirationDate || 0) - (a.expirationDate || 0))[0];
  return (await sha256Hex(`${pick.name}=${pick.value}`)).slice(0, 32);
}

/* --------------------------- session probe -------------------------- */

/**
 * Best-effort check against claude.ai itself using the browser's current cookies.
 * These endpoints are not a public API and may change; failures degrade gracefully
 * (state "unknown", no email) instead of breaking switching.
 * Returns { state: 'ok'|'anon'|'unknown', email, name }.
 */
async function probeSession() {
  for (const path of ['/api/account', '/api/bootstrap']) {
    try {
      const res = await fetch(ORIGIN + path, {
        credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' },
      });
      const isJson = (res.headers.get('content-type') || '').includes('json');
      if (res.status === 401 || (res.status === 403 && isJson)) return { state: 'anon' };
      if (!res.ok || !isJson) continue;
      const j = await res.json();
      const a = path === '/api/account' ? j : j && j.account;
      if (!a) return { state: 'anon' };
      return {
        state: 'ok',
        email: a.email_address || a.email || null,
        name: a.full_name || a.display_name || a.name || null,
      };
    } catch { /* offline / blocked: try next endpoint */ }
  }
  return { state: 'unknown' };
}

const sameEmail = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function findMatch(state, email, sfp) {
  return state.accounts.find((a) => sameEmail(a.email, email) || (sfp && a.sfp === sfp)) || null;
}

/* ------------------------------ tabs/badge -------------------------- */
/* No "tabs" permission: the claude.ai host permission is enough for tab.url of claude.ai tabs. */

const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

async function reloadClaudeTabs() {
  const tabs = await chrome.tabs.query({ url: ORIGIN + '/*' });
  if (!tabs.length) { await chrome.tabs.create({ url: ORIGIN + '/' }); return; }
  for (const tab of tabs) {
    const path = new URL(tab.url).pathname;
    // A conversation URL from another account would 404, so go to a fresh chat instead.
    if (/^\/(chat|project|projects)\//.test(path)) chrome.tabs.update(tab.id, { url: ORIGIN + '/new' });
    else chrome.tabs.reload(tab.id);
  }
}

let flashTimer = null;
function flashBadge(text, color, ms = 1800) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  clearTimeout(flashTimer);
  flashTimer = setTimeout(updateBadge, ms);
}

async function updateBadge() {
  const state = await loadState();
  const pending = await getPending();
  const short = chrome.i18n.getMessage('extShortName');
  if (!state.setupDone || state.vault.mode !== 'password') {
    chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
    chrome.action.setBadgeText({ text: '!' });
  } else if (pending && pending.phase === 'ready') {
    chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
    chrome.action.setBadgeText({ text: '+' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
  // Show the active account name in the tooltip only while unlocked (labels are encrypted).
  let title = short;
  try {
    if (state.setupDone && state.vault.mode === 'password' && state.activeId) {
      const key = await getKey(state, { touch: false });
      await hydrate(state, key);
      const active = state.accounts.find((a) => a.id === state.activeId);
      if (active) title = `${short} — ${active.name}`;
    }
  } catch { /* locked: generic title */ }
  chrome.action.setTitle({ title });
}

/* ------------------------- setup / vault / lock --------------------- */

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw new AppError('WEAK_PASSWORD');
}

async function makePasswordVault(password) {
  checkPassword(password);
  const salt = newSalt();
  const key = await deriveKeyFromPassword(password, salt);
  return {
    key,
    vault: { mode: 'password', salt: b64(salt), iter: PBKDF2_ITERATIONS, verifier: await encryptJSON(key, { ok: true }, 'verifier') },
  };
}

const unlockSession = async (key) => chrome.storage.session.set({ vk: await exportRaw(key), vkAt: Date.now() });

/** First run: a master password is required. */
async function opSetup({ password }) {
  const state = await loadState();
  if (state.setupDone) return;
  const { key, vault } = await makePasswordVault(password);
  state.vault = vault;
  state.setupDone = true;
  state.settings = { autoLockMin: AUTOLOCK_DEFAULT };
  await saveRaw(state);
  await unlockSession(key);
  await updateBadge();
}

/** Throttle: after 3 wrong attempts wait 1s, 2s, 4s ... up to 60s (in-memory, per browser session). */
async function checkThrottle() {
  const { unlockFail } = await chrome.storage.session.get('unlockFail');
  if (unlockFail && unlockFail.until > Date.now()) throw new AppError('TOO_MANY');
}
async function recordFailure() {
  const { unlockFail } = await chrome.storage.session.get('unlockFail');
  const n = ((unlockFail && unlockFail.n) || 0) + 1;
  const delay = n >= 3 ? Math.min(2 ** (n - 3) * 1000, 60000) : 0;
  await chrome.storage.session.set({ unlockFail: { n, until: Date.now() + delay } });
}

async function opUnlock({ password }) {
  const state = await loadState();
  if (state.vault.mode !== 'password') return;
  await checkThrottle();
  const key = await deriveKeyFromPassword(String(password || ''), unb64(state.vault.salt), state.vault.iter || PBKDF2_ITERATIONS);
  try {
    await decryptJSON(key, state.vault.verifier, 'verifier');
  } catch {
    await recordFailure();
    throw new AppError('BAD_PASSWORD');
  }
  await chrome.storage.session.remove('unlockFail');
  await unlockSession(key);
}

const opLock = () => chrome.storage.session.remove(['vk', 'vkAt']);

/**
 * Set or change the master password and re-encrypt everything (cookies + labels).
 * Also performs the one-time upgrade from v1.0 "device key" data.
 */
async function opSetPassword({ password }) {
  const state = await loadState();
  if (!state.setupDone) throw new AppError('NOT_SETUP');
  checkPassword(password);
  const oldKey = await getKey(state, { touch: false });   // device key (legacy) or unlocked key
  await hydrate(state, oldKey);
  const cookies = [];
  for (const a of state.accounts) cookies.push(await safeDecrypt(oldKey, a.blob, `${a.id}:cookies`));

  const { key: newKey, vault } = await makePasswordVault(password);
  for (let i = 0; i < state.accounts.length; i++) {
    state.accounts[i].blob = await encCookies(newKey, state.accounts[i].id, cookies[i]);
  }
  state.vault = vault;
  state.v = 2;
  state.settings = { autoLockMin: AUTOLOCK_DEFAULT, ...(state.settings || {}) };
  await persist(state, newKey);     // single write: old data stays valid until this succeeds
  await unlockSession(newKey);
  await updateBadge();
}

async function opSetAutoLock({ minutes }) {
  if (!AUTOLOCK_CHOICES.includes(minutes)) throw new AppError('GENERIC');
  const state = await loadState();
  ensureReady(state);
  state.settings = { ...(state.settings || {}), autoLockMin: minutes };
  await saveRaw(state);             // labels/blobs stay encrypted as stored
}

async function opDeleteAll() {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await wipeDeviceKey();
  await updateBadge();
}

/* ------------------------------- status ----------------------------- */

async function opStatus() {
  const state = await loadState();
  const needsUpgrade = state.setupDone && state.vault.mode !== 'password';
  const base = {
    setupDone: state.setupDone, needsUpgrade, locked: false, accounts: [], activeId: null,
    pending: null, palette: PALETTE, autoLockMin: autoLockMin(state), version: chrome.runtime.getManifest().version,
  };
  if (!state.setupDone || needsUpgrade) return base;

  let key;
  try { key = await getKey(state); } catch { return { ...base, locked: true }; }   // opening the popup counts as activity
  await hydrate(state, key);

  const pending = await getPending();
  let p = null;
  if (pending) {
    const match = pending.identity ? findMatch(state, pending.identity.email, pending.identity.sfp) : null;
    p = {
      phase: pending.phase, previousId: pending.previousId || null, matchId: match ? match.id : null,
      identity: pending.identity ? { email: pending.identity.email || null, name: pending.identity.name || null } : null,
    };
  }
  return { ...base, accounts: state.accounts.map(publicAccount), activeId: state.activeId, pending: p };
}

/* ------------------------ snapshot helpers -------------------------- */

/**
 * Re-save the live cookies into the ACTIVE account so rotated tokens are not lost.
 * Skipped when the live session is dead or clearly belongs to someone else.
 * Mutates `state` in memory; caller persists.
 */
async function refreshActiveSnapshot(state, key, live) {
  const acc = state.accounts.find((a) => a.id === state.activeId);
  if (!acc || !live.length) return false;
  const probe = await probeSession();
  if (probe.state === 'anon') return false;
  if (probe.state === 'ok' && probe.email && acc.email && !sameEmail(probe.email, acc.email)) return false;
  const list = live.map(serialize);
  acc.blob = await encCookies(key, acc.id, list);
  acc.sfp = await sessionFingerprint(list);
  if (probe.state === 'ok') { acc.status = 'ok'; if (probe.email) acc.email = probe.email; }
  return true;
}

/* ---------------------------- save account -------------------------- */

async function opSaveCurrent() {
  const { state, key } = await openState();

  const probe = await probeSession();
  if (probe.state === 'anon') throw new AppError('NOT_LOGGED_IN');
  const live = (await readLiveCookies()).map(serialize);
  if (!live.length) throw new AppError('NOT_LOGGED_IN');

  const sfp = await sessionFingerprint(live);
  const match = findMatch(state, probe.email, sfp);   // prevents saving the same account twice
  let id, updated;

  if (match) {
    id = match.id; updated = true;
    match.blob = await encCookies(key, id, live);
    match.sfp = sfp; match.status = 'ok'; match.lastUsed = Date.now();
    if (probe.email) match.email = probe.email;
  } else {
    if (state.accounts.length >= MAX_ACCOUNTS) throw new AppError('GENERIC');
    id = crypto.randomUUID(); updated = false;
    const used = new Set(state.accounts.map((a) => a.color));
    state.accounts.push({
      id,
      name: probe.name || (probe.email ? probe.email.split('@')[0] : chrome.i18n.getMessage('defaultAccountName', [String(state.accounts.length + 1)])),
      color: PALETTE.find((c) => !used.has(c)) || PALETTE[state.accounts.length % PALETTE.length],
      email: probe.email || null, sfp, createdAt: Date.now(), lastUsed: Date.now(), status: 'ok',
      blob: await encCookies(key, id, live),
    });
  }
  state.activeId = id;
  await persist(state, key);
  await setPending(null);
  await updateBadge();
  return { id, updated };
}

/** Explicit "Refresh session" for the active account. */
async function opRefreshActive() {
  const { state, key } = await openState();
  const acc = state.accounts.find((a) => a.id === state.activeId);
  if (!acc) throw new AppError('NOT_FOUND');
  const live = await readLiveCookies();
  const probe = await probeSession();
  if (probe.state === 'anon' || !live.length) throw new AppError('NOT_LOGGED_IN');
  if (probe.email && acc.email && !sameEmail(probe.email, acc.email)) throw new AppError('MISMATCH');
  const list = live.map(serialize);
  acc.blob = await encCookies(key, acc.id, list);
  acc.sfp = await sessionFingerprint(list);
  acc.status = 'ok';
  if (probe.email) acc.email = probe.email;
  await persist(state, key);
  return { id: acc.id };
}

/* ------------------------------ switching --------------------------- */

async function opSwitch(id) {
  const { state, key } = await openState();
  const target = state.accounts.find((a) => a.id === id);
  if (!target) throw new AppError('NOT_FOUND');
  if (state.activeId === id) return { noop: true };

  const stored = await safeDecrypt(key, target.blob, `${target.id}:cookies`);
  if (!hasUsableCookies(stored)) {
    target.status = 'expired';
    await persist(state, key);
    throw new AppError('EXPIRED');
  }

  // 1. Remember what is live now (for rollback) and refresh the current account's snapshot.
  const backup = (await readLiveCookies()).map(serialize);
  if (state.activeId) await refreshActiveSnapshot(state, key, backup);

  // 2. Swap cookies; roll back if anything fails.
  await clearCookies(backup);
  try {
    await applyCookies(stored);
  } catch {
    await clearCookies(await readLiveCookies());
    try { await applyCookies(backup); } catch { /* nothing more we can do */ }
    throw new AppError('SWITCH_FAILED');
  }

  // 3. Commit.
  state.activeId = id;
  target.lastUsed = Date.now();
  await persist(state, key);
  await updateBadge();
  await reloadClaudeTabs();

  // 4. Verify shortly after the reload; mark "Session expired" if the server rejects it.
  setTimeout(() => { serial(() => opVerify(id)).catch(() => {}); }, 2500);
  return { id };
}

async function opVerify(id) {
  const { state, key } = await openState({ touch: false });
  const acc = state.accounts.find((a) => a.id === id);
  if (!acc || state.activeId !== id) return;
  const probe = await probeSession();
  if (probe.state === 'anon') acc.status = 'expired';
  else if (probe.state === 'ok') { acc.status = 'ok'; if (probe.email && !acc.email) acc.email = probe.email; }
  else return;
  await persist(state, key);
}

/** Called when the popup opens: sync with whatever session is live right now. */
async function opDetect() {
  if (await getPending()) return { loggedIn: false };
  let opened;
  try { opened = await openState(); } catch { return { loggedIn: false }; }   // locked / not set up
  const { state, key } = opened;

  const probe = await probeSession();
  if (probe.state !== 'ok') return { loggedIn: false };
  const live = (await readLiveCookies()).map(serialize);
  const sfp = await sessionFingerprint(live);
  const match = findMatch(state, probe.email, sfp);
  if (match) {
    // Live session belongs to a saved account: adopt it and keep its snapshot fresh.
    state.activeId = match.id;
    match.status = 'ok';
    if (probe.email) match.email = probe.email;
    match.blob = await encCookies(key, match.id, live);
    match.sfp = sfp;
    await persist(state, key);
    await updateBadge();
  }
  return { loggedIn: true, email: probe.email || null, name: probe.name || null, matchId: match ? match.id : null };
}

/* --------------------------- add-account flow ----------------------- */

async function opStartAdd() {
  const { state, key } = await openState();
  if (state.accounts.length >= MAX_ACCOUNTS) throw new AppError('GENERIC');

  // Keep the current account's tokens fresh, then sign out of the browser session.
  const live = await readLiveCookies();
  if (live.length) {
    try { await refreshActiveSnapshot(state, key, live); } catch { /* best effort */ }
  }
  const previousId = state.activeId;
  state.activeId = null;
  await persist(state, key);
  await clearCookies(live);

  // Reuse the current tab if it is on claude.ai; otherwise open a new one.
  const [cur] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let tab;
  if (cur && cur.url && originOf(cur.url) === ORIGIN) tab = await chrome.tabs.update(cur.id, { url: ORIGIN + '/login', active: true });
  else tab = await chrome.tabs.create({ url: ORIGIN + '/login', active: true });

  await setPending({ phase: 'login', tabId: tab.id, previousId, startedAt: Date.now() });
  await updateBadge();
}

async function opCancelAdd() {
  const pending = await getPending();
  await setPending(null);
  if (pending && pending.previousId) {
    try { await opSwitch(pending.previousId); } catch { /* leave signed out */ }
  }
  await updateBadge();
}

/** Watch claude.ai tabs while an add-flow is waiting for the login to complete. */
async function onTabComplete(url) {
  const pending = await getPending();
  if (!pending || pending.phase !== 'login' || originOf(url) !== ORIGIN) return;
  if (new URL(url).pathname.startsWith('/login')) return;
  const probe = await probeSession();
  if (probe.state !== 'ok') return;
  const sfp = await sessionFingerprint((await readLiveCookies()).map(serialize));
  await setPending({ ...pending, phase: 'ready', identity: { email: probe.email, name: probe.name, sfp } });
  await updateBadge();
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) onTabComplete(tab.url).catch(() => {});
});

/* --------------------------- small mutations ------------------------ */

async function mutateAccount(id, fn) {
  const { state, key } = await openState();
  const acc = state.accounts.find((a) => a.id === id);
  if (!acc) throw new AppError('NOT_FOUND');
  fn(acc, state);
  await persist(state, key);
  await updateBadge();
}

const opRename = ({ id, name }) => {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) throw new AppError('GENERIC');
  return mutateAccount(id, (a) => { a.name = n; });
};
const opSetColor = ({ id, color }) => {
  if (!/^#[0-9a-f]{6}$/i.test(String(color))) throw new AppError('GENERIC');
  return mutateAccount(id, (a) => { a.color = color; });
};
const opRemove = ({ id }) => mutateAccount(id, (a, s) => {
  s.accounts = s.accounts.filter((x) => x.id !== id);
  if (s.activeId === id) s.activeId = null;   // browser stays signed in; we just forget the snapshot
});

/* ------------------------------ shortcuts --------------------------- */

async function opCycle(dir) {
  try {
    const { state } = await openState();
    const list = state.accounts.filter((a) => a.status !== 'expired');
    if (list.length < 2) return;
    const idx = list.findIndex((a) => a.id === state.activeId);
    const next = list[(idx + dir + list.length) % list.length];
    await opSwitch(next.id);
    flashBadge(Array.from(next.name.trim())[0]?.toUpperCase() || '?', next.color);
  } catch {
    flashBadge('!', '#dc2626');
  }
}

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'next-account') serial(() => opCycle(1));
  else if (cmd === 'prev-account') serial(() => opCycle(-1));
});

/* ------------------------------ messaging --------------------------- */

const HANDLERS = {
  status: opStatus,                                   // read-only, no queue needed
  setup: (m) => serial(() => opSetup(m)),
  unlock: (m) => serial(() => opUnlock(m)),
  lock: () => serial(opLock),
  setPassword: (m) => serial(() => opSetPassword(m)),
  setAutoLock: (m) => serial(() => opSetAutoLock(m)),
  deleteAll: () => serial(opDeleteAll),
  detect: () => serial(opDetect),
  saveCurrent: () => serial(opSaveCurrent),
  startAdd: () => serial(opStartAdd),
  cancelAdd: () => serial(opCancelAdd),
  switch: (m) => serial(() => opSwitch(String(m.id))),
  refreshActive: () => serial(opRefreshActive),
  rename: (m) => serial(() => opRename(m)),
  setColor: (m) => serial(() => opSetColor(m)),
  remove: (m) => serial(() => opRemove(m)),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;       // ignore anything not from this extension
  const handler = msg && HANDLERS[msg.type];
  if (!handler) { sendResponse({ ok: false, error: { code: 'GENERIC' } }); return; }
  handler(msg).then(
    (data) => sendResponse({ ok: true, data: data === undefined ? null : data }),
    (err) => {
      console.warn('[hopper] op failed:', msg.type, err && err.code ? err.code : 'UNEXPECTED'); // never log values
      sendResponse({ ok: false, error: { code: (err && err.code) || 'GENERIC' } });
    }
  );
  return true; // async response
});

chrome.runtime.onInstalled.addListener(() => updateBadge());
chrome.runtime.onStartup.addListener(() => updateBadge());
updateBadge();
