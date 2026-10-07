# Changelog

## 1.4.1
- **Alarm-style limit picker.** Set when a limit resets with hours + minutes ("In 2 h 30 min"), a time of day ("At 18:30", next occurrence), or an exact date and time (for weekly caps). A live preview shows the resulting reset time before you save. The 1 h / 3 h / 5 h shortcuts remain.
- When a limit is detected but claude.ai gave no reset time, the picker opens automatically so you can type it in.
- Tooltips now show precise durations ("2h 30m", "1d 3h") instead of rounding to one unit.
- New `time-utils.js` (pure functions) with its own tests.

## 1.4.0
- **Automatic limit detection.** When claude.ai answers a request with HTTP 429 because you hit a usage limit, the active account is marked automatically and hovering its chip shows when the limit resets. If claude.ai does not include a usable reset time, the account is marked "limit reached — reset time not detected" for 1 hour (renewed by the next limit error) and you can still enter the time yourself.
- Implemented with two small content scripts on `https://claude.ai/*` (no new permissions). They only look at 429 responses to claude.ai's own `/api/` calls and never modify requests or responses.
- Hardened message handling: content scripts can call only `limitHit`; the popup cannot; everything else is rejected by sender origin.
- New *Copy limit diagnostics* button (structure-only, no message text) to help tune the parser against real responses.
- Tests extended to 39 checks (`tests/background.test.mjs` and `tests/content-scripts.test.mjs`).
- Minimum Chrome version is now 111 (needed for `"world": "MAIN"` content scripts).

## 1.3.0
- **Limit reset reminder:** mark an account as "limit reached" and say when it resets (1 h / 3 h / 5 h presets or a date and time). Hovering the account chip shows "Limit resets in … (≈ time)", and a small badge appears on the chip. The reminder is entered by you, stored encrypted, and disappears by itself once the time passes. The extension does **not** read any usage data from claude.ai (there is no public API for it); a button opens claude.ai's own Settings → Usage page so you can copy the exact time.
- Tests extended to 29 checks.

## 1.2.0
- **One-click "Sign in again":** for an expired account (or when "Refresh session" finds the session dead) the extension opens the login page and, once you sign in as the same account, updates that account automatically — no extra "Save?" prompt. Signing in as a different account still asks first.
- **Optional "Stay unlocked after restarting the browser"** (off by default, explicit warning). The unlock key is kept wrapped by a device key and still expires after the chosen idle window (max 1 week). A manual Lock clears it.
- Tests extended to 25 checks.

## 1.1.1
- Added longer auto-lock idle windows: **1 day, 3 days, 1 week** (sliding; every use renews the timer).
- Note: the key is memory-only, so quitting the browser completely always locks the extension, regardless of the chosen window.

## 1.1.0 — security hardening
- Master password is now **mandatory**. v1.0 data is upgraded and re-encrypted in place on first open (nothing is lost).
- **Auto-lock** with a sliding idle timer (15 min / 1 h / 4 h default / until the browser closes). Normal use never re-prompts.
- Account labels (name, email, color, last used) are now **encrypted** too.
- Every record is bound to its account id (AES-GCM additional authenticated data); swapped records are rejected.
- Wrong-password throttling (1 s, 2 s, 4 s ... up to 60 s after 3 failures).
- Removed the `tabs` permission; `https://claude.ai/*` is sufficient.
- Added automated tests (`tests/background.test.mjs`).

## 1.0.0
- Initial release: one-click switching between your own claude.ai accounts.
- Encrypted local storage (AES-GCM, optional master password via PBKDF2).
- Add-account flow with "Save this account?" banner, rollback on failed switch, expired-session detection.
- Shortcuts: Alt+Shift+A (open), Alt+Shift+Right/Left (cycle).
- English and Arabic (RTL), automatic light/dark theme.
