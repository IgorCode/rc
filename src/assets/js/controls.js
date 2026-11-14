/* globals nipplejs:false */
/**
 * Driving controls: direction pad, speed picker, autopilot / lights / horn toggles, color picker
 * and the terminal's custom command. Keeps what the app sent (`cache`) and what the car reports
 * (`carStatus`), because the car can change state on its own.
 */
import {COMMAND, DRIVE_STATE, SPEED_SYNC_HOLD, STATUS_FLAG} from './constants.js';
import {bluetoothSendCommand} from './bluetooth.js';
import {uiShowDirection, uiShowSpeed} from './ui.js';

const cache = {
    speed: 1,
    drive: DRIVE_STATE.STOP,
    // Last toggle state the app sent, only used when the car does not report its status
    autopilot: false,
    lights: false,
};

const directionPressed = {
    forward: false,
    right: false,
    backward: false,
    left: false
};

/** @type {CarStatus|null} */
let carStatus = null,
    speedInputAt = 0,
    inputCustomCommand = null,
    // ctrlJoystick = null,
    ctrlDirectionForward = null,
    ctrlDirectionBackward = null,
    ctrlDirectionLeft = null,
    ctrlDirectionRight = null,
    ctrlSpeedPicker = null,
    ctrlAutopilot = null,
    ctrlLights = null,
    ctrlHorn = null;

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
 * Show the direction: the car's status when known, otherwise the last sent drive state.
 * The car can change state on its own (safety stop, failsafe, autopilot), so its status wins.
 * @returns {void}
 */
function textDirectionUpdate()
{
    uiShowDirection(carStatus ? carStatus.drive : cache.drive);
}

/**
 * Update speed text
 * @returns {void}
 */
function textSpeedUpdate()
{
    uiShowSpeed(cache.speed);
}

/**
 * Store the car status, null clears it and falls back to the last sent commands
 * @param {CarStatus|null} status
 * @returns {void}
 */
export function controlsSetStatus(status)
{
    carStatus = status;

    // Follow the car's selected speed, unless the user is moving the picker right now
    if (status && status.speed !== cache.speed && Date.now() - speedInputAt >= SPEED_SYNC_HOLD) {
        cache.speed = status.speed;
        ctrlSpeedPicker.value = status.speed;
    }

    textDirectionUpdate();
    textSpeedUpdate();
}

/**
 * Forget the toggle state that depends on the connection
 * @returns {void}
 */
export function controlsReset()
{
    // The firmware failsafe turns autopilot off when the controller disconnects
    cache.autopilot = false;
}

/**
 * Speed update event 1-10 (10 is sent as 0)
 * NOTE: Must not use immediate debounce because we would not be getting the last value
 * @returns {void}
 */
const cmdUpdateSpeedDebounced = debounce(function () {
    let command = parseInt(ctrlSpeedPicker.value, 10);
    if (cache.speed !== command) {
        cache.speed = command;

        command = command.toString();
        if (command === '10') {
            command = '0';
        }
        bluetoothSendCommand(command);

        textSpeedUpdate();
    }
}, 150, false);

/**
 * Set drive state
 * @param {DriveStateType} state
 * @returns {void}
 */
