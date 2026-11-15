/* globals nipplejs:false */
/**
 * The controller: builds the main screen from the car's manifest (grid + cells), binds the
 * controls and shows the status values in them. Keeps what the app sent (drive state, speed,
 * toggle state) and what the car reports (`values`), because the car can change state on its own.
 * Nothing touches the DOM on import: controlsInit() and controlsRender() do.
 */
import {DRIVE_STATE, KEEPALIVE_RESENDS, SPEED_SYNC_HOLD} from './constants.js';
import {bluetoothSendCommand} from './bluetooth.js';
import {driveCommand, manifestDpads, speedIndexFromPwm, speedLevels} from './manifest.js';
import {formatSpeed, formatStatusValue} from './ui.js';

/**
 * A d-pad: one or more dpad cells with the same id, sharing one drive state
 * @typedef {object} Dpad
 * @property {string} id
 * @property {{[key: string]: string}} cmd Drive state -> command, merged from its cells
 * @property {{forward: boolean, backward: boolean, left: boolean, right: boolean}} pressed
 * @property {DriveStateType} drive Last drive state sent
 * @property {{start: function(): void, stop: function(): void, isRunning: function(): boolean}} keepalive
 */

/**
 * A hold button (horn): sends `press` while held, repeated as keepalive, and `release` once
 * @typedef {object} Hold
 * @property {ManifestCell} cell
 * @property {boolean} held
 * @property {{start: function(): void, stop: function(): void, isRunning: function(): boolean}} keepalive
 */

/**
 * The speed picker
 * @typedef {object} Speed
 * @property {ManifestCell} cell
 * @property {Array<{key: string, pwm: number}>} levels Slowest first
 * @property {number} index Selected level, index into levels
 * @property {string} sentKey Key of the level the car has, so it is not sent again
 * @property {number} inputAt When the user last moved the picker (ms)
 * @property {HTMLInputElement} input
 * @property {HTMLElement} display
 */

/**
 * A rendered cell
 * @typedef {object} RenderedCell
 * @property {ManifestCell} cell
 * @property {HTMLElement} el
 * @property {function(): void} [update] Shows the current values
 */

// Directions of the d-pad buttons, by axis
const DPAD_BUTTONS = Object.freeze({
    v: ['forward', 'backward'],
    h: ['left', 'right'],
    both: ['forward', 'left', 'right', 'backward'],
});

// Last toggle state the app sent, by cell key. Only used when the car does not report the status.
const sent = {};

let container = null,
    inputCustomCommand = null,
    // ctrlJoystick = null,
    /** @type {Manifest|null} */
    manifest = null,
    /** @type {{[key: string]: number|boolean|string}} Status values by id, empty when unknown */
    values = {},
    /** @type {RenderedCell[]} */
    rendered = [],
    /** @type {Map<string, Dpad>} By id */
    dpads = new Map(),
    /** @type {Hold[]} */
    holds = [],
    /** @type {Speed|null} */
    speed = null;

/**
 * Returns a function, that, as long as it continues to be invoked, will not
 * be triggered. The function will be called after it stops being called for
 * N milliseconds. If `immediate` is passed, trigger the function on the
 * leading edge, instead of the trailing.
 * @param {CallableFunction} func
 * @param {number} wait
 * @param {boolean} immediate
 * @returns {CallableFunction}
 */
function debounce(func, wait, immediate)
{
    let timeout;
    return function () {
        const context = this,
            args = arguments;
        const later = function () {
            timeout = null;
            if (!immediate) {
                func.apply(context, args);
            }
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) {
            func.apply(context, args);
        }
    };
}

/**
 * Resend interval that keeps a held command alive within a watchdog timeout
 * @param {number} timeout Watchdog timeout (ms)
 * @returns {number} ms
 */
export function keepalivePeriod(timeout)
{
    return Math.floor(timeout / KEEPALIVE_RESENDS);
}

/**
 * Keepalive for a held command: calls `send` every `period` ms between start() and stop().
 * The car firmware (car-black#32) stops driving and the horn when their command is not repeated.
 * @param {function(): void} send
 * @param {number} period ms
 * @returns {{start: function(): void, stop: function(): void, isRunning: function(): boolean}}
 */
export function keepaliveCreate(send, period)
{
    let timer = null;

    return {
        start() {
            if (timer === null) {
                timer = setInterval(send, period);
            }
        },
        stop() {
            if (timer !== null) {
                clearInterval(timer);
                timer = null;
            }
        },
        isRunning() {
            return timer !== null;
        },
    };
}

