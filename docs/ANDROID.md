# Android

The APK is the same `dist/` bundle the web build produces, running in a WebView. One
codebase, two views, chosen at runtime in `src/bootstrap.ts` (§7). There is no second
app and no second copy of the model.

## Getting an APK without installing anything

Push to `main`. `.github/workflows/android.yml` runs `npm run check`, builds the bundle,
assembles a debug APK and uploads it as an artifact. Open the run in the Actions tab,
download `spatium-temporis-debug`, and sideload it.

Tagging `v*` also attaches the APK to a GitHub release, which gives the phone a stable
URL to download from.

This is the recommended path. The alternative below needs ~6 GB of SDK on your machine.

## Building locally

```bash
npm i @capacitor/core @capacitor/cli @capacitor/android
npm i @capacitor-community/sqlite @capacitor/local-notifications

npm run build          # bundle first — cap sync copies dist/, so order matters
npx cap add android    # once
npx cap sync android

cd android && ./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

Needs JDK 21 and the Android SDK (platform 34+, build-tools).

`npm run android` does the build-then-sync-then-assemble sequence in one command.

## Two manifest entries that are not optional

`npx cap add android` generates `android/app/src/main/AndroidManifest.xml`. Two
permissions have to be added to it, and the app is much worse without them:

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
```

**`POST_NOTIFICATIONS`** (Android 13+) — without it nothing prompts you when a block
ends, and every outcome becomes something you remembered to go and record. §9 is
explicit that reconstruction is fiction, so this is the difference between an adherence
record and an invented one.

**`SCHEDULE_EXACT_ALARM`** (Android 12+) — without it Doze batches the notification into
whatever maintenance window it feels like, which on a phone left alone can be hours. A
prompt that arrives ninety minutes late is asking you to reconstruct, which is the thing
it exists to prevent.

If exact alarms are refused, the app still works — it records `answered_at` alongside
every outcome, so a late answer is visibly a late answer rather than being quietly
treated as prompt.

The manifest lives in generated `android/`, which is gitignored by default. Either commit
`android/` once it exists, or keep these two lines in a patch applied after `cap add`.
Committing it is simpler and is what the CI assumes.

## What lives where on the device

| | |
|---|---|
| Database | App-private storage, a real SQLite file |
| Survives app kill, reboot, WebView reclaim | Yes |
| Survives uninstall | **No** |

That last row is why `⌘S` — a JSON snapshot written somewhere off the app's private
storage — matters more on the phone than it ever did on the desktop. §5.8 says backups
matter more than the choice of storage engine; on a phone-primary setup that stops being
a principle and becomes the actual recovery plan.

## Syncing with the desktop

```bash
npx tsx tools/merge-snapshot.ts desktop.json phone-2026-09-26.json -o merged.json
```

Union of both event logs, replayed. Neither side loses anything, and running it twice
changes nothing — occurrence ids are derived from `(node_id, date_ms)` precisely so that
two devices materializing the same day produce one row rather than two
(`src/core/derived-ids.ts`).

Do **not** restore one device's snapshot over the other's database. The phone's snapshot
contains the full history, so it looks safe — but the desktop is where spans, links and
revisions are made (§7), and those exist nowhere else. A restore deletes them on every
sync, and a pre-restore backup only lets you choose which half to lose.
