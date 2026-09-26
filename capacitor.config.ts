/**
 * Capacitor configuration — the Android wrapper (§7).
 *
 * The APK is a WebView running the same `dist/` bundle the web build produces. Not a
 * rewrite, not a second codebase: one build, two views, chosen at runtime in
 * `src/bootstrap.ts`. That file is the only one that knows which platform it is on.
 *
 * `npx cap sync` copies `dist/` into `android/app/src/main/assets/public`, so the build
 * order is always: `npm run build` first, `npx cap sync` second. Running them the other
 * way round ships yesterday's bundle, silently, and it looks exactly like a caching
 * problem.
 */

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.spatium.temporis',
  appName: 'Spatium Temporis',
  webDir: 'dist',

  android: {
    /**
     * Debug builds only, and only over `adb` — never a cleartext network policy for a
     * release. This app holds an entire inner life and has no server to talk to, so
     * there is nothing it should be sending anywhere in plaintext.
     */
    allowMixedContent: false,
  },

  plugins: {
    /**
     * The database lives in the app's private storage as a real SQLite file, which is
     * what makes the phone the authoritative copy: it survives the WebView being
     * reclaimed and the OS clearing web storage under memory pressure. OPFS survives
     * neither.
     */
    CapacitorSQLite: {
      androidIsEncryption: false,
    },

    LocalNotifications: {
      smallIcon: 'ic_stat_spatium',
      iconColor: '#7aa2f7',
    },
  },
}

export default config