/**
 * Combine the pressed direction buttons into a drive state, for example forward + right gives FR.
 * Forward wins over backward and left wins over right.
 * @param {{forward: boolean, backward: boolean, left: boolean, right: boolean}} pressed
 * @returns {DriveStateType}
 */
export function directionFromPressed(pressed)
{
    // Start empty, not with STOP, otherwise left alone would become 'SL', which has no command
    let direction = '';
    if (pressed.forward) {
        direction = DRIVE_STATE.FORWARD;
    } else if (pressed.backward) {
        direction = DRIVE_STATE.BACKWARD;
    }

    if (pressed.left) {
        direction += DRIVE_STATE.LEFT;
    } else if (pressed.right) {
        direction += DRIVE_STATE.RIGHT;
    }

    if (direction === '') {
        direction = DRIVE_STATE.STOP;
    }

    return direction;
}

/**
 * Bind press and release handlers to a hold button. The pointer is captured, so a finger or mouse
 * that slides off the button still releases it. The release handler can run more than once for
 * one press (pointerup, then lostpointercapture), so it must not depend on running once.
 * @param {HTMLElement} el
 * @param {function(PointerEvent): void} handleStart
 * @param {function(PointerEvent): void} handleEnd
 * @returns {void}
 */
function bindEvt(el, handleStart, handleEnd)
{
    el.addEventListener('pointerdown', (e) => {
        try {
            el.setPointerCapture(e.pointerId);
        } catch {
            // The pointer is already gone, its pointerup / pointercancel still releases the button
        }
        handleStart(e);
    }, false);
    el.addEventListener('pointerup', handleEnd, false);
    el.addEventListener('pointercancel', handleEnd, false);
    el.addEventListener('lostpointercapture', handleEnd, false);
}

/**
 * Send a command to the car
 * @param {string} cmd
 * @param {number|string|object} [data] Payload
 * @param {boolean} [log] Write it to the terminal log, false for keepalive repeats
 * @returns {void}
 */
function send(cmd, data, log = true)
{
    bluetoothSendCommand(cmd, data, log);
}

/**
 * Status descriptor by id, a bare one when the manifest does not list it
 * @param {string} id
 * @returns {StatusDescriptor}
 */
function statusDescriptor(id)
{
    return (manifest && manifest.status.find(descriptor => descriptor.id === id)) || {id};
}

/**
 * Whether a toggle is on: its status when the car reports it, otherwise the last state the app sent
 * @param {ManifestCell} cell
 * @returns {boolean}
 */
function toggleIsOn(cell)
{
    if (cell.status && typeof values[cell.status] === 'boolean') {
        return values[cell.status];
    }
    return sent[cell.key] ?? false;
}

/**
 * Whether the toggle with a well-known id is on, false when the car has no such toggle
 * @param {string} id
 * @returns {boolean}
 */
function toggleIsOnById(id)
{
    const item = rendered.find(entry => entry.cell.type === 'toggle' && entry.cell.id === id);
    return item ? toggleIsOn(item.cell) : false;
}

/**
 * Set the pressed state of a button, null means unknown
 * @param {HTMLElement} el
 * @param {boolean|null} pressed
 * @returns {void}
 */
function setPressed(el, pressed)
{
    if (pressed === null) {
        el.removeAttribute('aria-pressed');
    } else {
        el.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }
}

/**
 * Show the cell's label on a button: its icon from the app sprite when it names one, otherwise the label
 * @param {HTMLElement} el
 * @param {ManifestCell} cell
 * @returns {void}
 */
function labelSet(el, cell)
{
    // Only plain names, the icon goes into a URL
    if (typeof cell.icon === 'string' && /^[a-z0-9-]+$/i.test(cell.icon)) {
        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        const use = document.createElementNS(svgNs, 'use');
        svg.setAttribute('class', 'icon');
        use.setAttribute('href', '/assets/img/app-icons.svg?#' + cell.icon);
        svg.append(use);
        el.append(svg);
    } else {
        el.textContent = cell.label ?? cell.key;
    }
}

/**
 * Create a button for a cell, with its title and aria label
 * @param {ManifestCell} cell
 * @returns {HTMLButtonElement}
 */
function buttonCreate(cell)
{
    const el = document.createElement('button');
    el.className = 'command';
    labelSet(el, cell);
    return el;
}

