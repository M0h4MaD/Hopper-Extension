# Store listing (Chrome Web Store / Edge Add-ons)

**Category:** Productivity · **Name:** Hopper – Account Switcher (Unofficial)

## English
**Short description (≤132):**
Switch between your own claude.ai accounts in one click. Encrypted, local-only. Unofficial — not affiliated with Anthropic.

**Long description:**
Hopper lets you keep several of YOUR OWN claude.ai accounts (personal, work, team) and switch between them from the toolbar in one click — no logging out and in.

• Account chips with initial and color; the active one has a ring
• Click = instant switch and automatic tab reload
• "+" adds an account; Hopper asks "Save this account?" once you've signed in
• Rename, recolor, refresh session, remove
• Limit tracking: when claude.ai reports a usage limit, the account is marked and a hover tooltip shows when it resets (or enter the time yourself)
• Session expired? One click on "Sign in again" and the account updates itself
• Shortcuts: Alt+Shift+A (open), Alt+Shift+Right/Left (cycle)
• Arabic (RTL) and English; automatic light/dark
• Master password + auto-lock: sessions and account labels are encrypted with AES-GCM
• Everything stays on your device. No analytics, no ads, no servers.

Unofficial. Not affiliated with, endorsed by, or sponsored by Anthropic. Use only with your own accounts; do not use it to share accounts or bypass usage limits.

## العربية
**الوصف القصير:**
بدّل بين حساباتك الخاصة على claude.ai بنقرة واحدة. مشفّر ومحلي فقط. غير رسمي — لا علاقة له بشركة Anthropic.

**الوصف الطويل:**
يتيح لك Hopper حفظ عدة حسابات تملكها على claude.ai (شخصي، عمل، فريق) والتبديل بينها من شريط الأدوات بنقرة واحدة دون تسجيل خروج ودخول.

• شرائح حسابات بحرف ولون، وحلقة حول الحساب النشط
• النقر = تبديل فوري وإعادة تحميل التبويب تلقائيًا
• زر «+» لإضافة حساب، ثم سؤال «حفظ هذا الحساب؟» بعد تسجيل الدخول
• إعادة تسمية وتغيير لون وتحديث الجلسة وحذف
• تتبّع الحد: عندما يُبلغ claude.ai ببلوغ حد الاستخدام يُعلَّم الحساب ويظهر موعد إعادة التعيين عند تمرير الفأرة (أو أدخل الوقت بنفسك)
• انتهت الجلسة؟ نقرة على «تسجيل الدخول مجددًا» ويُحدَّث الحساب تلقائيًا
• اختصارات: Alt+Shift+A للفتح، وAlt+Shift+Right/Left للتنقل
• عربي (RTL) وإنجليزي، ووضع فاتح/داكن تلقائي
• كلمة مرور رئيسية وقفل تلقائي لتشفير الجلسات والبيانات بـ AES-GCM
• كل شيء يبقى على جهازك: بلا تحليلات ولا إعلانات ولا خوادم.

غير رسمي. لا علاقة له بشركة Anthropic ولا ترعاه. استخدمه مع حساباتك فقط، وليس لمشاركة الحسابات أو تجاوز حدود الاستخدام.

## Single purpose statement
Switch between the user's own claude.ai accounts by saving and restoring each account's session cookies locally.

## Permission justifications (one line each)
- **cookies** — Read, save, remove and restore the claude.ai session cookies of the user's own accounts; this is the core switching mechanism.
- **Content scripts on https://claude.ai/\*** — Detect the HTTP 429 usage-limit errors claude.ai returns, so the active account can be marked as limited and show when it resets. They look at nothing else, change nothing, and send nothing anywhere.
- **storage** — Keep the encrypted account snapshots and settings in chrome.storage.local (and the unlocked key, memory-only, in chrome.storage.session).
- *(No "tabs" permission is requested. Reloading claude.ai tabs and detecting sign-in uses the claude.ai host permission only.)*
- **Host permission https://claude.ai/\*** — Required to access that site's cookies and to check session validity/account name through claude.ai itself; no other host is accessed.
- **Remote code:** None. All code is packaged in the extension.

## Privacy practices tab
- Data collected: *Authentication information* (session cookies), handled locally only.
- *Website content:* the extension reads claude.ai's own HTTP 429 error responses locally to detect usage limits; only the parsed reset time is kept (encrypted on the device).
- Not sold or transferred to third parties; not used for unrelated purposes; not used for creditworthiness.
- Privacy policy URL: link to PRIVACY.md in the public repo (raw GitHub Pages URL).

## Screenshots plan (1280×800, PNG/JPEG, 3–5)
1. **Account bar** — popup with 4 chips (one active ring), detail card below. Caption: "Switch accounts in one click."
2. **Add-account flow** — claude.ai login tab behind, popup with banner "Save this account?". Caption: "Add and save a new account."
3. **Settings** — master password state + Delete all data. Caption: "Encrypted, local-only, delete anytime."
4. *(optional)* Arabic RTL popup. Caption: "العربية والإنجليزية."
Use test accounts / blurred emails. Do not show Claude/Anthropic logos. Small promo tile 440×280: icon + "Hopper".

## Notes for reviewers
The extension needs a claude.ai account to demo. Flow to test: install → set a master password (required) → sign in to claude.ai → open popup → "Save this account?" → Save → "+" → sign in with a second account → Save → click chips to switch. Cookies never leave the device (see PRIVACY.md). A screen recording can be provided on request.
