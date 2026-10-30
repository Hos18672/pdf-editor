# Publishing Paginka: legal and store checklist

Status as of 30 Oct 2026. The app processes documents only on the device, has no account, no analytics, no ads and no cookies.

## Done in the app and website

| Item | Where |
|---|---|
| Impressum (ECG § 5, MedienG § 25) | `public/legal/impressum.html` → https://hos18672.github.io/pdf-editor/legal/impressum.html |
| Privacy policy (GDPR Art. 13, DE + EN) | `public/legal/privacy.html` → https://hos18672.github.io/pdf-editor/legal/privacy.html |
| Terms of use (no warranty beyond the law, simple e-signature note, Austrian law) | `public/legal/terms.html` |
| Open-source licenses | `public/legal/licenses.html` |
| Links to all four on the start screen and the All tools page; open inside the app, also offline | `src/ui/Legal.tsx` |
| Cookies: none. Only strictly necessary on-device storage (settings, recent files, saved signatures, offline cache) → no consent banner needed (§ 165(3) TKG 2021); explained in the privacy policy | — |
| No third-party requests from the web app (pdf.js CDN fallback removed) | `src/ui/pdfjs.ts`, `public/sw.js` |
| Android permissions reduced to what is used: CAMERA, INTERNET (ML Kit module download), plus framework defaults; SYSTEM_ALERT_WINDOW and storage permissions blocked | `app.json` → `android.blockedPermissions` |
| Target SDK 36 (Android 16): required for new apps and updates from 31 Aug 2026 | Expo SDK 58 default |

## Google Play Console: what to enter

**App content → Privacy policy:** `https://hos18672.github.io/pdf-editor/legal/privacy.html`

**App content → Data safety** (the app itself collects nothing; the only collection is Google ML Kit diagnostics, which must be declared):
- Does your app collect or share any of the required user data types? **Yes** (because of the ML Kit SDK).
- Is all user data encrypted in transit? **Yes** (ML Kit uses HTTPS).
- Do you provide a way for users to request that their data is deleted? **No** (nothing is stored by you; on-device data can be cleared by the user). Answer per the form's options.
- Data types collected:
  - **App info and performance → Diagnostics** (and **Crash logs** if the form asks): collected, **not shared**, processed **ephemerally: no**, **required**, purpose **Analytics / App functionality** (ML Kit diagnostics).
  - **Device or other IDs**: collected, not shared, required, purpose **Analytics / App functionality** (ML Kit).
- Do **not** declare files, photos or documents: they are processed only on the device and never leave it (Google's definition of "collected" means sent off the device).
- Re-check against https://developers.google.com/ml-kit/android-data-disclosure before submitting.

**App content → other declarations**
- Ads: **No ads**.
- App access: **All functionality is available without special access** (no login).
- Content rating (IARC questionnaire): category **Utility / Productivity**; no violence, sexual content, gambling, user-generated content sharing, or location sharing → expect **PEGI 3 / Everyone**.
- Target audience: **18+** or **13+ and older** (not directed at children; avoids the Families policy).
- News app: No. COVID-19 app: No. Government app: No. Financial features: None. Health: None.
- Permissions declaration: CAMERA is used in the foreground for document scanning only (no special declaration form needed).

**Store listing**
- App name: Paginka (≤ 30 characters). Short description (≤ 80): e.g. "Edit, sign and scan PDFs. Files never leave your phone."
- Developer contact (shown publicly): e-mail rezahosseiniafg@gmail.com; website https://hos18672.github.io/pdf-editor/
- Graphics: 512×512 icon, 1024×500 feature graphic, at least 2 phone screenshots.

**Developer account (Google requirement for personal accounts)**
- Identity verification with a legal name and address; Google shows the developer's name and, for monetised apps, the address publicly. Paginka is free, so the address is not shown in the listing.
- New personal accounts created after Nov 2023 must run a **closed test with at least 12 testers for 14 days** before production access.

**Release build**
- Upload an **Android App Bundle (.aab)** signed with your upload key (the CI currently builds an APK; add a `bundleRelease` step and enrol in Play App Signing).

## Open points to decide
- The repository `LICENSE` file is still the Expo template's (MIT, © 650 Industries). Replace it with your own choice (e.g. MIT © Reza Hossaini, or "All rights reserved").
- European Accessibility Act: it applies to e-commerce and certain consumer services offered by businesses; a free, private, non-commercial app is not in scope. No accessibility statement is required, but the app already follows the WCAG basics (labels, focus, 44px targets).

This checklist is not legal advice.
