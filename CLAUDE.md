# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Modular RC (https://rc.igorware.com/): a Bluetooth remote-controller PWA for RC cars. It is a single page that talks to the car over the **Web Bluetooth API** (Chrome 55+, BLE / Bluetooth v4 only). There is no framework and no bundler. The browser loads `src/` as is, served by Apache + PHP.

## Commands

There are no npm scripts. Run Grunt through npx:

- `npx grunt` runs the default task: `jsonlint`, `eslint`, `htmllint`, `uglify`, `notify:done`
- `npx grunt eslint` lints `Gruntfile.cjs` and `src/assets/js/**/*.js`
- `npx grunt jsonlint eslint` runs the lint checks only, without minifying
- `npx eslint src/assets/js/app.js` lints a single file
- `npx grunt min` runs uglify only
- `npx grunt watch` re-lints `Gruntfile.cjs` and `src/assets/js/**/*.js` when they change

There is no test suite. To verify a change, load the page in Chrome with a BLE device, or use the in-app terminal screen to see sent and received traffic. The connect flow logs each step (`Connected to GATT server`, `Found primary service`, `Found characteristic`, ...), so the last line shows where a failed connection stopped.

`app.js` does not lint clean: ESLint reports 13 errors that were already there. Compare the error counts before and after a change instead of expecting a clean run.

Gotchas in the Grunt config:
- `uglify` only minifies `app.js` and `service-worker.js`, writing `*.min.js` next to them. `eslint:js` skips `*.min.js`. `index.php` loads `app.js`, not `app.min.js`.
- `htmllint` only targets `**/*.html`. The only page is `index.php`, so htmllint effectively checks nothing.
- The `DEP0187 fs.existsSync` deprecation warning comes from grunt-cli's `liftup` dependency, not from this project, and can be ignored.

Toolchain choices ported from `P:\+projects\extensions\common`. Do not "fix" these by reinstalling the old packages:
- `grunt-eslint` is gone. `Gruntfile.cjs` registers its own `eslint` multitask against the ESLint Node API, because grunt-eslint pins ESLint 9 and would put a second ESLint into `node_modules`. ESLint 10 itself comes in as a peer dependency of `@eslint/js`.
- `eslint-plugin-brace-rules` is gone. It is unmaintained and crashes on ESLint 10. Style rules now come from `@stylistic/eslint-plugin`.
- `package.json` sets `"type": "module"`, so the Gruntfile must stay `.cjs`. `eslint.config.mjs` gives `**/*.cjs` files Node globals and `commonjs` mode.

## Code style (enforced by eslint.config.mjs / .editorconfig)

- 4 spaces for indentation (2 for `.json`, `.yml` and `.md`, per `.editorconfig`), LF line endings, semicolons, `'use strict'` at the top of the file (script mode, not modules), ES2022.
- **Allman braces for function declarations**: the opening `{` goes on its own line. Other blocks keep `{` on the same line. ESLint **no longer enforces this** (see the TODO in `eslint.config.mjs`), so match the surrounding code by hand.
- `space-before-function-paren`: `function ()` for anonymous functions, `function name()` for named ones.
- `object-curly-spacing: never` (`{a: 1}`), `eqeqeq`, `curly`, and one variable per line in declarations.
- **JSDoc is required** on functions: a description, `@param` with types, and `@returns`. Enum-like constants use `@typedef` plus `@readonly @enum`.
- `no-console` only allows `log` and `error`. Existing code calls `window.console.error`.

## Architecture

