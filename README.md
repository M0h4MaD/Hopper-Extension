# Hopper — Account Switcher (Unofficial)

[English](README.md) · [العربية](README.ar.md)

> **Unofficial. Not affiliated with, endorsed by, or sponsored by Anthropic.** "claude.ai" is mentioned only to say which website this tool works with.
> Use it **only with your own accounts**. Do not use it to share accounts or to bypass usage limits.

Switch between your own claude.ai accounts in one click — no logging out and in.

## Features
- One chip per account in the toolbar popup; click to switch and the tab reloads automatically
- `+` adds an account: sign in, then confirm **Save this account?**
- **Session expired?** Click **Sign in again** — after you sign in, the account updates itself
- Rename · color · refresh session · remove
- **Limit tracking:** when claude.ai tells you you've hit a usage limit, that account is marked automatically and hovering its chip shows when it resets (or set it yourself with an alarm-style picker: hours + minutes, time of day, or date)
- Shortcuts: `Alt+Shift+A` open · `Alt+Shift+→/←` cycle accounts
- Arabic (RTL) and English · automatic light/dark theme
- Encrypted, local-only, no analytics

## Install
**Store:** Chrome Web Store / Edge Add-ons — *link coming after publication.*

**Manual (Load unpacked):**
1. Download or clone this repository.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and enable **Developer mode**.
3. Click **Load unpacked** and choose the folder containing `manifest.json`.
4. Pin the extension, open it, and set a master password.

## Security at a glance
- Session cookies **and** account labels are encrypted with AES-256-GCM. The key comes from your master password (PBKDF2-SHA256, 600k iterations).
- You type the password once per browser start. Every use renews an idle timer (default 4 h; 15 min · 1 h · 4 h · 1 day · 3 days · 1 week · until the browser closes).
- Optional **Stay unlocked after restarting the browser** (off by default): convenient but weaker, see the warning in Settings.
- Only permissions: `cookies`, `storage`, and `https://claude.ai/*`. Requests go only to claude.ai. Nothing is synced or sent anywhere. A small script on claude.ai watches only for HTTP 429 limit errors (details in [PRIVACY.md](PRIVACY.md)).
- A saved session is as sensitive as a password. See [PRIVACY.md](PRIVACY.md) and the full threat model in [docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md).

## Documentation
| Document | Content |
|---|---|
| [docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md) | Engineering/academic design: architecture, crypto, algorithms, threat model, tests |
| [docs/ARCHITECTURE.ar.md](docs/ARCHITECTURE.ar.md) | Same, in Arabic |
| [PRIVACY.md](PRIVACY.md) | What is stored and how to delete it |
| [docs/store-listing.md](docs/store-listing.md), [docs/SUBMISSION-CHECKLIST.md](docs/SUBMISSION-CHECKLIST.md) | Store submission material |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |

## FAQ
**Why a password?** Saved sessions are equivalent to logins, so they are always encrypted.
**I forgot the password.** It cannot be recovered. Use *Settings → Delete all data* and add your accounts again.
**"Session expired"?** The site ended that session. Use **Sign in again**.
**Does it follow my language?** Yes, the browser UI language (Arabic or English).
**Tip:** switch from the extension, not by logging out on the site (that invalidates the saved session).

## Contributing
Issues and PRs are welcome. No build step: edit, then reload at `chrome://extensions`. Keep permissions minimal, add no network destinations, never log cookie values, and add a test for background-logic changes (`node tests/background.test.mjs`, with `background.js` and `crypto-vault.js` copied next to it or the import path adjusted).

## Maintainer
Made by [M0h4MaD](https://github.com/M0h4MaD). Bug reports and ideas: open an issue on this repository.

## License
MIT — see [LICENSE](LICENSE).
