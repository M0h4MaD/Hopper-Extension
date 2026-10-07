# Chrome Web Store submission checklist

## Before packaging
- [ ] Test on a clean Chrome profile with 2 real accounts: save, switch, cycle (Alt+Shift+Right/Left), expired session, wrong/forgotten password, Delete all data.
- [ ] Run `node tests/background.test.mjs` (37 checks), `node tests/content-scripts.test.mjs` (2) and `node tests/time-utils.test.mjs` (3) — see README for the import path note.
- [ ] Upgrade test: load v1.0, save accounts, then load this version over it; set the password; accounts must survive.
- [ ] Test in Arabic UI (chrome://settings/languages) and English; light and dark.
- [ ] Verify `chrome://extensions` shows no errors for the service worker and popup.
- [ ] No console output contains cookie values. No `storage.sync`, no `<all_urls>`, no remote scripts.
- [ ] Bump `version` in manifest.json (now 1.4.1); update CHANGELOG.md.
- [ ] Permissions are only `cookies`, `storage` and host `https://claude.ai/*`.
- [ ] Confirm branding: no Claude/Anthropic logo, neutral name, "Unofficial" in description.

## Package
```
cd hopper
zip -r ../hopper-1.4.1.zip manifest.json background.js crypto-vault.js limit-parser.js time-utils.js content popup.html popup.css popup.js _locales icons
```
`manifest.json` must be at the zip root. Don't include `docs/`, `tools/`, `.git`, or README files.

## Developer account
- [ ] Register at the Chrome Web Store Developer Dashboard (one-time **US$5** registration fee), verify email, enable 2-step verification.
- [ ] Edge Add-ons (Partner Center) is free; the same zip works.

## Dashboard
- [ ] Upload the zip. Fill Store listing from `docs/store-listing.md` (EN default + AR translation), category, icon 128, 1–5 screenshots 1280×800, small promo 440×280.
- [ ] Privacy tab: single purpose, each permission justification, "no remote code", data usage = Authentication information (local only), certify the three limited-use statements, privacy policy URL.
- [ ] Distribution: Public; regions as desired.
- [ ] Reviewer notes (see store-listing.md).

## Review expectations
- Extensions touching cookies get closer review; expect days to weeks. Keep justifications precise.
- Common rejections: vague single purpose, over-broad permissions, missing privacy policy, trademark/impersonation (hence the neutral name and disclaimer), unclear data-usage answers.
- Double-check that using this tool is consistent with the terms of the service you automate; the disclaimer doesn't replace that. Respond promptly to reviewer emails.