/**
 * Drive state of a d-pad from its pressed buttons, sent when it changed. The keepalive repeats it
 * while a direction is held.
 * @param {Dpad} dpad
 * @returns {void}
 */
function dpadUpdate(dpad)
{
    const state = directionFromPressed(dpad.pressed);
    if (dpad.drive !== state) {
        dpad.drive = state;
        const cmd = driveCommand(dpad.cmd, state);
        if (cmd !== null) {
            send(cmd);
        }
        displaysUpdate();
    }

    if (state === DRIVE_STATE.STOP) {
        dpad.keepalive.stop();
    } else {
        dpad.keepalive.start();
    }
}

/**
 * Create a d-pad, or return the one its id already has
 * @param {ManifestCell} cell
 * @returns {Dpad}
 */
function dpadGet(cell)
{
    const id = cell.id ?? cell.key;
    if (dpads.has(id)) {
        return dpads.get(id);
    }

    const dpad = {
        id,
        cmd: manifestDpads(manifest.cells).get(id).cmd,
        pressed: {forward: false, backward: false, left: false, right: false},
        drive: DRIVE_STATE.STOP,
        keepalive: null,
    };
    // Resend the held drive state. Autopilot is exempt from the watchdog and overrides manual drive anyway.
    // Repeats are not logged: they would add about 6 terminal entries per second.
    dpad.keepalive = keepaliveCreate(() => {
        const cmd = driveCommand(dpad.cmd, dpad.drive);
        if (dpad.drive !== DRIVE_STATE.STOP && cmd !== null && !toggleIsOnById('autopilot')) {
            send(cmd, undefined, false);
        }
    }, keepalivePeriod(manifest.car.watchdog.drive));
    dpads.set(id, dpad);
    return dpad;
}

/**
 * Direction pad cell: forward / back (axis v), left / right (h) or all four (both)
 * @param {ManifestCell} cell
 * @returns {RenderedCell}
 */
function dpadCreate(cell)
{
    const dpad = dpadGet(cell);
    const axis = cell.axis ?? 'both';
    const el = document.createElement('command-direction');
    el.className = 'command-direction command-direction-' + axis;

    DPAD_BUTTONS[axis].forEach((direction) => {
        const button = document.createElement('button');
        button.className = 'direction-' + direction;
        button.setAttribute('aria-label', 'Direction ' + direction);
        bindEvt(button, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dpad.pressed[direction] = true;
            dpadUpdate(dpad);
        }, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dpad.pressed[direction] = false;
            dpadUpdate(dpad);
        });
        el.append(button);
    });

    return {cell, el};
}

/**
 * Hold pressed: send `press` and keep it alive while held
 * @param {Hold} hold
 * @returns {void}
 */
function holdPress(hold)
{
    hold.held = true;
    send(hold.cell.press);
    hold.keepalive.start();
}

/**
 * Hold released: stop repeating `press` and send `release`, which stops it right away (the horn).
 * If it is lost, or there is none, the car's watchdog stops it after the last `press`.
 * Does nothing when not held, because several events can end one hold.
 * @param {Hold} hold
 * @returns {void}
 */
function holdRelease(hold)
{
    if (!hold.held) {
        return;
    }
    hold.held = false;
    hold.keepalive.stop();
    if (hold.cell.release) {
        send(hold.cell.release);
    }
}

/**
 * Hold button cell (horn). Its pressed state shows the status with the same id (the car is honking).
 * @param {ManifestCell} cell
 * @returns {RenderedCell}
 */
function holdCreate(cell)
{
    const el = buttonCreate(cell);
    const hold = {cell, held: false, keepalive: null};
    // A repeated press keeps the horn going, it does not restart it
    hold.keepalive = keepaliveCreate(() => {
        send(cell.press, undefined, false);
    }, keepalivePeriod(manifest.car.watchdog.horn));
    holds.push(hold);

    bindEvt(el, (e) => {
        e.preventDefault();
        e.stopPropagation();
        holdPress(hold);
    }, (e) => {
        e.preventDefault();
        e.stopPropagation();
        holdRelease(hold);
    });

    return {
        cell,
        el,
        update: () => setPressed(el, cell.id && typeof values[cell.id] === 'boolean' ? values[cell.id] : null),
    };
}

/**
 * Toggle cell: sends `on` or `off`, picked from the car status (or the last sent state without it)
 * @param {ManifestCell} cell
 * @returns {RenderedCell}
 */
