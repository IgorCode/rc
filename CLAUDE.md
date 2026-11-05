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

There is no test suite. To verify a change, load the page in Chrome with a BLE device, or use the in-app terminal screen to see sent and received traffic.

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
  - **BLE**: the app requests a device with service `0xFFE0` and writes to characteristic `0xFFE1` (HM-10 style serial module). `bluetoothSendCommand()` drops a command when one is already in flight (`bluetoothBusy`). The queue is still a TODO.
  - **Wire protocol** (ASCII): the app sends single-character commands, or `cmd=<bytes>;` when there is a payload (for example the RGB color picker `4=` followed by 3 raw bytes). Drive states map to letters in `mapCommands` in `init()` (S F I R J B H L G). Speed is `1`–`9`, and `0` means 10. Incoming data is parsed as `KEY=value;` pairs, and keys `A` / `B` / `C` fill the `#display-1..3` fields.
  - **Direction**: four pointer-event buttons set `directionPressed`, and `directionCalculator()` combines them into a `DRIVE_STATE` (for example `F` + `R` gives `FR`).
- `src/assets/js/service-worker.js` uses a network-first strategy with a cache fallback. `.htaccess` sets `Service-Worker-Allowed: /` so the worker can control the whole site.
- `src/assets/vendor/` contains third-party libraries (gridstack, nipplejs). They are currently **unused**: their script tags and the joystick and grid code are commented out. Do not edit them.

## Current WIP state (be aware before "fixing")

- `bluetoothConnect()` stops after `gatt.connect()`. Getting the service and characteristic (and starting notifications) only exists in the commented-out block below it, so `bluetoothCharacteristic` never gets set in the current code.
- `init()` contains temporary test code that forces the `main` screen and logs `TESTING STUFF`. There are also debug `console.log` calls in the direction handlers and `bluetoothSendCommand`.
- `src/assets/js/app.v1.js.bck` is an untracked backup of an older version, kept for reference.
