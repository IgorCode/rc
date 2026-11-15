/**
 * Shared constants and enums.
 * NOTE: Modules have no side effects on import (no DOM access), so they can be imported in Node tests.
 */

/** @typedef {'main' | 'error' | 'connect' | 'terminal'} ScreenType */
/** @typedef {'disconnected' | 'connecting' | 'connected'} ConnectionStateType */
/** @typedef {'receive' | 'send' | 'standard'} LogType */
/** @typedef {'S' | 'F' | 'FR' | 'R' | 'BR' | 'B' | 'BL' | 'L' | 'FL'} DriveStateType */

/**
 * Available screens
 * @readonly
 * @enum {ScreenType}
 */
export const SCREEN = Object.freeze({
    MAIN: 'main',
    ERROR: 'error',
    CONNECT: 'connect',
    TERMINAL: 'terminal',
});

/**
 * Available connection states
 * @readonly
 * @enum {ConnectionStateType}
 */
export const CONNECTION_STATE = Object.freeze({
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
});

/**
 * Available log types
 * @readonly
 * @enum {LogType}
 */
export const LOG_TYPE = Object.freeze({
    RECEIVE: 'receive',
    SEND: 'send',
    STANDARD: 'standard',
});

/**
 * Available drive states
 * @readonly
 * @enum {DriveStateType}
 */
export const DRIVE_STATE = Object.freeze({
    STOP: 'S',
    FORWARD: 'F',
    FORWARD_RIGHT: 'FR',
    RIGHT: 'R',
    BACKWARD_RIGHT: 'BR',
    BACKWARD: 'B',
    BACKWARD_LEFT: 'BL',
    LEFT: 'L',
    FORWARD_LEFT: 'FL',
});

/**
 * Legacy drive command letters, by drive state. The command queue merges these until a manifest
 * gives the car's own letters; the controls always send the letters from the manifest.
 * @readonly
 * @enum {string}
 */
export const COMMAND = Object.freeze({
    [DRIVE_STATE.STOP]:           'S',
    [DRIVE_STATE.FORWARD]:        'F',
    [DRIVE_STATE.FORWARD_RIGHT]:  'I',
    [DRIVE_STATE.RIGHT]:          'R',
    [DRIVE_STATE.BACKWARD_RIGHT]: 'J',
    [DRIVE_STATE.BACKWARD]:       'B',
    [DRIVE_STATE.BACKWARD_LEFT]:  'H',
    [DRIVE_STATE.LEFT]:           'L',
    [DRIVE_STATE.FORWARD_LEFT]:   'G',
});

export const
    BT_CONNECTION_TIMEOUT = 10000,
    BT_SERVICE = 0xFFE0,
    BT_CHARACTERISTIC_COMMAND = 0xFFE1,
    BT_CHARACTERISTIC_DISTANCE = 0xFFE2,
    BT_CHARACTERISTIC_STATUS = 0xFFE3,
    BT_CHARACTERISTIC_VERSION = 0xFFE4,
    // Car manifest (car-black#31): 8-byte header + JSON, read in pages (write a u16 LE offset, then read)
    BT_CHARACTERISTIC_MANIFEST = 0xFFE5,
    MANIFEST_HEADER_LENGTH = 8,
    MANIFEST_SCHEMA_VERSION = 1,
    // Largest grid the RC renders, in rows and in columns
    MANIFEST_GRID_MAX = 12,
    // Columns of the automatic layout used when the grid is invalid
    MANIFEST_AUTO_COLUMNS = 6,
    // localStorage key of the downloaded manifests, by CRC, and how many are kept
    MANIFEST_CACHE_KEY = 'rc-manifest-cache',
    MANIFEST_CACHE_SIZE = 5,
    // Do not move the speed picker from the car status this long after the user moved it (ms)
    SPEED_SYNC_HOLD = 1000,
    // Car watchdog (car-black#32): the car stops a manual drive this long after the last drive command,
    // and a hold button (horn) this long after the last press command (ms). Defaults until the
    // manifest's car.watchdog gives the car's own timeouts.
    WATCHDOG_DRIVE_TIMEOUT = 500,
    WATCHDOG_HORN_TIMEOUT = 1000,
    // While a direction or the horn is held, its command is resent this many times per watchdog timeout
    KEEPALIVE_RESENDS = 3,
    // Joystick, used by the commented-out joystick code in controls.js
    JOYSTICK_THRESHOLD = 0.3,
    SPEED_FROM_JOYSTICK = false,
    SPEED_RANGE_MIN = 1,
    SPEED_RANGE_MAX = 10,
    SPEED_RANGE_CORRECTION = (SPEED_RANGE_MAX - SPEED_RANGE_MIN) / (10 - (JOYSTICK_THRESHOLD * 10));