function toggleCreate(cell)
{
    const el = buttonCreate(cell);
    el.addEventListener('click', () => {
        sent[cell.key] = !toggleIsOn(cell);
        send(sent[cell.key] ? cell.on : cell.off);
        valuesUpdate();
    });

    return {
        cell,
        el,
        update: () => setPressed(el, cell.status && typeof values[cell.status] === 'boolean' ? values[cell.status] : null),
    };
}

/**
 * Button cell: sends its command on click
 * @param {ManifestCell} cell
 * @returns {RenderedCell}
 */
function buttonCellCreate(cell)
{
    const el = buttonCreate(cell);
    el.addEventListener('click', () => send(cell.cmd));
    return {cell, el};
}

/**
 * Color cell: sends `cmd=` + the 3 RGB bytes
 * @param {ManifestCell} cell
 * @returns {RenderedCell}
 */
function colorCreate(cell)
{
    const el = document.createElement('input');
    el.type = 'color';
    el.className = 'command command-type-rgb';
    el.value = '#ffffff';
    el.addEventListener('input', () => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(el.value);
        if (result) {
            send(cell.cmd, [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]);
        }
    });
    return {cell, el};
}

/**
 * Text of a display cell. The direction falls back to the last sent drive state without a status.
 * @param {ManifestCell} cell
 * @returns {string}
 */
function displayText(cell)
{
    let value = values[cell.status];
    if (value === undefined && cell.status === 'drive') {
        const dpad = dpads.get('drive') ?? dpads.values().next().value;
        value = dpad ? dpad.drive : undefined;
    }
    return formatStatusValue(statusDescriptor(cell.status), value);
}

/**
 * Display cell: shows one status value
 * @param {ManifestCell} cell
 * @returns {RenderedCell}
 */
function displayCreate(cell)
{
    const el = document.createElement('div');
    el.className = 'display';
    return {cell, el, update: () => {
        el.textContent = displayText(cell);
    }};
}

/**
 * Show the selected speed, MAX while another control overrides it (Mad Max). The picker stays
 * usable: the car stores the selection and uses it once the override is off.
 * @param {boolean} overridden
 * @returns {void}
 */
function speedRender(overridden)
{
    speed.display.textContent = formatSpeed(speed.index + 1, overridden);
}

/**
 * Speed cell: the selected level and a slider over the levels of `keys`, slowest first
 * @param {ManifestCell} cell
 * @returns {RenderedCell}
 */
function speedCreate(cell)
{
    const el = document.createElement('div');
    el.className = 'command-speed-picker';

    const display = document.createElement('div');
    display.className = 'display';

    const levels = speedLevels(cell.keys);
    const ticks = document.createElement('datalist');
    ticks.id = 'speed-ticks-' + cell.key;
    levels.forEach((level, index) => {
        const option = document.createElement('option');
        option.value = String(index + 1);
        ticks.append(option);
    });

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'slider';
    input.min = '1';
    input.max = String(levels.length);
    input.step = '1';
    input.value = '1';
    input.setAttribute('list', ticks.id);
    input.setAttribute('aria-label', cell.title ?? 'Change speed');

    speed = {cell, levels, index: 0, sentKey: levels[0].key, inputAt: 0, input, display};

    // NOTE: Must not use immediate debounce because we would not be getting the last value
    const speedSend = debounce(() => {
        speed.index = parseInt(input.value, 10) - 1;
        const key = levels[speed.index].key;
        if (key !== speed.sentKey) {
            speed.sentKey = key;
            send(key);
        }
        valuesUpdate();
    }, 150, false);
    input.addEventListener('input', () => {
        speed.inputAt = Date.now();
        speedSend();
    });

    el.append(display, input, ticks);
    return {cell, el};
}

/**
 * Follow the car's selected speed (the cruise status), unless the user is moving the picker right now
 * @returns {void}
 */
function speedSync()
{
    if (!speed || typeof values.cruise !== 'number' || Date.now() - speed.inputAt < SPEED_SYNC_HOLD) {
        return;
    }
    const index = speedIndexFromPwm(speed.levels, values.cruise);
    if (index !== speed.index) {
        speed.index = index;
        speed.sentKey = speed.levels[index].key;
        speed.input.value = String(index + 1);
    }
}

/**
 * Create the element of a cell by its type
 * @param {ManifestCell} cell
 * @returns {RenderedCell}
 */
