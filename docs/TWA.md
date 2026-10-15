# Packaging SajiloKaam for the Play Store

A Trusted Web Activity, built with Bubblewrap. Everything here is ready except
the two things that need a Google account and a keystore; **publishing waits
for launch**, because a Play Console account is a one-time US$25 fee and a
listing needs screenshots of a product nobody has used yet.

## What a TWA is, and why it rather than a rewrite

A TWA is **the user's own Chrome, full screen, with the address bar removed**.
Same engine, same service worker, same IndexedDB, same session cookie. It is
not a WebView wrapper and it is not a port.

What follows from that, and why this is the right packaging here:

- **There is no second codebase.** The offline photo queue, the push
  subscription, the booking flow and the Nepali half all work in the app
  because they are the same code. An Expo rewrite would be a second
  implementation of the booking flow, the triage card and the payment screens,
  diverging from day one.
- **A fix deployed to the website is live in the app**, with no store review
  and nothing for anybody to install. On a product where the price bands and
  the safety copy are published content, that matters more than it sounds.
- **The camera behaves identically**, which is the part that would otherwise be
  a surprise. The arrival photograph relies on `<input capture="environment">`
  handing back the phone's own JPEG with EXIF intact, because
  `lib/photos/evidence.ts` refuses a file with no camera clock. A WebView-based
  wrapper is a different browser with different file-picker behaviour; Chrome
  in a TWA is the browser the flow was tested in.

What it costs: the app is a thin shell, so **it is useless without a network on
first run** — there is nothing to launch into until the service worker has been
installed by at least one online visit. That is why the offline shell exists and
why it is precached rather than lazily cached.

## The state of it in this repository

| Piece | Where | State |
| --- | --- | --- |
| Web app manifest | `app/manifest.ts` | done |
| Icons, incl. maskable | `public/icons/`, from `scripts/make-icons.mjs` | done |
| Service worker | `app/sw.js` ← `lib/pwa/worker-source.ts` | done |
| Offline shell | `app/[locale]/offline/page.tsx` | done |
| Bubblewrap config | `twa/twa-manifest.json` | done |
| Digital asset links | `app/.well-known/assetlinks.json/route.ts` | **waiting on a keystore** |
| Play Console listing | — | **waiting on launch** |

`/.well-known/assetlinks.json` answers **404 until `ANDROID_PACKAGE_NAME` and
`ANDROID_CERT_FINGERPRINT` are set**, and that is deliberate. The alternative —
a committed file with a placeholder fingerprint — is the worst option available:
it would publish a statement matching no app, Android would fail verification
silently, and the only symptom is an address bar across the top of the app,
noticed on somebody else's phone weeks after submission and read as a packaging
bug rather than a wrong constant.

`/api/health` reports it for free under `twa.assetlinks`, so "did somebody set
it, and is it the right shape" never costs a store submission to find out.

## The steps, when it is time

Everything below happens on a machine with a JDK and Node. None of it can run
from the agent sandbox: Bubblewrap downloads the Android SDK, and the keystore
must never be in this repository.

### 1. Build the app

```bash
npm install -g @bubblewrap/cli
cd twa
bubblewrap init --manifest=https://sewasathi.vercel.app/manifest.webmanifest
```

`bubblewrap init` will offer to use `twa-manifest.json` in this directory —
take it, so the colours, the orientation lock and the maskable icon are the
ones this repo decided rather than its defaults.

It then asks to create a signing key. **Say yes, and keep the keystore and its
passwords somewhere you will still have them in five years.** Google will not
re-sign an app for you: losing this key means the app can never be updated
again under the same listing, only republished as a new one, and every install
is orphaned.

```bash
bubblewrap build
```

This produces `app-release-signed.apk` and `app-release-bundle.aab`. The `.aab`
is what the Play Store takes.

### 2. Publish the asset links

Read the fingerprint out of the keystore you just made:

```bash
keytool -list -v -keystore ./android.keystore -alias sajilokaam
```

Take the **SHA-256** line, not the SHA-1 line directly above it. That mistake
is the single most common way this fails, so `assetLinksReadiness` refuses a
20-byte fingerprint and says so by name.

Set both in Vercel (Production), then redeploy:

```
ANDROID_PACKAGE_NAME     np.com.sajilokaam.twa
ANDROID_CERT_FINGERPRINT A1:B2:…  (32 colon-separated pairs)
```

Check it before submitting anything:

```bash
curl -s https://sewasathi.vercel.app/.well-known/assetlinks.json
curl -s https://sewasathi.vercel.app/api/health | grep -o '"twa.assetlinks"[^}]*'
```

### 3. Google signs it too, and that changes the fingerprint

Play App Signing is on by default and is worth keeping — it is what lets Google
re-sign updates if your upload key is ever compromised. The consequence is that
**the certificate users receive is Google's, not yours**, so after the first
upload you must read the SHA-256 that Play Console shows under
*Setup → App signing* and put **that** in `ANDROID_CERT_FINGERPRINT`.

Both can be listed at once, which is what you want during the changeover:
`androidAppLink` currently emits one fingerprint, so if both are needed, that
function takes a second entry and the environment variable becomes a
comma-separated pair. It is not built that way today because it is one line the
day it is needed and a guess until then.

### 4. The listing

Still outstanding and deliberately not invented here:

- **Screenshots** — at least two phone screenshots. There is no honest one yet;
  every screen in this product shows either a real booking or an empty state.
- **A feature graphic**, 1024×500.
- **A privacy policy URL** — `/legal/privacy` already exists and is published in
  both languages.
- **Data safety form** — this is the one worth preparing properly. Declare: phone
  number (account), approximate location (taken only at an arrival tap, see
  `components/provider/arrival-panel.tsx`), photographs (uploaded, EXIF stripped
  server-side, never stored for triage), and payment information (handled by
  eSewa and Khalti, never stored by us). Do not declare precise location — the
  arrival coordinate is rounded and never shown as proof.
- **Content rating questionnaire** and a **target audience** of 18+.

`shortcuts` in `twa-manifest.json` is empty on purpose. A long-press shortcut
is a real surface and there is no evidence yet about which two tasks deserve
one; the candidates are "book something" and "my jobs", and that is a guess
until somebody has used the app.

## Push notifications in the app

They work without any extra Android work: a TWA delivers web push through
Chrome, and `enableNotifications: true` in `twa-manifest.json` is what makes the
app declare the Android 13 runtime permission so the system prompt appears.

The opt-in flow is unchanged — `components/pwa/push-opt-in.tsx`, on `/account`
and `/provider` — and asks on a tap, never on load. That matters more inside an
app than in a browser: Android shows its own permission dialogue on top of ours,
and two prompts in a row with no explanation between them is how people say no.
