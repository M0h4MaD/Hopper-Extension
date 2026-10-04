/**
 * crypto-vault.js — encryption helpers (Web Crypto only, no libraries).
 *
 * Two modes:
 *  - "password": AES-GCM key derived from the user's master password with
 *    PBKDF2-SHA256 (600k iterations) + a random 16-byte salt.
 *  - "none": LEGACY (v1.0.x). A random NON-EXTRACTABLE key in IndexedDB. Kept only
 *    so old data can be read once and re-encrypted when the user sets the
 *    (now mandatory) master password.
 */

export const PBKDF2_ITERATIONS = 600000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

export const newSalt = () => crypto.getRandomValues(new Uint8Array(16));

/** Derive an AES-GCM key from a password. Extractable so the unlocked key can
 *  live in chrome.storage.session (memory only, wiped on browser close). */
export async function deriveKeyFromPassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportRaw(key) {
  return b64(await crypto.subtle.exportKey('raw', key));
}

export function importRaw(b64Key) {
  return crypto.subtle.importKey('raw', unb64(b64Key), 'AES-GCM', true, ['encrypt', 'decrypt']);
}

/**
 * Encrypt any JSON-serialisable value. A fresh random IV is used every time.
 * `aad` (additional authenticated data, e.g. "<accountId>:cookies") binds the
 * ciphertext to its owner, so records cannot be swapped inside storage.
 * Blobs are tagged v:2; older untagged blobs are still readable (no AAD).
 */
export async function encryptJSON(key, value, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = enc.encode(aad);
  const ct = await crypto.subtle.encrypt(params, key, enc.encode(JSON.stringify(value)));
  return { v: 2, iv: b64(iv), ct: b64(ct) };
}

export async function decryptJSON(key, blob, aad) {
  const params = { name: 'AES-GCM', iv: unb64(blob.iv) };
  if (blob.v === 2 && aad) params.additionalData = enc.encode(aad);
  const pt = await crypto.subtle.decrypt(params, key, unb64(blob.ct));
  return JSON.parse(dec.decode(pt));
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- device key (mode "none") stored in IndexedDB ---------- */

const DB_NAME = 'hopper-vault';
const STORE = 'keys';
let deviceKeyPromise = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export function getDeviceKey() {
  if (!deviceKeyPromise) {
    deviceKeyPromise = (async () => {
      const db = await openDb();
      try {
        let key = await idb(db, 'readonly', (s) => s.get('device'));
        if (!key) {
          key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
          await idb(db, 'readwrite', (s) => s.put(key, 'device'));
        }
        return key;
      } finally {
        db.close();
      }
    })().catch((e) => { deviceKeyPromise = null; throw e; });
  }
  return deviceKeyPromise;
}

export function wipeDeviceKey() {
  deviceKeyPromise = null;
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