function setDriveState(state)
{
    if (cache.drive !== state) {
        cache.drive = state;
        bluetoothSendCommand(COMMAND[state]);

        textDirectionUpdate();
    }
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
 * Send the drive state of the currently pressed direction buttons
 * @returns {DriveStateType}
 */
function directionCalculator()
{
    const direction = directionFromPressed(directionPressed);
    setDriveState(direction);
    return direction;
}

/**
 * Bind press and release handlers to a hold button
 * @param {HTMLElement} el
 * @param {function(PointerEvent): void} handleStart
 * @param {function(PointerEvent): void} handleEnd
 * @returns {void}
 */
function bindEvt(el, handleStart, handleEnd)
{
    el.addEventListener('pointerdown', handleStart, false);
    el.addEventListener('pointerup', handleEnd, false);
    el.addEventListener('pointercancel', handleEnd, false);
}

/**
 * Whether a car toggle is on: the car status when known, otherwise the last state the app sent
 * @param {number} flagMask STATUS_FLAG bits, any of them set counts as on
 * @param {'autopilot'|'lights'} cacheKey
 * @returns {boolean}
 */
function toggleIsOn(flagMask, cacheKey)
{
    if (carStatus) {
        return (carStatus.flags & flagMask) !== 0;
    }
    return cache[cacheKey];
}

/**
 * Find the elements and bind all controls
 * @returns {void}
 */
export function controlsInit()
{
    inputCustomCommand = document.getElementById('app-custom-command');
    // ctrlJoystick = document.getElementById('joystick');
    ctrlDirectionForward = document.getElementById('command-direction-forward');
    ctrlDirectionBackward = document.getElementById('command-direction-backward');
    ctrlDirectionLeft = document.getElementById('command-direction-left');
    ctrlDirectionRight = document.getElementById('command-direction-right');
    ctrlSpeedPicker = document.getElementById('speed-picker');
    ctrlAutopilot = document.getElementById('command-1');
    ctrlLights = document.getElementById('command-2');
    ctrlHorn = document.getElementById('command-3');

    ctrlSpeedPicker.addEventListener('input', () => {
        speedInputAt = Date.now();
    });
    ctrlSpeedPicker.addEventListener('input', cmdUpdateSpeedDebounced);

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

    bindEvt(ctrlDirectionLeft, function (e) {
        e.preventDefault();
        e.stopPropagation();
        directionPressed.left = true;
        // errorLogger('start');
        console.log('start', e, directionCalculator());
    }, function (e) {
        e.preventDefault();
        e.stopPropagation();
        directionPressed.left = false;
        // errorLogger('end');
        console.log('end', e, directionCalculator());
    });
    bindEvt(ctrlDirectionRight, function (e) {
        e.preventDefault();
        e.stopPropagation();
        directionPressed.right = true;
        // errorLogger('start');
        console.log('start', e, directionCalculator());
    }, function (e) {
        e.preventDefault();
        e.stopPropagation();
        directionPressed.right = false;
        // errorLogger('end');
        console.log('end', e, directionCalculator());
    });
    bindEvt(ctrlDirectionForward, function (e) {
        e.preventDefault();
        e.stopPropagation();
        directionPressed.forward = true;
        // errorLogger('start');
        console.log('start', e, directionCalculator());
    }, function (e) {
        e.preventDefault();
        e.stopPropagation();
        directionPressed.forward = false;
        // errorLogger('end');
        console.log('end', e, directionCalculator());
    });
    bindEvt(ctrlDirectionBackward, function (e) {
        e.preventDefault();
        e.stopPropagation();
        directionPressed.backward = true;
        // errorLogger('start');
        console.log('start', e, directionCalculator());
    }, function (e) {
        e.preventDefault();
        e.stopPropagation();
        directionPressed.backward = false;
        // errorLogger('end');
        console.log('end', e, directionCalculator());
    });


    /**
     * Handle commands
     * @returns {void}
     */
    document.getElementById('commands').addEventListener('click', (event) => {
        // Only buttons with a direct mapping, the toggles and direction buttons have their own handlers
        if (event.target.id in COMMAND) {
            bluetoothSendCommand(COMMAND[event.target.id]);
        }
    });

    /**
     * Autopilot toggle
     * @returns {void}
     */
    ctrlAutopilot.addEventListener('click', () => {
        cache.autopilot = !toggleIsOn(STATUS_FLAG.AUTOPILOT, 'autopilot');
        bluetoothSendCommand(COMMAND[cache.autopilot ? 'autopilot-on' : 'autopilot-off']);
    });

    /**
     * Lights toggle (front and rear switch together in the firmware)
     * @returns {void}
     */
    ctrlLights.addEventListener('click', () => {
        cache.lights = !toggleIsOn(STATUS_FLAG.LIGHT_FRONT | STATUS_FLAG.LIGHT_REAR, 'lights');
        bluetoothSendCommand(COMMAND[cache.lights ? 'lights-on' : 'lights-off']);
    });

    /**
     * Horn sounds while the button is held. The firmware tone has a fixed length,
     * releasing early stops it.
     * @returns {void}
     */
    bindEvt(ctrlHorn, function (e) {
        e.preventDefault();
        e.stopPropagation();
        bluetoothSendCommand(COMMAND['horn-on']);
    }, function (e) {
        e.preventDefault();
        e.stopPropagation();
        bluetoothSendCommand(COMMAND['horn-off']);
    });
    document.getElementById('command-4').addEventListener('input', (event) => {
        const hexColor = event.target.value;

        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexColor);
        if (result) {
            const data = [
                parseInt(result[1], 16),
                parseInt(result[2], 16),
                parseInt(result[3], 16)
            ];
            bluetoothSendCommand(COMMAND[event.target.id], data);
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
