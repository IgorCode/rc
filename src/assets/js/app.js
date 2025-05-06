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


    const
        BT_CONNECTION_TIMEOUT = 10000,
        JOYSTICK_THRESHOLD = 0.3,
        SPEED_FROM_JOYSTICK = false,
        SPEED_RANGE_MIN = 1,
        SPEED_RANGE_MAX = 10,
        SPEED_RANGE_CORRECTION = (SPEED_RANGE_MAX - SPEED_RANGE_MIN) / (10 - (JOYSTICK_THRESHOLD * 10)),

        app = document.getElementById('app'),
        appLog = document.getElementById('app-log'),
        errorMessage = document.getElementById('error-message'),
        textBluetoothDeviceName = document.getElementById('bluetooth-device-name'),
        textDisplaySpeed = document.getElementById('display-speed'),
        textDisplayDirection = document.getElementById('display-direction'),
        inputCustomCommand = document.getElementById('app-custom-command'),
        btnConnect = document.getElementById('connect'),
        // ctrlJoystick = document.getElementById('joystick'),
        ctrlDirectionForward = document.getElementById('command-direction-forward'),
        ctrlDirectionBackward = document.getElementById('command-direction-backward'),
        ctrlDirectionLeft = document.getElementById('command-direction-left'),
        ctrlDirectionRight = document.getElementById('command-direction-right'),
        ctrlSpeedPicker = document.getElementById('speed-picker')
    ;

    let bluetoothDevice,
        bluetoothCharacteristic,
        bluetoothBusy = false,
        commandQueue = [],
        isManualDisconnect = false,

        // screens = {
        //     connect: document.getElementById('screen-connect'),
        //     error: document.getElementById('screen-error'),
        //     terminal: document.getElementById('screen-terminal'),
        // },
        displayFields = {
            A: document.getElementById('display-1'),
            B: document.getElementById('display-2'),
            C: document.getElementById('display-3'),
        },
        mapCommands = {},
        cache = {
            speed: 1,
            drive: DRIVE_STATE.STOP,
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
        bluetoothBusy = false;
        isManualDisconnect = false;

        textDirectionUpdate();
        textSpeedUpdate();
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
        mapCommands['command-1']                = '1';
        mapCommands['command-2']                = '2';
        mapCommands['command-3']                = '3';
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
        textDisplayDirection.textContent = cache.drive;
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
        let direction = DRIVE_STATE.STOP;
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
        bluetoothSendCommand(mapCommands[event.target.id]);
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
     * Bluetooth device connect
     * @returns {void}
     */
    async function bluetoothConnect()
    {
        addLogEntry('Connecting...');

        // if (bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected) {
        //     addLogEntry('Bluetooth device is already connected...');
        //     return;
        // }

        setConnectionState(CONNECTION_STATE.CONNECTING);

        const connectPromise = (bluetoothDevice ? Promise.resolve(bluetoothDevice) : navigator.bluetooth.requestDevice({
            filters: [{ services: [0xFFE0] }],
            optionalServices: ["battery_service"],
        })).then(device => {
            bluetoothDevice = device;
            bluetoothDevice.addEventListener('gattserverdisconnected', bluetoothOnDisconnected);
            textBluetoothDeviceName.textContent = bluetoothDevice.name;
            addLogEntry('Connecting to GATT server...');
            return bluetoothDevice.gatt.connect();
        });

        // Timeout after 10 seconds
        return Promise.race([
            connectPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), BT_CONNECTION_TIMEOUT))
        ]).catch(errorHandler);

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
        }

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
