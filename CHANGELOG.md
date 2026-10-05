# Changelog

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