function cellCreate(cell)
{
    switch (cell.type) {
        case 'button':
            return buttonCellCreate(cell);
        case 'hold':
            return holdCreate(cell);
        case 'toggle':
            return toggleCreate(cell);
        case 'dpad':
            return dpadCreate(cell);
        case 'speed':
            return speedCreate(cell);
        case 'display':
            return displayCreate(cell);
        case 'color':
            return colorCreate(cell);
        default:
            // manifestValidate() drops unknown types
            throw new Error('Unknown cell type ' + cell.type);
    }
}

/**
 * Update the display cells
 * @returns {void}
 */
function displaysUpdate()
{
    rendered.filter(item => item.cell.type === 'display').forEach(item => item.update());
}

/**
 * Show the values in all cells: displays, pressed state, the selected speed and the overrides
 * (while an `overrides` toggle is on, its target is dimmed, and a speed target shows MAX)
 * @returns {void}
 */
function valuesUpdate()
{
    speedSync();

    const overridden = new Set(rendered
        .filter(item => item.cell.type === 'toggle' && item.cell.overrides && toggleIsOn(item.cell))
        .map(item => item.cell.overrides));

    rendered.forEach((item) => {
        if (item.update) {
            item.update();
        }
        item.el.classList.toggle('cell-overridden', item.cell.id !== undefined && overridden.has(item.cell.id));
    });

    if (speed) {
        speedRender(speed.cell.id !== undefined && overridden.has(speed.cell.id));
    }
}

/**
 * Store the car's status values and show them
 * @param {{[key: string]: number|boolean|string}|null} newValues By status id, null clears them
 *     (the cells fall back to the last sent commands)
 * @returns {void}
 */
export function controlsSetValues(newValues)
{
    values = newValues ?? {};
    valuesUpdate();
}

/**
 * Release all held controls (directions and holds): sends the stop and release commands
 * and stops their keepalive
 * @returns {void}
 */
export function controlsReleaseAll()
{
    dpads.forEach((dpad) => {
        dpad.pressed.forward = false;
        dpad.pressed.backward = false;
        dpad.pressed.left = false;
        dpad.pressed.right = false;
        dpadUpdate(dpad);
    });
    holds.forEach(holdRelease);
}

/**
 * Forget the toggle state that depends on the connection
 * @returns {void}
 */
export function controlsReset()
{
    // The firmware failsafe turns autopilot off when the controller disconnects
    rendered.filter(item => item.cell.type === 'toggle' && item.cell.id === 'autopilot').forEach((item) => {
        sent[item.cell.key] = false;
    });
    // A held button must be pressed again after a reconnect, so the car does not drive off on its own
    controlsReleaseAll();
}

/**
 * Build the controller from a manifest: a CSS grid of equal columns and rows that fills the screen,
 * each cell placed on its grid area. Only numbers go into the CSS, never the car's strings.
 * Replaces the previous controller, releasing what it held.
 * @param {Manifest} newManifest
 * @returns {void}
 */
export function controlsRender(newManifest)
{
    // A reconnect to the same car keeps the controller as it is (speed selection, sent toggles)
    if (manifest && JSON.stringify(newManifest) === JSON.stringify(manifest)) {
        return;
    }

    controlsReleaseAll();
    dpads.forEach(dpad => dpad.keepalive.stop());

    manifest = newManifest;
    rendered = [];
    dpads = new Map();
    holds = [];
    speed = null;
    Object.keys(sent).forEach(key => delete sent[key]);

    const layout = manifest.layout;
    container.replaceChildren();
    container.style.gridTemplateColumns = 'repeat(' + layout.columns + ', minmax(0, 1fr))';
    container.style.gridTemplateRows = 'repeat(' + layout.rows + ', minmax(0, 1fr))';

    layout.areas.forEach((area) => {
        const cell = manifest.cells[area.key];
        const item = cellCreate(cell);
        item.el.classList.add('cell', 'cell-' + cell.type);
        item.el.classList.toggle('cell-danger', cell.danger === true);
        // A speed cell taller than wide gets a vertical slider
        item.el.classList.toggle('command-speed-picker-vertical', cell.type === 'speed' && area.rowSpan > area.columnSpan);
        item.el.style.gridArea = area.row + ' / ' + area.column + ' / span ' + area.rowSpan + ' / span ' + area.columnSpan;
        if (cell.title) {
            item.el.title = cell.title;
            if (cell.type !== 'dpad' && cell.type !== 'speed') {
                item.el.setAttribute('aria-label', cell.title);
            }
        }
        rendered.push(item);
        container.append(item.el);
    });

    valuesUpdate();
}

