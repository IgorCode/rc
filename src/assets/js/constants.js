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
 * Flag bits in the car status (byte 3 of the status characteristic)
 * @readonly
 * @enum {number}
 */
export const STATUS_FLAG = Object.freeze({
    AUTOPILOT: 0x01,
    LIGHT_FRONT: 0x02,
    LIGHT_REAR: 0x04,
    HORN: 0x08,
    // Forward safety stop for manual driving (car-black#28), on after boot
    OBSTACLE_STOP: 0x10,
    // Full speed, no turn/reverse caps, autopilot does not slow down near obstacles (car-black#25).
    // Stays on after a disconnect. The cruise speed byte still holds the selected speed.
    MAD_MAX: 0x20,
});

/**
 * Command letters sent to the car, by drive state or action.
 * Must match bluetoothMapCommands() in the car firmware (command.ino).
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
    'autopilot-on':               'X',
    'autopilot-off':              'x',
    'lights-on':                  'W',
    'lights-off':                 'w',
    'horn-on':                    'V',
    'horn-off':                   'v',
    'obstacle-stop-on':           'C',
    'obstacle-stop-off':          'c',
    'mad-max-on':                 'M',
    'mad-max-off':                'm',
    'command-4':                  '4',
});

export const
    BT_CONNECTION_TIMEOUT = 10000,
    BT_SERVICE = 0xFFE0,
    BT_CHARACTERISTIC_COMMAND = 0xFFE1,
    BT_CHARACTERISTIC_DISTANCE = 0xFFE2,
    BT_CHARACTERISTIC_STATUS = 0xFFE3,
    BT_CHARACTERISTIC_VERSION = 0xFFE4,
    DISTANCE_MAX = 400,
    STATUS_LENGTH = 7,
    // Status drive state values (index) as DRIVE_STATE
    STATUS_DRIVE_STATES = Object.freeze([
        DRIVE_STATE.STOP,
        DRIVE_STATE.FORWARD,
        DRIVE_STATE.BACKWARD,
        DRIVE_STATE.LEFT,
        DRIVE_STATE.RIGHT,
        DRIVE_STATE.FORWARD_LEFT,
        DRIVE_STATE.FORWARD_RIGHT,
        DRIVE_STATE.BACKWARD_LEFT,
        DRIVE_STATE.BACKWARD_RIGHT,
    ]),
    // Motor PWM of the speed levels 1-10, as reported in the status cruise speed
    CRUISE_SPEEDS = Object.freeze([60, 90, 110, 130, 150, 170, 190, 210, 230, 250]),
    // Highest motor PWM the firmware uses, shown as 100%
    MOTOR_PWM_MAX = 250,
    // Do not move the speed picker from the car status this long after the user moved it (ms)
    SPEED_SYNC_HOLD = 1000,
    // Car watchdog (car-black#32): the car stops a manual drive this long after the last drive command,
    // and the horn this long after the last V (ms)
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