- `src/index.php` is the whole UI. Its only PHP job is cache busting: it embeds `filemtime()` of `app.css` and `app.js` into the URLs (`/assets/js/app-YYYYmmddHHMMSS.js`). `src/.htaccess` rewrites `name-<digits>(.min)?.js|css` back to the real file. Keep this pattern when adding assets.
- `src/assets/js/app.js` holds all the logic in a single `DOMContentLoaded` closure:
  - **Screens**: the `data-active-screen` attribute on `<rc-app id="app">` (`main` / `connect` / `error` / `terminal`) controls which `<app-screen>` is visible through CSS. `screenShow()` redirects `main` to `connect` while there is no characteristic.
  - **Connection state**: the `data-status` attribute on `#app` (`disconnected` / `connecting` / `connected`) is shown or hidden through `[data-if-status]` spans.
  - **BLE** (service `BT_SERVICE` = `0xFFE0`, HM-10 style serial layout): `bluetoothConnect()` picks a device filtered by that service, then connects, gets the service and command characteristic `0xFFE1`, sets `bluetoothCharacteristic`, switches to `connected` and shows `main`. The 10 s `promiseTimeout()` only wraps `gatt.connect()`, so time spent in the device picker does not count.
    - `startNotifications()` on `0xFFE1` only runs when `characteristic.properties.notify` is set, because it throws otherwise. The current car firmware leaves NOTIFY off on `0xFFE1`, so the log shows `Characteristic does not support notifications` and the incoming `KEY=value;` path gets no data. This is expected.
    - Front distance: characteristic `0xFFE2` (READ + NOTIFY) carries a uint16 little-endian value in cm, notified about every 200 ms. `400` (`DISTANCE_MAX`) means nothing in range. `bluetoothDistanceStart()` subscribes after the main connection is up and shows the value in `#display-2`. It catches its own errors, so a car without `0xFFE2` still connects. Distance values are not written to the terminal log, which would get about 5 entries per second.
    - Car status: characteristic `0xFFE3` (READ + NOTIFY, 7 bytes) carries drive state, motor PWM, selected speed, flags (autopilot, front/rear light, horn) and battery mV / %. It is sent on every change and every 2 s. `statusParse()` reads it into `carStatus`, and `statusApply()` shows it. The car's status is the truth for display, because the car changes state on its own (safety stop, disconnect failsafe, autopilot). The direction display, the speed picker (except within `SPEED_SYNC_HOLD` after the user moves it) and the A/L/H pressed state (`aria-pressed`) all follow it. `cache.drive` / `cache.speed` still drive command de-duplication. Battery is shown in the status bar.
    - Firmware version: characteristic `0xFFE4` (READ, ASCII, for example `1.1.0`) is shown after the device name in the status bar. The firmware bumps it whenever the BLE protocol changes.
    - The version, status and distance characteristics are read one after another after the main connection, and each one is optional for older firmware.
    - Reconnect: the `gattserverdisconnected` listener is added only when a device is first picked. An unexpected disconnect clears both characteristics and calls `bluetoothConnect()` again with the same device. A manual disconnect calls `reset()`.
    - `bluetoothSendCommand()` drops a command when there is no characteristic or one is already in flight (`bluetoothBusy`). The queue is still a TODO.
  - **Firmware**: the car side lives in `P:\+projects\arduino\car-black` (ESP32-C6). Its `bluetoothMapCommands()` in `command.ino` is the source of truth for command letters, and its `const.h` holds the UUIDs. The firmware is not part of this repo.
  - **Wire protocol** (ASCII): the app sends single-character commands, or `cmd=<bytes>;` when there is a payload (for example the RGB color picker `4=` followed by 3 raw bytes). Drive states map to letters in `mapCommands` in `init()` (S F I R J B H L G), and these match the firmware. Speed is `1`–`9`, and `0` means 10. A/L/H are toggles: autopilot sends `X`/`x` and lights `W`/`w`, choosing on or off from the car status (or `cache.autopilot` / `cache.lights` without status). The horn sends `V` on press and `v` on release. The firmware tone has a fixed length, and releasing early stops it. Incoming data on `0xFFE1` is logged and parsed as `KEY=value;` pairs into `displayFields`, which is currently empty, so no keys fill a display. The display row is direction, `#display-1` (motor speed from the car status: `driveSpeed` as a percentage of `MOTOR_PWM_MAX` = 250) and `#display-2` (front distance).
  - **Direction**: four pointer-event buttons set `directionPressed`, and `directionCalculator()` combines them into a `DRIVE_STATE` (for example `F` + `R` gives `FR`).
- `src/assets/js/service-worker.js` uses a network-first strategy with a cache fallback. `.htaccess` sets `Service-Worker-Allowed: /` so the worker can control the whole site.
- `src/assets/vendor/` contains third-party libraries (gridstack, nipplejs). They are currently **unused**: their script tags and the joystick and grid code are commented out. Do not edit them.

## Current WIP state (be aware before "fixing")

- `init()` contains temporary test code that forces the `main` screen and logs `TESTING STUFF`. There are also debug `console.log` calls in the direction handlers and `bluetoothSendCommand`.
- `bluetoothConnect()` still contains the old commented-out connect code after its `catch`. It is dead and does nothing.
- Known issues, not fixed yet:
  - Clicking the color picker (`command-4`) sends `4` through the generic `#commands` click handler, which the firmware reads as speed 40%. The firmware has no RGB command (`HAS_LIGHT_RGB` is off).
- `src/assets/js/app.v1.js.bck` is an untracked backup of a 2022 version, kept for reference. It is **not** the last working version: its command letters (`A`–`I`) are for older firmware. Do not use it to restore or "fix" current behavior.