/**
 * Find the elements and bind what does not depend on the manifest
 * @returns {void}
 */
export function controlsInit()
{
    container = document.getElementById('controller');
    inputCustomCommand = document.getElementById('app-custom-command');
    // ctrlJoystick = document.getElementById('joystick');

    /**
     * Send a custom message
     * @returns {void}
     */
    document.getElementById('app-custom-command-send').addEventListener('click', async () => {
        await bluetoothSendCommand(inputCustomCommand.value);
    });

/*    ctrlDirectionLeft.addEventListener('click', (event) => {
console.log(event.buttons);
        // var newDriveState = '';
        // switch (evt.type) {
        //     case 'dir:up':
        //         newDriveState = DRIVE_STATE.FORWARD;
        //         break;
        //     case 'dir:down':
        //         newDriveState = DRIVE_STATE.BACKWARD;
        //         break;
        //     case 'dir:left':
        //         newDriveState = DRIVE_STATE.LEFT;
        //         break;
        //     case 'dir:right':
        //         newDriveState = DRIVE_STATE.RIGHT;
        //         break;
        //     default:
        //         return;
        // }

        // setDriveState(newDriveState);
    });
*/

    /**
     * Release everything when the app loses focus or is hidden: the release events may never
     * arrive, the keepalive would keep the car driving, and hidden tabs throttle the timers.
     * @returns {void}
     */
    window.addEventListener('blur', controlsReleaseAll);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            controlsReleaseAll();
        }
    });

    /*
    // Activate Joystick controller
    var joystickSize = Math.min(240, ctrlJoystick.clientWidth - 10, ctrlJoystick.clientHeight - 10),
        joystick = nipplejs.create({
            zone: ctrlJoystick,
            mode: 'static',
            threshold: JOYSTICK_THRESHOLD,
            size: joystickSize,
            position: {left: '50%', top: '50%'},
            color: '#175676',
            restOpacity: 0.8,
        });

    // Joystick graphics
    (function () {
        var arrows = document.getElementById('arrows'),
            directionMarks = document.getElementById('direction-marks'),
            directionCenter = document.getElementById('direction-center');
        arrows.style.width = arrows.style.height = joystickSize + 'px';
        directionMarks.style.width = directionMarks.style.height = (joystickSize + 10) + 'px';
        directionCenter.style.width = directionCenter.style.height = (joystickSize / 2 + 4) + 'px';
    })();

    joystick
        .on('move', (evt, data) => {
            if (data.force < JOYSTICK_THRESHOLD) {
                setDriveState(DRIVE_STATE.STOP);
            }

            // if (SPEED_FROM_JOYSTICK) {
            //     var command = DRIVE_STATE.STOP;
            //     if (data.force >= JOYSTICK_THRESHOLD) {
            //         // Range correction because of the joystick threshold
            //         var force = Math.min(1, data.force);
            //         command = Math.round((force - JOYSTICK_THRESHOLD) * 10 * SPEED_RANGE_CORRECTION + SPEED_RANGE_MIN);
            //     }

            //     if (cache.speed !== command) {
            //         cache.speed = command;
            //         bluetoothSendCommand(command);

            //         textSpeedUpdate();
            //     }
            // // } else {
            // //     if (data.force < JOYSTICK_THRESHOLD) {
            // //         if (cache.speed !== command) {
            // //             cache.speed = command;
            // //             bluetoothSendCommand(command);

            // //             textSpeedUpdate();
            // //         }
            // //     }
            // }
        })
        .on('dir:up plain:up dir:left plain:left dir:down plain:down dir:right plain:right', (evt, data) => {
            // console.log(evt.type, data);

            var newDriveState = '';
            switch (evt.type) {
                case 'dir:up':
                    newDriveState = DRIVE_STATE.FORWARD;
                    break;
                case 'dir:down':
                    newDriveState = DRIVE_STATE.BACKWARD;
                    break;
                case 'dir:left':
                    newDriveState = DRIVE_STATE.LEFT;
                    break;
                case 'dir:right':
                    newDriveState = DRIVE_STATE.RIGHT;
                    break;
                default:
                    return;
            }

            setDriveState(newDriveState);
        })
        .on('end', (evt, data) => {
            setDriveState(DRIVE_STATE.STOP);
        })
        // .on('dir plain', function (evt, data, t1, t2) {
        //     console.log(t1, t2, evt, data);
        // })
        ;
    */
}
