/**
 * Hopper popup UI. Holds no secrets: every action is a message to background.js.
 * All user-provided text (account names, emails) is inserted with textContent only.
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

let S = null;            // latest status from background
let selectedId = null;   // account shown in the details card
let detected = null;     // result of "detect": is an unsaved/saved session live right now?
let view = 'main';       // 'main' | 'settings'
let renaming = false;
let paletteOpen = false;
let dismissedSave = false;

/* ------------------------------ helpers ------------------------------ */

/** Tiny DOM builder (no innerHTML anywhere). */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

async function call(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res || !res.ok) {
    const e = new Error('op failed');
    e.code = (res && res.error && res.error.code) || 'GENERIC';
    throw e;
  }
  return res.data;
}

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

const errText = (e) => chrome.i18n.getMessage('err_' + (e.code || 'GENERIC')) || t('err_GENERIC');

/** Run an action, show errors as a toast, then re-sync with the background. */
async function run(fn) {
  try { await fn(); } catch (e) { toast(errText(e), true); }
  await refresh();
}

const initial = (name) => (Array.from((name || '').trim())[0] || '?').toUpperCase();

function timeAgo(ts) {
  if (!ts) return t('neverUsed');
  const rtf = new Intl.RelativeTimeFormat(chrome.i18n.getUILanguage(), { numeric: 'auto' });
  const diff = (Date.now() - ts) / 1000;
  for (const [unit, secs] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (diff >= secs) return rtf.format(-Math.floor(diff / secs), unit);
  }
  return rtf.format(0, 'second');
}

const show = (sel, on) => { $(sel).hidden = !on; };

/* ------------------------------ rendering ------------------------------ */

async function refresh() {
  S = await call('status');
  render();
}

function render() {
  const setupMode = !S.setupDone || S.needsUpgrade;
  const ready = !setupMode && !S.locked;
  show('#viewSetup', setupMode);
  $('#setupTitle').textContent = S.needsUpgrade ? t('upgradeTitle') : t('setupTitle');
  $('#setupBody').textContent = S.needsUpgrade ? t('upgradeBody') : t('setupBody');
  show('#viewUnlock', !setupMode && S.locked);
  show('#viewSettings', ready && view === 'settings');
  show('#viewAccounts', ready && view === 'main');
  show('#lockBtn', ready);
  $('#settingsBtn').hidden = !ready;
  $('#settingsBtn').textContent = view === 'settings' ? t('back') : t('settings');
  renderChips(ready);
  renderBanner(ready && view === 'main');
  if (ready && view === 'main') renderDetails();
  if (ready && view === 'settings') renderSettings();
}

function renderChips(ready) {
  const box = $('#chips');
  box.replaceChildren();
  if (!ready) return;
  for (const a of S.accounts) {
    const cls = ['chip', a.id === S.activeId && 'active', a.id === selectedId && 'selected', a.status === 'expired' && 'expired'];
    const chip = h('button', {
      class: cls.filter(Boolean).join(' '), type: 'button', title: `${a.name}\n${t('chipHint')}`,
      'aria-label': a.name, 'aria-pressed': String(a.id === S.activeId),
      onclick: () => onChip(a.id),
      oncontextmenu: (e) => { e.preventDefault(); selectedId = a.id; view = 'main'; render(); },
    }, initial(a.name));
    chip.style.setProperty('--c', a.color);
    box.append(chip);
  }
  box.append(h('button', { class: 'chip add', type: 'button', title: t('addAccount'), 'aria-label': t('addAccount'), onclick: onAdd }, '+'));
}

function renderBanner(on) {
  const box = $('#banner');
  box.replaceChildren();
  box.hidden = true;
  if (!on) return;
  const p = S.pending;
  let node = null;

  if (p && p.phase === 'login') {
    node = [h('strong', {}, t('bannerWaitTitle')), h('p', {}, t('bannerWaitBody')),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: onCancelAdd }, t('cancel')))];
  } else if (p && p.phase === 'ready') {
    node = saveBanner(p.identity && p.identity.email, p.matchId, h('button', { class: 'btn', type: 'button', onclick: onCancelAdd }, t('discard')));
  } else if (detected && detected.loggedIn && !detected.matchId && !dismissedSave) {
    node = saveBanner(detected.email, null, h('button', { class: 'btn', type: 'button', onclick: () => { dismissedSave = true; render(); } }, t('dismiss')));
  }
  if (node) { box.append(...node); box.hidden = false; }
}

function saveBanner(email, matchId, secondaryBtn) {
  const match = matchId && S.accounts.find((a) => a.id === matchId);
  return [
    h('strong', {}, match ? t('bannerUpdateTitle') : t('bannerSaveTitle')),
    h('p', {}, match ? t('bannerUpdateBody', match.name) : (email ? t('bannerSaveBody', email) : t('bannerSaveBodyNoEmail'))),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onclick: onSave }, match ? t('update') : t('save')),
      secondaryBtn),
  ];
}

