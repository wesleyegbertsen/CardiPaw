---
name: android-verify
description: Build CardiPaw as a debug APK, run it in the Android emulator, and drive it (WebView over CDP, native screens over adb) to verify changes in the real app.
---

# Verifying CardiPaw in the Android app

For behaviour that only exists in the app: Capacitor plugins (Filesystem, Share,
Haptics, App), the share sheet, files in the app's cache, the back button. For
plain web UI, the `verify` skill is faster.

Commands are for Git Bash on Windows. Set `export MSYS_NO_PATHCONV=1` in any
command with a device path such as `/sdcard/ui.xml`: Git Bash otherwise rewrites
it to `C:/.../sdcard/ui.xml`.

## Prerequisites

- JDK 21, `ANDROID_HOME` set, and `$ANDROID_HOME/platform-tools` and
  `$ANDROID_HOME/emulator` on PATH (`adb --version`, `emulator -list-avds`).
- An AVD with a **Google Play** image (Gmail, Drive and Quick Share as share
  targets). The SDK platform the app compiles against (`android/variables.gradle`)
  does not need to be installed: Gradle downloads it on the first build.

## Boot the emulator

```bash
emulator -avd <name> -no-snapshot-load > emulator.log 2>&1 &   # run in the background
until [ "$(adb -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 1; done
```

- **Cold boot (`-no-snapshot-load`).** A Quick Boot snapshot saved from Android
  Studio resumed into a black screen with `adb devices` stuck on `offline`.
  A cold boot took 16 s.
- Wait on `sys.boot_completed`, or on the emulator process exiting. Don't grep
  the emulator log for "failed": it prints `Critical: Failed to load opengl32sw`
  as an INFO line and then boots fine.

## Build, install, launch

```bash
npm run build:android                              # vue-tsc, vite --mode capacitor, cap sync
(cd android && ./gradlew assembleDebug --no-daemon)
adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 shell monkey -p com.cardipaw.app -c android.intent.category.LAUNCHER 1
git checkout -- android/app/capacitor.build.gradle android/capacitor.settings.gradle
```

`cap sync` rewrites those two generated files with LF endings; with
`core.autocrlf=true` they then show as modified with no content change. The
last line restores them.

## Drive the app's UI (the WebView)

`uiautomator dump` sees only empty `FrameLayout`s inside the WebView, so drive
it like a browser over the Chrome DevTools Protocol. Debug builds expose it:

```bash
PID=$(adb -s emulator-5554 shell pidof com.cardipaw.app | tr -d '\r')
adb -s emulator-5554 forward tcp:9222 localabstract:webview_devtools_remote_$PID
curl -s http://localhost:9222/json/version     # "Android-Package": "com.cardipaw.app"
```

Install `playwright-core` (no browser download needed) in a scratch directory,
not the repo, copy [drive.mjs](drive.mjs) next to it, and write each step as a
module whose default export takes the page:

```js
// step.mjs, run with: node drive.mjs step.mjs
export default async (page) => {
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForURL(/#\/settings/);
  return { url: page.url() };
};
```

The socket name contains the app's PID, so forward again after the app restarts.

### Gotchas

- **Navigate with `location.hash`, not `page.goto`.** A goto reloads the whole
  WebView.
- The add-pet form's first `input` is the hidden photo-upload input. Target
  `#pet-name`.
- **Birthdate is required**: "Add pet" stays disabled without one. Open
  `#pet-birthdate` and click `.day-btn:not([disabled])`. Picking a day sets the
  date; there is no confirm button.
- Fixed elements (the `.fab`) have `offsetParent === null`, so don't filter for
  visibility with it.
- **Import without the Android file picker:** call `page.setInputFiles` on
  `input[type=file][accept*="json"]` in Settings with
  `{ name, mimeType: 'application/json', buffer }`, then click `.btn-confirm`.
  This is also the quickest way to seed pets and readings.
- **PDF export** (pet page, `.header-actions .icon-btn` nth(1)): `.btn-export`
  stays disabled until the pet has at least one reading.
- **Delete a pet** with `.icon-btn.danger`, then `.btn-confirm`. The app then
  goes *back* (`returnTo`), not necessarily Home.
- `ConfirmDialog` buttons are `.btn-confirm` and `.btn-cancel`.

## Native screens (share sheet, system dialogs)

- A click that opens the share sheet returns before the sheet appears. Wait for
  `adb shell dumpsys activity activities | grep topResumedActivity` to show
  `com.android.intentresolver/.ChooserActivity...`.
- Read it with `adb shell uiautomator dump /sdcard/ui.xml`, then `adb pull`.
  The shared file's name is a `text=` node.
- `adb shell input keyevent KEYCODE_BACK` dismisses it, which `Share.share`
  reports as "Share canceled".
- The stock image has no "save to Files" target. Drive, Gmail and Quick Share
  need a signed-in Google account or a second device.

## Inspect state

- App files: `adb shell run-as com.cardipaw.app ls -laR cache`. Read one with
  `adb exec-out run-as com.cardipaw.app cat <path>`.
- Logs: `adb logcat -c` before a step, then `adb logcat -d | grep ...` after it.
  - `Capacitor/Console` lines are the page's console.
  - In a debug build the bridge also logs every failed plugin call at error level
    (`native-bridge.js` `c.error(result.error)`, shown as `Msg: [object Object]`).
    That is not an app error. The plugin's error JSON, including its `code`, is
    on the `D Capacitor: Sending plugin error` line.
- Screenshot: `adb exec-out screencap -p > shot.png` (1080×2400 on the default
  phone AVD).
