/* globals nipplejs:false */
'use strict';

document.addEventListener('DOMContentLoaded', () => {

    /** @typedef {'main' | 'error' | 'connect' | 'terminal'} ScreenType */
    /** @typedef {'disconnected' | 'connecting' | 'connected'} ConnectionStateType */
    /** @typedef {'receive' | 'send' | 'standard'} LogType */
    /** @typedef {'S' | 'F' | 'FR' | 'R' | 'BR' | 'B' | 'BL' | 'L' | 'FL'} DriveStateType */

    /**
     * Available screens
     * @readonly
     * @enum {ScreenType}
     */
    const SCREEN = Object.freeze({
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
    const CONNECTION_STATE = Object.freeze({
        DISCONNECTED: 'disconnected',
        CONNECTING: 'connecting',
        CONNECTED: 'connected',
    });

    /**
     * Available log types
     * @readonly
     * @enum {LogType}
     */
    const LOG_TYPE = Object.freeze({
        RECEIVE: 'receive',
        SEND: 'send',
        STANDARD: 'standard',
    });

    /**
     * Available drive states
     * @readonly
     * @enum {DriveStateType}
     */
    const DRIVE_STATE = Object.freeze({
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
    const STATUS_FLAG = Object.freeze({
        AUTOPILOT: 0x01,
        LIGHT_FRONT: 0x02,
        LIGHT_REAR: 0x04,
        HORN: 0x08,
    });

    /**
     * Car status as reported by the status characteristic
     * @typedef {object} CarStatus
     * @property {DriveStateType|'?'} drive Actual drive state, '?' when the value is unknown
     * @property {number} driveSpeed Actual motor PWM, 0 when stopped
     * @property {number} speed Selected speed level 1-10
     * @property {number} flags STATUS_FLAG bits
     * @property {number} batteryMv Battery voltage in mV, 0 means unknown
     * @property {number} batteryPercent Battery estimate 0-100
     */

    const
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
        JOYSTICK_THRESHOLD = 0.3,
        SPEED_FROM_JOYSTICK = false,
        SPEED_RANGE_MIN = 1,
        SPEED_RANGE_MAX = 10,
        SPEED_RANGE_CORRECTION = (SPEED_RANGE_MAX - SPEED_RANGE_MIN) / (10 - (JOYSTICK_THRESHOLD * 10)),

        app = document.getElementById('app'),
        appLog = document.getElementById('app-log'),
        errorMessage = document.getElementById('error-message'),
        textBluetoothDeviceName = document.getElementById('bluetooth-device-name'),
        textBluetoothBattery = document.getElementById('bluetooth-battery'),
        textFirmwareVersion = document.getElementById('firmware-version'),
        textDisplaySpeed = document.getElementById('display-speed'),
        textDisplayDirection = document.getElementById('display-direction'),
        textDisplayDistance = document.getElementById('display-2'),
        textDisplayMotor = document.getElementById('display-1'),
        inputCustomCommand = document.getElementById('app-custom-command'),
        btnConnect = document.getElementById('connect'),
        // ctrlJoystick = document.getElementById('joystick'),
        ctrlDirectionForward = document.getElementById('command-direction-forward'),
        ctrlDirectionBackward = document.getElementById('command-direction-backward'),
        ctrlDirectionLeft = document.getElementById('command-direction-left'),
        ctrlDirectionRight = document.getElementById('command-direction-right'),
        ctrlSpeedPicker = document.getElementById('speed-picker'),
        ctrlAutopilot = document.getElementById('command-1'),
        ctrlLights = document.getElementById('command-2'),
        ctrlHorn = document.getElementById('command-3')
    ;

    let bluetoothDevice,
        bluetoothCharacteristic,
        bluetoothDistanceCharacteristic,
        bluetoothStatusCharacteristic,
        /** @type {CarStatus|null} */
        carStatus = null,
        speedInputAt = 0,
        bluetoothBusy = false,
        commandQueue = [],
        isManualDisconnect = false,

        // screens = {
        //     connect: document.getElementById('screen-connect'),
        //     error: document.getElementById('screen-error'),
        //     terminal: document.getElementById('screen-terminal'),
        // },
        // Displays filled from incoming `KEY=value;` data on the command characteristic, by key.
        // None are mapped: #display-1 shows the motor speed and #display-2 the front distance from the car status.
        displayFields = {},
        mapCommands = {},
        cache = {
            speed: 1,
            drive: DRIVE_STATE.STOP,
            // Last toggle state the app sent, only used when the car does not report its status
            autopilot: false,
            lights: false,
        };


    // Check if the browser supports Web Bluetooth API.
    if ('bluetooth' in navigator) {
        navigator.bluetooth.getAvailability()
            .then(available => {
                if (!available) {
                    errorHandler('Bluetooth is not available on this device');
                }
            });
    } else {
        errorHandler('Bluetooth API is not available on this device');
    }

    // Check if the browser supports pointer events
    if (!window.PointerEvent) {
        errorHandler('Pointer events are not supported, some controls may not work');
    }


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
     * Add log entry
     * @param {string} text
     * @param {LogType} logType
     * @returns {void}
     */
    function addLogEntry(text, logType = LOG_TYPE.STANDARD)
    {
        let prefix = '';
        if (window.Intl && window.Intl.DateTimeFormat) {
            prefix += new window.Intl.DateTimeFormat('default', {
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric',
                hour12: false,
            }).format(new Date());
        }

        switch (logType) {
            case LOG_TYPE.RECEIVE:
                prefix += ' < ';
                break;
            case LOG_TYPE.SEND:
                prefix += ' > ';
                break;
            default:
                prefix += ' - ';
                break;
        }

        const item = document.createElement('li');
        item.textContent = prefix + text;
        appLog.appendChild(item);

        appLog.scrollTo(0, appLog.scrollHeight);
    }

    /**
     * Show error screen
     * @param {string} errorText
     * @returns {void}
     */
    function errorShow(errorText)
    {
        errorMessage.innerText = errorText;
        screenShow(SCREEN.ERROR);
    }

    /**
     * Log errors to browser console and terminal
     * @param {string} errorText
     * @returns {void}
     */
    function errorLogger(errorText)
    {
        window.console.error(errorText);
        addLogEntry(errorText);
    }

    /**
     * Handler errors
     * @param {string} errorText
     * @returns {void}
     */
    function errorHandler(errorText)
    {
        errorLogger(errorText);
        errorShow(errorText);
        reset();
    }

    /**
     * Close error screen
     * @returns {void}
     */
    document.getElementById('command-close-error-screen').addEventListener('click', () => {
        screenShow(SCREEN.MAIN);
    });

    /**
     * Get current screen
     * @returns {ScreenType}
     */
    function screenGetCurrent()
    {
        return app.getAttribute('data-active-screen');
    }

    /**
     * Show screen
     * @param {ScreenType} screen
     * @returns {void}
     */
    function screenShow(screen)
    {
        if (screen === SCREEN.MAIN && !bluetoothCharacteristic) {
            screen = SCREEN.CONNECT;
        }

        app.setAttribute('data-active-screen', screen);
    }

    /**
     * Reset all
     * @returns {void}
     */
    function reset()
    {
        setConnectionState(CONNECTION_STATE.DISCONNECTED);
        textBluetoothDeviceName.textContent = 'Not connected';

        bluetoothDevice = null;
        bluetoothCharacteristic = null;
        bluetoothDistanceCharacteristic = null;
        bluetoothStatusCharacteristic = null;
        bluetoothBusy = false;
        isManualDisconnect = false;
        // The firmware failsafe turns autopilot off when the controller disconnects
        cache.autopilot = false;

        statusApply(null);
        textDistanceUpdate(null);
        textFirmwareVersion.textContent = '';
    }

    /**
     * Initialize app
     */
    function init()
    {
        reset();

        // TODO: init function
        mapCommands[DRIVE_STATE.STOP]           = 'S';
        mapCommands[DRIVE_STATE.FORWARD]        = 'F';
        mapCommands[DRIVE_STATE.FORWARD_RIGHT]  = 'I';
        mapCommands[DRIVE_STATE.RIGHT]          = 'R';
        mapCommands[DRIVE_STATE.BACKWARD_RIGHT] = 'J';
        mapCommands[DRIVE_STATE.BACKWARD]       = 'B';
        mapCommands[DRIVE_STATE.BACKWARD_LEFT]  = 'H';
        mapCommands[DRIVE_STATE.LEFT]           = 'L';
        mapCommands[DRIVE_STATE.FORWARD_LEFT]   = 'G';
        mapCommands['autopilot-on']             = 'X';
        mapCommands['autopilot-off']            = 'x';
        mapCommands['lights-on']                = 'W';
        mapCommands['lights-off']               = 'w';
        mapCommands['horn-on']                  = 'V';
        mapCommands['horn-off']                 = 'v';
        mapCommands['command-4']                = '4';


// TODO: temporary
// setConnectionState(CONNECTION_STATE.CONNECTED);
// screenShow('main');
app.setAttribute('data-active-screen', 'main');
addLogEntry('TESTING STUFF');

    }

    init();

    /**
     * Update direction text
     * @returns {void}
     */
    function textDirectionUpdate()
    {
        // The car can change state on its own (safety stop, failsafe, autopilot), so its status wins
        textDisplayDirection.textContent = carStatus ? carStatus.drive : cache.drive;
    }

    /**
     * Update motor speed text: actual motor PWM as a percentage of MOTOR_PWM_MAX, 0% when stopped
     * @returns {void}
     */
    function textMotorUpdate()
    {
        if (carStatus) {
            textDisplayMotor.textContent = Math.round(carStatus.driveSpeed / MOTOR_PWM_MAX * 100) + '%';
        } else {
            textDisplayMotor.textContent = '—';
        }
    }

    /**
     * Update battery text in the status bar
     * @returns {void}
     */
    function textBatteryUpdate()
    {
        if (carStatus && carStatus.batteryMv > 0) {
            textBluetoothBattery.textContent = carStatus.batteryPercent + '% (' + (carStatus.batteryMv / 1000).toFixed(2) + ' V)';
        } else {
            textBluetoothBattery.textContent = '';
        }
    }

    /**
     * Set the pressed state of a toggle button, null means unknown
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
     * Update the autopilot, lights and horn buttons from the car status flags
     * @returns {void}
     */
    function commandFlagsUpdate()
    {
        if (!carStatus) {
            setPressed(ctrlAutopilot, null);
            setPressed(ctrlLights, null);
            setPressed(ctrlHorn, null);
            return;
        }

        const flags = carStatus.flags;
        setPressed(ctrlAutopilot, (flags & STATUS_FLAG.AUTOPILOT) !== 0);
        setPressed(ctrlLights, (flags & (STATUS_FLAG.LIGHT_FRONT | STATUS_FLAG.LIGHT_REAR)) !== 0);
        setPressed(ctrlHorn, (flags & STATUS_FLAG.HORN) !== 0);
    }

    /**
     * Convert the status cruise speed (motor PWM) to the closest speed level 1-10
     * @param {number} pwm
     * @returns {number}
     */
    function cruiseSpeedToLevel(pwm)
    {
        let level = 1;
        CRUISE_SPEEDS.forEach((speed, index) => {
            if (Math.abs(speed - pwm) < Math.abs(CRUISE_SPEEDS[level - 1] - pwm)) {
                level = index + 1;
            }
        });
        return level;
    }

    /**
     * Parse the status characteristic value
     * @param {DataView} value
     * @returns {CarStatus|null} null when the value is too short
     */
    function statusParse(value)
    {
        if (value.byteLength < STATUS_LENGTH) {
            return null;
        }

        return {
            drive: STATUS_DRIVE_STATES[value.getUint8(0)] ?? '?',
            driveSpeed: value.getUint8(1),
            speed: cruiseSpeedToLevel(value.getUint8(2)),
            flags: value.getUint8(3),
            batteryMv: value.getUint16(4, true),
            batteryPercent: value.getUint8(6),
        };
    }

    /**
     * Show the car status, null clears it and falls back to the last sent commands
     * @param {CarStatus|null} status
     * @returns {void}
     */
    function statusApply(status)
    {
        carStatus = status;

        // Follow the car's selected speed, unless the user is moving the picker right now
        if (status && status.speed !== cache.speed && Date.now() - speedInputAt >= SPEED_SYNC_HOLD) {
            cache.speed = status.speed;
            ctrlSpeedPicker.value = status.speed;
        }

        textDirectionUpdate();
        textSpeedUpdate();
        textMotorUpdate();
        textBatteryUpdate();
        commandFlagsUpdate();
    }

    /**
     * Update speed text
     * @returns {void}
     */
    function textSpeedUpdate()
    {
        textDisplaySpeed.textContent = cache.speed;
    }

    /**
     * Update front distance text
     * @param {number|null} cm Distance in cm, DISTANCE_MAX means nothing in range, null means no data
     * @returns {void}
     */
    function textDistanceUpdate(cm)
    {
        if (cm === null) {
            textDisplayDistance.textContent = '—';
        } else if (cm >= DISTANCE_MAX) {
            textDisplayDistance.textContent = DISTANCE_MAX + '+ cm';
        } else {
            textDisplayDistance.textContent = cm + ' cm';
        }
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
    ctrlSpeedPicker.addEventListener('input', () => {
        speedInputAt = Date.now();
    });
    ctrlSpeedPicker.addEventListener('input', cmdUpdateSpeedDebounced);

    /**
     * Toggle terminal screen display
     * @returns {void}
     */
    document.getElementById('command-toggle-terminal').addEventListener('click', () => {
        if (screenGetCurrent() === SCREEN.TERMINAL) {
            screenShow(SCREEN.MAIN);
        } else {
            screenShow(SCREEN.TERMINAL);
            appLog.scrollTo(0, appLog.scrollHeight);
        }
    });

    /**
     * Send a custom message
     * @returns {void}
     */
    document.getElementById('app-custom-command-send').addEventListener('click', async () => {
        await bluetoothSendCommand(inputCustomCommand.value);
    });

    /**
     * Toggle connect screen display
     * @returns {void}
     */
    document.getElementById('command-toggle-connect').addEventListener('click', () => {
        if (screenGetCurrent() === SCREEN.CONNECT) {
            screenShow(SCREEN.MAIN);
        } else {
            screenShow(SCREEN.CONNECT);
        }
    });

    /**
     * Change connection button
     * @param {ConnectionStateType} state
     * @returns {void}
     */
    function setConnectionState(state)
    {
        btnConnect.disabled = (state === CONNECTION_STATE.CONNECTING);
        app.setAttribute('data-status', state);
    }

    /**
     * Send a command to the Bluetooth
     * @param {string} cmd
     * @param {number|string|object} data
     * @returns {Promise<void>}
     */
    function bluetoothSendCommand(cmd, data)
    {
        if (!bluetoothCharacteristic || bluetoothBusy) {
            // TODO: if busy send later
            // commandQueue.push({cmd, data});
            return Promise.resolve();
        }

        bluetoothBusy = true;

        let sendArray = (new TextEncoder()).encode(cmd);
        if (data !== undefined) {
            let dataArray = 0;
            if (typeof data === 'number') {
                dataArray = new Uint8Array([data]);
            } else if (typeof data === 'string') {
                dataArray = (new TextEncoder()).encode(data);
            } else if (typeof data === 'object') {
                // TODO: Support for chars
                dataArray = new Uint8Array(data);
            }

            // cmd=data
            sendArray = new Uint8Array([...sendArray, '='.charCodeAt(0), ...dataArray, ';'.charCodeAt(0)]);
        }
console.log(sendArray);
        return bluetoothCharacteristic.writeValue(sendArray)
            .then(() => {
                addLogEntry(cmd, LOG_TYPE.SEND);
                // if (commandQueue.length > 0) {
                //     const next = commandQueue.shift();
                //     return bluetoothSendCommand(next.cmd, next.data);
                // }
            })
            .catch(error => {
                errorLogger(error);
            })
            .finally(() => {
                bluetoothBusy = false;
            });
    }

    /**
     * Set drive state
     * @param {DriveStateType} state
     * @returns {void}
     */
    function setDriveState(state)
    {
        if (cache.drive !== state) {
            cache.drive = state;
            bluetoothSendCommand(mapCommands[state]);

            textDirectionUpdate();
        }
    }

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

    const directionPressed = {
        forward: false,
        right: false,
        backward: false,
        left: false
    };

    function directionCalculator()
    {
        // Start empty, not with STOP, otherwise left alone would become 'SL', which has no command
        let direction = '';
        if (directionPressed.forward) {
            direction = DRIVE_STATE.FORWARD;
        } else if (directionPressed.backward) {
            direction = DRIVE_STATE.BACKWARD;
        }

        if (directionPressed.left) {
            direction += DRIVE_STATE.LEFT;
        } else if (directionPressed.right) {
            direction += DRIVE_STATE.RIGHT;
        }

        if (direction === '') {
            direction = DRIVE_STATE.STOP;
        }

        setDriveState(direction);
        return direction;
    }
    function bindEvt(el, handleStart, handleEnd)
    {
        el.addEventListener('pointerdown', handleStart, false);
        el.addEventListener('pointerup', handleEnd, false);
        el.addEventListener('pointercancel', handleEnd, false);
    }
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
        if (event.target.id in mapCommands) {
            bluetoothSendCommand(mapCommands[event.target.id]);
        }
    });

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
     * Autopilot toggle
     * @returns {void}
     */
    ctrlAutopilot.addEventListener('click', () => {
        cache.autopilot = !toggleIsOn(STATUS_FLAG.AUTOPILOT, 'autopilot');
        bluetoothSendCommand(mapCommands[cache.autopilot ? 'autopilot-on' : 'autopilot-off']);
    });

    /**
     * Lights toggle (front and rear switch together in the firmware)
     * @returns {void}
     */
    ctrlLights.addEventListener('click', () => {
        cache.lights = !toggleIsOn(STATUS_FLAG.LIGHT_FRONT | STATUS_FLAG.LIGHT_REAR, 'lights');
        bluetoothSendCommand(mapCommands[cache.lights ? 'lights-on' : 'lights-off']);
    });

    /**
     * Horn sounds while the button is held. The firmware tone has a fixed length,
     * releasing early stops it.
     * @returns {void}
     */
    bindEvt(ctrlHorn, function (e) {
        e.preventDefault();
        e.stopPropagation();
        bluetoothSendCommand(mapCommands['horn-on']);
    }, function (e) {
        e.preventDefault();
        e.stopPropagation();
        bluetoothSendCommand(mapCommands['horn-off']);
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
            bluetoothSendCommand(mapCommands[event.target.id], data);
        }
    });

    /**
     * Receive data via Bluetooth
     * @param {object} event
     * @returns {void}
     */
    function bluetoothCharacteristicValueChanged(event)
    {
        const value = new TextDecoder().decode(event.target.value);
        addLogEntry(value, LOG_TYPE.RECEIVE);

        const items = value.split(';');
        items.forEach((item) => {
            let command,
                data;

            [command, data] = item.split('=');
            if (command in displayFields) {
                displayFields[command].textContent = data;
            }
        });
    }

    /**
     * Receive front distance via Bluetooth (uint16 little-endian, cm)
     * NOTE: Notified about every 200 ms, so it is not written to the terminal log
     * @param {object} event
     * @returns {void}
     */
    function bluetoothDistanceValueChanged(event)
    {
        textDistanceUpdate(event.target.value.getUint16(0, true));
    }

    /**
     * Subscribe to front distance notifications. Older firmware does not have
     * this characteristic, so a failure is logged and does not fail the connection.
     * @param {BluetoothRemoteGATTService} service
     * @returns {Promise<void>}
     */
    async function bluetoothDistanceStart(service)
    {
        try {
            const characteristic = await service.getCharacteristic(BT_CHARACTERISTIC_DISTANCE);
            characteristic.addEventListener('characteristicvaluechanged', bluetoothDistanceValueChanged);
            bluetoothDistanceCharacteristic = characteristic;

            const initial = await characteristic.readValue();
            textDistanceUpdate(initial.getUint16(0, true));

            await characteristic.startNotifications();
            addLogEntry('Distance notifications started');
        } catch (error) {
            errorLogger('Distance sensor not available: ' + error);
        }
    }

    /**
     * Receive car status via Bluetooth
     * NOTE: Sent on every change and every 2 s, so it is not written to the terminal log
     * @param {object} event
     * @returns {void}
     */
    function bluetoothStatusValueChanged(event)
    {
        const status = statusParse(event.target.value);
        if (status) {
            statusApply(status);
        } else {
            errorLogger('Invalid car status length: ' + event.target.value.byteLength);
        }
    }

    /**
     * Subscribe to car status notifications. Older firmware does not have
     * this characteristic, so a failure is logged and does not fail the connection.
     * @param {BluetoothRemoteGATTService} service
     * @returns {Promise<void>}
     */
    async function bluetoothStatusStart(service)
    {
        try {
            const characteristic = await service.getCharacteristic(BT_CHARACTERISTIC_STATUS);
            characteristic.addEventListener('characteristicvaluechanged', bluetoothStatusValueChanged);
            bluetoothStatusCharacteristic = characteristic;

            const status = statusParse(await characteristic.readValue());
            if (status) {
                statusApply(status);
            }

            await characteristic.startNotifications();
            addLogEntry('Status notifications started');
        } catch (error) {
            errorLogger('Car status not available: ' + error);
        }
    }

    /**
     * Read the firmware version. Older firmware does not have
     * this characteristic, so a failure is logged and does not fail the connection.
     * @param {BluetoothRemoteGATTService} service
     * @returns {Promise<void>}
     */
    async function bluetoothVersionRead(service)
    {
        try {
            const characteristic = await service.getCharacteristic(BT_CHARACTERISTIC_VERSION);
            const value = await characteristic.readValue();
            // Cut at the first NUL in case the firmware pads the string
            const text = new TextDecoder().decode(value);
            const version = text.split('\0')[0].trim();

            textFirmwareVersion.textContent = version ? ' · v' + version : '';
            addLogEntry('Firmware version ' + version);
        } catch (error) {
            errorLogger('Firmware version not available: ' + error);
        }
    }

    /**
     * Reject when a promise does not settle in time
     * @param {Promise<*>} promise
     * @param {number} ms
     * @param {string} message
     * @returns {Promise<*>}
     */
    function promiseTimeout(promise, ms, message)
    {
        let timer;
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), ms);
            }),
        ]).finally(() => clearTimeout(timer));
    }

    /**
     * Bluetooth device connect
     * @returns {Promise<void>}
     */
    async function bluetoothConnect()
    {
        addLogEntry('Connecting...');
        setConnectionState(CONNECTION_STATE.CONNECTING);

        try {
            // Reconnect to the same device if it exists, otherwise let the user pick one.
            // The disconnect listener is only added once per device, so reconnects do not stack listeners.
            if (!bluetoothDevice) {
                bluetoothDevice = await navigator.bluetooth.requestDevice({
                    filters: [{services: [BT_SERVICE]}],
                    optionalServices: ['battery_service'],
                });
                bluetoothDevice.addEventListener('gattserverdisconnected', bluetoothOnDisconnected);
            }
            textBluetoothDeviceName.textContent = bluetoothDevice.name;

            // Timeout starts after the device is picked, so time spent in the picker does not count
            addLogEntry('Connecting to GATT server...');
            const server = await promiseTimeout(bluetoothDevice.gatt.connect(), BT_CONNECTION_TIMEOUT, 'Connection timeout');
            addLogEntry('Connected to GATT server');

            const service = await server.getPrimaryService(BT_SERVICE);
            addLogEntry('Found primary service');

            const characteristic = await service.getCharacteristic(BT_CHARACTERISTIC_COMMAND);
            addLogEntry('Found characteristic');

            // startNotifications() throws when the characteristic has no notify property
            if (characteristic.properties.notify) {
                characteristic.addEventListener('characteristicvaluechanged', bluetoothCharacteristicValueChanged);
                await characteristic.startNotifications();
                addLogEntry('Notifications started');
            } else {
                addLogEntry('Characteristic does not support notifications');
            }

            bluetoothCharacteristic = characteristic;
            setConnectionState(CONNECTION_STATE.CONNECTED);
            screenShow(SCREEN.MAIN);

            // Optional, missing characteristics (older firmware) do not fail the connection.
            // Run one after another, GATT operations are not reliable in parallel.
            await bluetoothVersionRead(service);
            await bluetoothStatusStart(service);
            await bluetoothDistanceStart(service);
        } catch (error) {
            errorHandler(error);
        }

        // // bluetoothDevice = await navigator.bluetooth.requestDevice({
        // //     filters: [{services: [0xFFE0]}],
        // //     optionalServices: ["battery_service"],
        // // });
        // //
        // // const server = await this.device.gatt.connect();
        // // const service = await server.getPrimaryService(0xFFE0);
        // // // this.itemCountCharacteristic = await service.getCharacteristic(0x2ac0);
        // // // this.stateCharacteristic = await service.getCharacteristic(0x2ac1);
        // // bluetoothCharacteristic = await service.getCharacteristic(0xFFE1);
        // // // this.vehicleStateCharacteristic = await service.getCharacteristic(0x2ac2);
        //
        // (function () {
        //     // Connect to the same device if it exists
        //     if (bluetoothDevice) {
        //         // TODO: Issue with reconnect when device is completely gone - gets stuck on this step
        //         return bluetoothDevice;
        //     }
        //
        //     return navigator.bluetooth.requestDevice({
        //         filters: [{services: [0xFFE0]}],
        //         optionalServices: ["battery_service"],
        //     });
        // })()
        // .then(device => {
        //     bluetoothDevice = device;
        //     bluetoothDevice.addEventListener('gattserverdisconnected', bluetoothOnDisconnected);
        //
        //     textBluetoothDeviceName.textContent = bluetoothDevice.name;
        //
        //     addLogEntry('Connecting to GATT server...');
        //     return bluetoothDevice.gatt.connect();
        // })
        // .then(server => {
        //     addLogEntry('Connected to GATT server');
        //     return server.getPrimaryService(0xFFE0);
        // })
        // .then(service => {
        //     addLogEntry('Found primary service');
        //     return service.getCharacteristic(0xFFE1);
        // })
        // .then(characteristic => {
        //     addLogEntry('Found characteristic');
        //     bluetoothCharacteristic = characteristic;
        //     bluetoothCharacteristic.addEventListener('characteristicvaluechanged', bluetoothCharacteristicValueChanged);
        //
        //     app.setAttribute('data-status', 'connected');
        //     screenShow(SCREEN.MAIN);
        //     setConnectionState(CONNECTION_STATE.CONNECTED);
        //
        //     addLogEntry('Starting notifications...');
        //     // return characteristic.startNotifications();
        //     return Promise.resolve();
        // })
        // // .then(() => {
        // //     addLogEntry('Notifications started');
        // //
        // //     addLogEntry('Config probing...');
        // //     bluetoothSendCommand('?');
        // //
        // //     return Promise.resolve();
        // // })
        // .catch(errorHandler);
    }

    /**
     * Bluetooth device disconnect
     * @returns {void}
     */
    function bluetoothDisconnect()
    {
        if (!bluetoothDevice) {
            return;
        }

        addLogEntry('Disconnecting from Bluetooth device...');

        if (bluetoothDevice.gatt && bluetoothDevice.gatt.connected) {
            isManualDisconnect = true;
            bluetoothDevice.gatt.disconnect();
        } else {
            addLogEntry('Bluetooth device is already disconnected');
        }
    }

    /**
     * Bluetooth disconnect event
     * @returns {void}
     */
    function bluetoothOnDisconnected()
    {
        if (bluetoothCharacteristic) {
            bluetoothCharacteristic.removeEventListener('characteristicvaluechanged', bluetoothCharacteristicValueChanged);
            bluetoothCharacteristic = null;
        }
        if (bluetoothDistanceCharacteristic) {
            bluetoothDistanceCharacteristic.removeEventListener('characteristicvaluechanged', bluetoothDistanceValueChanged);
            bluetoothDistanceCharacteristic = null;
        }
        if (bluetoothStatusCharacteristic) {
            bluetoothStatusCharacteristic.removeEventListener('characteristicvaluechanged', bluetoothStatusValueChanged);
            bluetoothStatusCharacteristic = null;
        }
        // The firmware failsafe turns autopilot off when the controller disconnects
        cache.autopilot = false;
        statusApply(null);
        textDistanceUpdate(null);
        textFirmwareVersion.textContent = '';

        addLogEntry('Bluetooth device disconnected');

        if (isManualDisconnect) {
            reset();
        } else {
            bluetoothConnect();
        }
    }

    /**
     * Toggle Bluetooth connection
     * @returns {void}
     */
    btnConnect.addEventListener('click', () => {
        if (bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected) {
            bluetoothDisconnect();
        } else {
            bluetoothConnect();
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
});


// if ('serviceWorker' in navigator) {
//     if (!navigator.serviceWorker.controller) {
//         navigator.serviceWorker.register('/assets/js/service-worker.js', {
//             scope: '/'
//         }).then((registration) => {
//             window.console.log('Service worker registration succeeded: ', registration);
//         }, /*catch*/ (error) => {
//             window.console.log('Service worker registration failed:', error);
//         });
//     }
// }
if ('serviceWorker' in navigator) {
    navigator.serviceWorker
        .register('/assets/js/service-worker.js', {scope: '/'})
        .then(registration => {
            window.console.log('Service worker registration succeeded:', registration);
            // registration.addEventListener('updatefound', () => {
            //     const newWorker = registration.installing;
            //     newWorker.addEventListener('statechange', () => {
            //         if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            //             window.console.log('New service worker available, refreshing...');
            //             window.location.reload();
            //         }
            //     });
            // });
        })
        .catch(error => window.console.error('Service worker registration failed:', error));
}
