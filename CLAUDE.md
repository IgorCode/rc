# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Modular RC (https://rc.igorware.com/): a Bluetooth remote-controller PWA for RC cars. It is a single page that talks to the car over the **Web Bluetooth API** (Chromium browsers, Bluetooth Low Energy only, no Classic Bluetooth). There is no framework and no bundler. The browser loads `src/` as is, as native ES modules, served by Apache + PHP.

## Commands

- `npm test` runs the unit tests (`node --test "tests/**/*.test.js"`, Node's built-in runner, no extra dependencies)
- `node --test tests/status.test.js` runs one test file

Run Grunt through npx:

- `npx grunt` runs the default task: `jsonlint`, `eslint`, `htmllint`, `uglify`, `notify:done`
- `npx grunt eslint` lints `Gruntfile.cjs`, `src/assets/js/**/*.js` and `tests/**/*.js`
- `npx grunt jsonlint eslint` runs the lint checks only, without minifying
- `npx eslint src/assets/js/ui.js` lints a single file
- `npx grunt min` runs uglify only
- `npx grunt watch` re-lints `Gruntfile.cjs` and `src/assets/js/**/*.js` when they change

GitHub Actions (`.github/workflows/test.yml`) runs `npm ci` and `npm test` on Node 24 for pushes to `main` and for pull requests. CI does not lint.

Tests only cover the DOM-free logic (status / distance / version parsing, direction combining, command encoding, display formatting). Anything touching Bluetooth or the page still needs Chrome with the car, or the in-app terminal screen to see sent and received traffic. The connect flow logs each step (`Connected to GATT server`, `Found primary service`, `Found characteristic`, ...), so the last line shows where a failed connection stopped.

The app modules do not lint clean: ESLint reports 9 errors that were already there before the module split, all from the WIP code listed at the bottom (unindented temporary/debug lines, the unused `commandQueue`, the `nipplejs` global for the commented-out joystick). Compare error counts before and after a change instead of expecting a clean run. `tests/` lints clean.

Gotchas in the Grunt config:
- `uglify` minifies every `.js` in `src/assets/js` (except `*.min.js`), writing `*.min.js` next to them. A minified build is planned for later: `index.php` still loads the unminified files, and the minified modules import their siblings by unminified name, so switching needs the import map to point at the `.min.js` files. `eslint` skips `*.min.js`.
- `htmllint` only targets `**/*.html`. The only page is `index.php`, so htmllint effectively checks nothing.
- The `DEP0187 fs.existsSync` deprecation warning comes from grunt-cli's `liftup` dependency, not from this project, and can be ignored.

Toolchain choices ported from `P:\+projects\extensions\common`. Do not "fix" these by reinstalling the old packages:
- `grunt-eslint` is gone. `Gruntfile.cjs` registers its own `eslint` multitask against the ESLint Node API, because grunt-eslint pins ESLint 9 and would put a second ESLint into `node_modules`. ESLint 10 itself comes in as a peer dependency of `@eslint/js`.
- `eslint-plugin-brace-rules` is gone. It is unmaintained and crashes on ESLint 10. Style rules now come from `@stylistic/eslint-plugin`.
- `package.json` sets `"type": "module"`, so the Gruntfile must stay `.cjs`. `eslint.config.mjs` gives `**/*.cjs` files Node globals and `commonjs` mode, the app files in `src/assets/js` `sourceType: "module"` (except `service-worker.js`, a classic script), and `tests/` Node globals.

## Code style (enforced by eslint.config.mjs / .editorconfig)

- 4 spaces for indentation (2 for `.json`, `.yml` and `.md`, per `.editorconfig`), LF line endings, semicolons, ES2022. App files are ES modules, so no `'use strict'` (ESLint's `strict` rule rejects it in modules). `service-worker.js` and `Gruntfile.cjs` are scripts and keep `'use strict'`.
- **Allman braces for function declarations**: the opening `{` goes on its own line. Other blocks keep `{` on the same line. ESLint **no longer enforces this** (see the TODO in `eslint.config.mjs`), so match the surrounding code by hand.
- `space-before-function-paren`: `function ()` for anonymous functions, `function name()` for named ones.
- `object-curly-spacing: never` (`{a: 1}`), `eqeqeq`, `curly`, and one variable per line in declarations.
- **JSDoc is required** on functions: a description, `@param` with types, and `@returns`. Enum-like constants use `@typedef` plus `@readonly @enum`.
- `no-console` only allows `log` and `error`. Existing code calls `window.console.error`.

## Architecture

- `src/index.php` is the whole UI. Its only PHP job is cache busting: it embeds `filemtime()` into asset URLs (`/assets/css/app-YYYYmmddHHMMSS.css`), and `src/.htaccess` rewrites `name-<digits>(.min)?.js|css` back to the real file (JS is cached for a year). For the modules it prints an **import map** that sends every `assets/js/*.js` (except `service-worker.js` and `*.min.js`) from its plain URL to its timestamped URL, then loads `app.js` with `<script type="module">`. Modules import each other by plain relative path (`./bluetooth.js`) and the import map does the busting, so a new module needs no `index.php` change.
- `src/assets/js/` modules. **No module touches the DOM on import**: element lookups and event binding happen in init functions that `app.js` calls, so every module except `app.js` can be imported in Node tests. Keep it that way.
  - `constants.js`: enums (`SCREEN`, `CONNECTION_STATE`, `LOG_TYPE`, `DRIVE_STATE`, `STATUS_FLAG`), the `COMMAND` letter map, UUIDs and numeric constants, typedefs.
  - `log.js`: the terminal log screen (`addLogEntry`) and `errorLogger`.
  - `status.js`: DOM-free parsing of what the car sends (`statusParse`, `cruiseSpeedToLevel`, `distanceParse`, `versionParse`) and the `CarStatus` typedef.
  - `bluetooth.js`: connect / disconnect / reconnect, `bluetoothSendCommand()`, the four characteristics. It never touches the page: it fires CustomEvents on `bluetoothEvents` (`state`, `device`, `version`, `status`, `distance`, `receive`, `disconnected`, `error`, documented at the top of the file).
  - `ui.js`: screens, displays, status bar, toggle pressed state, the Mad Max speed override. It only shows what it is given. The `format*()` helpers are pure and tested.
  - `controls.js`: direction pad, speed picker, A/L/H/O/M toggles, color picker, terminal custom command. Owns what the app sent (`cache`) and what the car reports (`carStatus`). `directionFromPressed()` is pure and tested.
  - `app.js`: entry point. Wires `bluetoothEvents` to `ui` / `controls`, defines `reset()` and `errorHandler()`, runs the init functions and `init()`, registers the service worker.
  - **Screens**: the `data-active-screen` attribute on `<rc-app id="app">` (`main` / `connect` / `error` / `terminal`) controls which `<app-screen>` is visible through CSS. `screenShow()` redirects `main` to `connect` while `bluetoothIsConnected()` is false (no command characteristic).
  - **Connection state**: the `data-status` attribute on `#app` (`disconnected` / `connecting` / `connected`) is shown or hidden through `[data-if-status]` spans.
  - **BLE** (service `BT_SERVICE` = `0xFFE0`, HM-10 style serial layout): `bluetoothConnect()` picks a device filtered by that service, then connects, gets the service and command characteristic `0xFFE1`, sets `bluetoothCharacteristic` and fires `state: connected` (`app.js` then shows `main`). The 10 s `promiseTimeout()` only wraps `gatt.connect()`, so time spent in the device picker does not count.
    - `startNotifications()` on `0xFFE1` only runs when `characteristic.properties.notify` is set, because it throws otherwise. The current car firmware leaves NOTIFY off on `0xFFE1`, so the log shows `Characteristic does not support notifications` and the incoming `KEY=value;` path gets no data. This is expected.
    - Front distance: characteristic `0xFFE2` (READ + NOTIFY) carries a uint16 little-endian value in cm, notified about every 200 ms. `400` (`DISTANCE_MAX`) means nothing in range. `bluetoothDistanceStart()` subscribes after the main connection is up and the value is shown in `#display-2`. It catches its own errors, so a car without `0xFFE2` still connects. Distance values are not written to the terminal log, which would get about 5 entries per second.
    - Car status: characteristic `0xFFE3` (READ + NOTIFY, 7 bytes) carries drive state, motor PWM, selected speed, flags (bit0 autopilot, bit1/bit2 front/rear light, bit3 horn, bit4 obstacle stop since car-black#28, bit5 Mad Max since car-black#25) and battery mV / %. The selected speed byte stays the user's selection even while Mad Max makes the car drive at full speed; the motor PWM byte is the real speed. It is sent on every change and every 2 s. `statusParse()` reads it, and `statusApply()` in `app.js` passes it to `controlsSetStatus()` and `uiShowCarStatus()`. The car's status is the truth for display, because the car changes state on its own (safety stop, disconnect failsafe, autopilot). The direction display, the speed picker (except within `SPEED_SYNC_HOLD` after the user moves it) and the A/L/H pressed state (`aria-pressed`) all follow it. `cache.drive` / `cache.speed` still drive command de-duplication. Battery is shown in the status bar.
    - Firmware version: characteristic `0xFFE4` (READ, ASCII, for example `1.1.0`) is shown after the device name in the status bar. The firmware is supposed to bump it whenever the BLE protocol changes, but that does not always happen (car-black#28 added obstacle stop and still reports `1.1.0`). Features are not gated on it: only one car uses the app, and it runs the latest firmware.
    - The version, status and distance characteristics are read one after another after the main connection, and each one is optional for older firmware.
    - Reconnect: the `gattserverdisconnected` listener is added only when a device is first picked. An unexpected disconnect clears the characteristics, fires `disconnected` (the app clears the car data) and calls `bluetoothConnect()` again with the same device. After a manual disconnect the app calls `reset()`.
    - `bluetoothSendCommand()` drops a command when there is no characteristic or one is already in flight (`bluetoothBusy`). The queue is still a TODO.
  - **Firmware**: the car side lives in `P:\+projects\arduino\car-black` (ESP32-C6). Its `bluetoothMapCommands()` in `command.ino` is the source of truth for command letters, and its `const.h` holds the UUIDs. The firmware is not part of this repo.
  - **Wire protocol** (ASCII): the app sends single-character commands, or `cmd=<bytes>;` when there is a payload (`encodeCommand()`, for example the RGB color picker `4=` followed by 3 raw bytes). Drive states map to letters in `COMMAND` in `constants.js` (S F I R J B H L G), and these match the firmware. Speed is `1`–`9`, and `0` means 10. A/L/H are toggles: autopilot sends `X`/`x` and lights `W`/`w`, choosing on or off from the car status (or `cache.autopilot` / `cache.lights` without status). The horn sends `V` on press and `v` on release. The firmware tone has a fixed length, and releasing early stops it. **O** (`#command-obstacle-stop`) toggles the forward safety stop for manual driving with `C`/`c`, the same way as autopilot, following status bit 4 (on after a car boot; autopilot always keeps the stop). It needs the car firmware from car-black#28; older firmware ignores `C`/`c`. **M** (`#command-mad-max`) toggles Mad Max with `M`/`m` the same way, following status bit 5 (off after a car boot, but it stays on across a Bluetooth disconnect). Mad Max: full speed (250), no turn/reverse caps, autopilot does not slow down near obstacles, a honk when something comes within 40 cm; the 10 cm safety stop is unchanged. While bit 5 is set, `ui.js` shows `MAX` in the speed display and dims the slider (`.speed-overridden`); the slider still works, and the car uses the selection again once Mad Max is off. **Firmware without Mad Max treats `M` as an unknown command, which stops the car and turns autopilot off.** The button is not version-gated on purpose (one car, latest firmware). Incoming data on `0xFFE1` is logged and parsed as `KEY=value;` pairs into `displayFields` in `ui.js`, which is currently empty, so no keys fill a display. The display row is direction, `#display-1` (motor speed from the car status: `driveSpeed` as a percentage of `MOTOR_PWM_MAX` = 250) and `#display-2` (front distance).
  - **Direction**: four pointer-event buttons set `directionPressed`, and `directionFromPressed()` combines them into a `DRIVE_STATE` (for example `F` + `R` gives `FR`; forward wins over backward, left over right, nothing pressed gives `S`).
- `src/assets/js/service-worker.js` uses a network-first strategy with a cache fallback. `.htaccess` sets `Service-Worker-Allowed: /` so the worker can control the whole site.
- `src/assets/vendor/` contains third-party libraries (gridstack, nipplejs). They are currently **unused**: their script tags and the joystick and grid code are commented out. Do not edit them.

## Current WIP state (be aware before "fixing")

- **Keep the commented-out code** (old connect chain in `bluetooth.js`, joystick and direction-click blocks in `controls.js`, gridstack markup in `index.php`, the `screens` map in `ui.js`): parts of it will be needed later. Do not delete it as dead code.
- `init()` in `app.js` contains temporary test code that forces the `main` screen and logs `TESTING STUFF`. There are also debug `console.log` calls in the direction handlers (`controls.js`) and `bluetoothSendCommand` (`bluetooth.js`).
- Known issues, not fixed yet:
  - Clicking the color picker (`command-4`) sends `4` through the generic `#commands` click handler, which the firmware reads as speed 40%. The firmware has no RGB command (`HAS_LIGHT_RGB` is off).
  - A command sent while another write is in flight is dropped (see `bluetoothSendCommand()`), so a quick tap can lose the release `S` and leave the car turning: the firmware has no drive timeout.
  - While autopilot is on, the firmware overrides manual drive commands, and only `x` turns autopilot off.
