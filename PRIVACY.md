# Privacy Policy — Hopper (Unofficial Account Switcher)

*Unofficial. Not affiliated with Anthropic.* Last updated: 2026-10-04

## What is stored
- **Session cookies of claude.ai** for each account you choose to save. They are sensitive (equivalent to a login), so they are **encrypted** with AES-GCM before being written.
- **Labels you see in the popup:** account name, color, email (if detected), last-used time and status. These are **encrypted** with the same key.
- **Settings (unencrypted):** whether setup is done, the auto-lock time, and a random salt / verifier for your master password (the password itself is never stored).

## Where it is stored
Only in `chrome.storage.local` on your device. Never in `chrome.storage.sync`. The unlocked key is held in `chrome.storage.session` (memory only) and disappears when the browser closes or the auto-lock time passes. **Only if you turn on "Stay unlocked after restarting the browser"** (off by default) a copy of the unlock key is also stored in `chrome.storage.local`, wrapped by a non-extractable device key in the extension's IndexedDB. It is deleted when the idle time passes, when you press Lock, or when you turn the option off.

## What leaves your device
**Nothing.** The extension makes no requests to any server except `https://claude.ai`, which it uses to (a) check whether the current session is valid and (b) read your own account name/email from claude.ai. No analytics, telemetry, ads, or third-party code. Cookie values are never logged.

**Limit detection:** to notice usage limits, a small script on claude.ai looks only at HTTP 429 error responses that claude.ai sends to your own browser (status, `Retry-After` header, and up to 4,000 characters of the error body). It never changes requests or responses. The body is parsed locally for a reset time; only that time (encrypted, with the account) is kept. A structure-only record of the last such event (keys and types, no message text) is held in memory for the *Copy limit diagnostics* button and disappears when the browser closes.

## Your control
- **Remove one account:** select it → *Remove*.
- **Delete everything:** *Settings → Delete all data* (clears all extension storage and the device key). Uninstalling also removes all extension data.
- Deleting data does not sign you out of claude.ai.

## Limits you should know
- A master password is required. It cannot be recovered if forgotten.
- With "Stay unlocked after restarting" on, anyone who copies your browser profile can open your saved accounts without the password until the idle time runs out. Leave it off if that is not acceptable.
- The account you are currently signed in to is a normal browser session; no extension can protect it from malware running as your OS user.

## Contact
Open an issue in the project repository.

---

# سياسة الخصوصية — Hopper (مبدّل حسابات غير رسمي)

*غير رسمي. لا علاقة له بشركة Anthropic.*

**ما الذي يُخزَّن:** كوكيز جلسات claude.ai للحسابات التي تختار حفظها، وبيانات العرض (الاسم واللون والبريد إن اكتُشف ووقت آخر استخدام والحالة)، وكلها مشفّرة بـ AES-GCM. أما الإعدادات (مدة القفل التلقائي وملح التشفير) فغير مشفّرة، وكلمة المرور نفسها لا تُخزَّن.

**أين:** في `chrome.storage.local` على جهازك فقط، ولا يُستخدم `chrome.storage.sync` أبدًا. وعند تفعيل خيار «البقاء مفتوحًا بعد إعادة التشغيل» (معطّل افتراضيًا) تُحفظ أيضًا نسخة من مفتاح الفتح مغلّفة بمفتاح جهاز غير قابل للتصدير، وتُحذف عند انتهاء مهلة الخمول أو الضغط على «قفل» أو إيقاف الخيار.

**ما الذي يغادر جهازك:** لا شيء. لا طلبات إلا إلى `https://claude.ai` للتحقق من صلاحية الجلسة وقراءة اسم/بريد حسابك. لا تحليلات ولا تتبّع ولا إعلانات، ولا تُسجَّل قيم الكوكيز.

**اكتشاف الحد:** لملاحظة بلوغ حد الاستخدام يطّلع سكربت صغير على claude.ai على استجابات الخطأ HTTP 429 فقط التي يرسلها claude.ai إلى متصفحك (الحالة، وترويسة `Retry-After`، وحتى 4000 حرف من نص الخطأ). ولا يغيّر أي طلب أو استجابة. يُحلَّل النص محليًا بحثًا عن وقت الإعادة ولا يُحفظ إلا هذا الوقت (مشفّرًا مع الحساب). وسجل بنيوي لآخر حالة (مفاتيح وأنواع دون أي نص رسائل) يبقى في الذاكرة لزر «نسخ تشخيص الحد» ويزول عند إغلاق المتصفح.

**تحكّمك:** احذف حسابًا واحدًا من زر «حذف»، أو احذف كل شيء من *الإعدادات ← حذف كل البيانات*. إلغاء تثبيت الإضافة يحذف بياناتها أيضًا.

**تنبيهات:** كلمة المرور الرئيسية إلزامية ولا يمكن استرجاعها إن نُسيت. والحساب المسجّل دخوله حاليًا جلسة متصفح عادية لا تستطيع أي إضافة حمايتها من برمجية خبيثة تعمل بصلاحياتك.
