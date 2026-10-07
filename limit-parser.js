/**
 * limit-parser.js — pure helpers (no browser APIs) that turn a claude.ai HTTP 429 response
 * into "is this a usage limit, and when does it reset?".
 *
 * The exact response format of claude.ai is NOT a documented API, so the parser is deliberately
 * tolerant: it looks at the Retry-After header and scans the JSON body (including JSON embedded
 * in string fields) for reset-time-like keys. Anything it cannot understand degrades to
 * "limit reached, time unknown" instead of failing.
 */

export const MAX_AHEAD_MS = 8 * 24 * 3600 * 1000;   // ignore reset times further away than this
export const MIN_REAL_MS = 120 * 1000;               // shorter waits are ordinary request throttling, not a usage limit

const ABSOLUTE_KEY = /^(resets?_?at|reset_?time|reset_?at_?ms|available_?at|retry_?at)$/i;
const RELATIVE_KEY = /^(retry_?after|resets?_?in|reset_?in_?seconds|retry_?after_?seconds)$/i;
// Only used when no time is found: wording that clearly means "usage limit reached".
const LIMIT_WORDS = /(usage|message)s? limit|limit (reached|exceeded)|reached (your|the)[^.]{0,40}limit|exceeded[^.]{0,40}limit|out of messages/i;

function toMs(value, relative, now) {
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d+(\.\d+)?$/.test(s)) return toMs(Number(s), relative, now);
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (relative) return value < 1e9 ? now + value * 1000 : null;       // seconds from now
  if (value > 1e12) return value;                                       // epoch milliseconds
  if (value > 1e9) return value * 1000;                                 // epoch seconds
  return null;
}

function walk(node, depth, out, now) {
  if (depth > 6 || out.length > 300 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const x of node.slice(0, 50)) walk(x, depth + 1, out, now); return; }
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && /^\s*[{[]/.test(v) && v.length < 20000) {      // JSON embedded in a string (e.g. error.message)
      try { walk(JSON.parse(v), depth + 1, out, now); } catch { /* not JSON */ }
    }
    if (ABSOLUTE_KEY.test(k)) { const t = toMs(v, false, now); if (t) out.push({ t, s: 'body' }); }
    else if (RELATIVE_KEY.test(k)) { const t = toMs(v, true, now); if (t) out.push({ t, s: 'body' }); }
    else if (v && typeof v === 'object') walk(v, depth + 1, out, now);
  }
}

/** @returns {{isLimit:boolean, until:number|null, source:'header'|'body'|'none'}} */
export function parseLimit({ status, retryAfter, body, now = Date.now() }) {
  const none = { isLimit: false, until: null, source: 'none' };
  if (status !== 429) return none;

  const cands = [];
  if (retryAfter != null && String(retryAfter).trim() !== '') {
    const r = String(retryAfter).trim();
    const t = /^\d+$/.test(r) ? now + Number(r) * 1000 : Date.parse(r);
    if (Number.isFinite(t)) cands.push({ t, s: 'header' });
  }
  const text = String(body || '');
  try { walk(JSON.parse(text), 0, cands, now); } catch { /* not JSON */ }

  const future = cands.filter((c) => c.t > now && c.t <= now + MAX_AHEAD_MS);
  if (future.length) {
    // Several windows (e.g. 5-hour and weekly): take the earliest still-in-the-future one.
    // If that is not the binding limit, the next 429 will correct it.
    const best = future.reduce((a, b) => (b.t < a.t ? b : a));
    if (best.t - now < MIN_REAL_MS) return none;
    return { isLimit: true, until: best.t, source: best.s };
  }
  return { isLimit: LIMIT_WORDS.test(text), until: null, source: 'none' };
}

/** Structure-only view of a response body for diagnostics: keys and types, no free text. */
export function shapeOf(text) {
  let v;
  try { v = JSON.parse(text); } catch { return { nonJson: true, length: String(text || '').length }; }
  const go = (x, d) => {
    if (d > 6) return '…';
    if (x === null) return null;
    if (Array.isArray(x)) return x.slice(0, 5).map((i) => go(i, d + 1));
    if (typeof x === 'object') return Object.fromEntries(Object.entries(x).slice(0, 40).map(([k, val]) => [k, go(val, d + 1)]));
    if (typeof x === 'string') {
      if (/^\s*[{[]/.test(x)) { try { return { '<json-string>': go(JSON.parse(x), d + 1) }; } catch { /* plain string */ } }
      return /^[A-Za-z_.-]{1,40}$/.test(x) ? x : `<string:${x.length}>`;
    }
    return x;
  };
  return go(v, 0);
}

export const maskPath = (p) => String(p || '').slice(0, 200).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