function renderDetails() {
  const box = $('#details');
  box.replaceChildren();
  const a = S.accounts.find((x) => x.id === selectedId) || S.accounts.find((x) => x.id === S.activeId) || S.accounts[0];
  if (!a) { box.append(h('p', { class: 'empty' }, t('noAccounts'))); return; }
  selectedId = a.id;
  const isActive = a.id === S.activeId;
  const expired = a.status === 'expired';

  const avatar = h('div', { class: 'avatar' }, initial(a.name));
  avatar.style.setProperty('--c', a.color);

  const card = h('div', { class: 'card' },
    h('div', { class: 'who' }, avatar,
      h('div', {}, h('div', { class: 'name' }, a.name), h('div', { class: 'email' }, a.email || t('emailUnknown')))),
    h('div', { class: 'meta' },
      h('span', {}, t('lastUsed', timeAgo(a.lastUsed))),
      expired ? h('span', { class: 'pill bad' }, t('statusExpired')) : (isActive ? h('span', { class: 'pill ok' }, t('statusActive')) : '')));

  if (renaming) {
    const input = h('input', { type: 'text', maxlength: '40', value: a.name, 'aria-label': t('rename') });
    const commit = () => run(async () => { renaming = false; await call('rename', { id: a.id, name: input.value }); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { renaming = false; render(); }
    });
    card.append(h('div', { class: 'rename' }, input,
      h('button', { class: 'btn primary', type: 'button', onclick: commit }, t('save'))));
    queueMicrotask(() => { input.focus(); input.select(); });
  }

  // "Refresh session" re-saves the live cookies of the active account; otherwise offer a fresh sign-in.
  const needsLogin = expired || !isActive;
  card.append(h('div', { class: 'actions' },
    h('button', { class: 'btn', type: 'button', onclick: () => { renaming = !renaming; paletteOpen = false; render(); } }, t('rename')),
    h('button', { class: 'btn', type: 'button', onclick: () => { paletteOpen = !paletteOpen; renaming = false; render(); } }, t('color')),
    h('button', { class: 'btn', type: 'button', onclick: () => (needsLogin ? onAdd() : onRefreshActive()) }, needsLogin ? t('relogin') : t('refreshSession')),
    h('button', { class: 'btn danger', type: 'button', onclick: () => onRemove(a) }, t('remove'))));

  if (paletteOpen) {
    const pal = h('div', { class: 'palette' });
    for (const c of S.palette) {
      const sw = h('button', { class: 'swatch' + (c === a.color ? ' on' : ''), type: 'button', 'aria-label': c, onclick: () => run(async () => { paletteOpen = false; await call('setColor', { id: a.id, color: c }); }) });
      sw.style.setProperty('--c', c);
      pal.append(sw);
    }
    card.append(pal);
  }
  box.append(card);
}

function renderSettings() {
  $('#pwState').textContent = t('pwStateSet');
  $('#autoLock').value = String(S.autoLockMin);
  $('#version').textContent = 'v' + S.version;
}

/* ------------------------------ actions ------------------------------ */

async function onChip(id) {
  view = 'main'; renaming = false; paletteOpen = false;
  if (id === S.activeId) { selectedId = id; render(); return; }
  selectedId = id;
  await run(async () => {
    await call('switch', { id });
    const a = S.accounts.find((x) => x.id === id);
    toast(t('toastSwitched', a ? a.name : ''));
  });
}

async function onAdd() {
  // Adding signs the browser out of claude.ai; warn if the live session is not saved yet.
  if (detected && detected.loggedIn && !detected.matchId && !S.pending && !confirm(t('confirmUnsaved'))) return;
  try { await call('startAdd'); window.close(); } catch (e) { toast(errText(e), true); }
}

const onCancelAdd = () => run(async () => { await call('cancelAdd'); detected = null; });

const onSave = () => run(async () => {
  const r = await call('saveCurrent');
  selectedId = r.id; detected = null; dismissedSave = false;
  toast(t(r.updated ? 'toastUpdated' : 'toastSaved'));
});

const onRefreshActive = () => run(async () => { await call('refreshActive'); toast(t('toastUpdated')); });

const onRemove = (a) => {
  if (!confirm(t('confirmRemove', a.name))) return;
  run(async () => { await call('remove', { id: a.id }); selectedId = null; toast(t('toastRemoved')); });
};

/* ------------------------------ forms ------------------------------ */

function checkPasswords(a, b) {
  if (a.length < 8) { toast(t('err_WEAK_PASSWORD'), true); return false; }
  if (a !== b) { toast(t('err_PW_MISMATCH'), true); return false; }
  return true;
}

$('#setupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = $('#setupPw').value;
  if (!checkPasswords(pw, $('#setupPw2').value)) return;
  run(async () => { await call(S.setupDone ? 'setPassword' : 'setup', { password: pw }); $('#setupForm').reset(); toast(t('toastPwSet')); });
});

$('#unlockForm').addEventListener('submit', (e) => {
  e.preventDefault();
  run(async () => { await call('unlock', { password: $('#unlockPw').value }); $('#unlockForm').reset(); await detect(); });
});

$('#pwForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = $('#newPw').value;
  if (!checkPasswords(pw, $('#newPw2').value)) return;
  run(async () => { await call('setPassword', { password: pw }); $('#pwForm').reset(); toast(t('toastPwSet')); });
});
$('#autoLock').addEventListener('change', (e) => run(() => call('setAutoLock', { minutes: Number(e.target.value) })));

$('#deleteAll').addEventListener('click', () => {
  if (!confirm(t('confirmDeleteAll'))) return;
  run(async () => { await call('deleteAll'); selectedId = null; detected = null; view = 'main'; toast(t('toastDeleted')); });
});

$('#settingsBtn').addEventListener('click', () => { view = view === 'settings' ? 'main' : 'settings'; render(); });
$('#lockBtn').addEventListener('click', () => run(async () => { await call('lock'); toast(t('toastLocked')); }));

/* ------------------------------ init ------------------------------ */

function applyI18n() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir');
  document.title = t('extShortName');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
}

/** Ask the background whether a session is live right now (and sync the active account). */
async function detect() {
  try { detected = await call('detect'); } catch { detected = null; }
  await refresh();
}

(async function init() {
  applyI18n();
  try { await refresh(); } catch { toast(t('err_GENERIC'), true); return; }
  if (S.setupDone && !S.needsUpgrade && !S.locked) await detect();
})();
