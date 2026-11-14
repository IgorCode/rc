/**
 * Screens, displays, status bar and button pressed state. Only shows what it is given,
 * the state lives in bluetooth.js and controls.js.
 */
import {CONNECTION_STATE, DISTANCE_MAX, MOTOR_PWM_MAX, SCREEN, STATUS_FLAG} from './constants.js';
import {bluetoothIsConnected} from './bluetooth.js';
import {logScrollToEnd} from './log.js';

let app = null,
    errorMessage = null,
    textBluetoothDeviceName = null,
    textBluetoothBattery = null,
    textFirmwareVersion = null,
    textDisplaySpeed = null,
    textDisplayDirection = null,
    textDisplayDistance = null,
    textDisplayMotor = null,
    btnConnect = null,
    ctrlAutopilot = null,
    ctrlLights = null,
    ctrlHorn = null,

    // screens = {
    //     connect: document.getElementById('screen-connect'),
    //     error: document.getElementById('screen-error'),
    //     terminal: document.getElementById('screen-terminal'),
    // },
    // Displays filled from incoming `KEY=value;` data on the command characteristic, by key.
    // None are mapped: #display-1 shows the motor speed and #display-2 the front distance from the car status.
    displayFields = {};

/**
 * Find the elements and bind the screen buttons
 * @returns {void}
 */
export function uiInit()
{
    app = document.getElementById('app');
    errorMessage = document.getElementById('error-message');
    textBluetoothDeviceName = document.getElementById('bluetooth-device-name');
    textBluetoothBattery = document.getElementById('bluetooth-battery');
    textFirmwareVersion = document.getElementById('firmware-version');
    textDisplaySpeed = document.getElementById('display-speed');
    textDisplayDirection = document.getElementById('display-direction');
    textDisplayDistance = document.getElementById('display-2');
    textDisplayMotor = document.getElementById('display-1');
    btnConnect = document.getElementById('connect');
    ctrlAutopilot = document.getElementById('command-1');
    ctrlLights = document.getElementById('command-2');
    ctrlHorn = document.getElementById('command-3');

    /**
     * Close error screen
     * @returns {void}
     */
    document.getElementById('command-close-error-screen').addEventListener('click', () => {
        screenShow(SCREEN.MAIN);
    });

    /**
     * Toggle terminal screen display
     * @returns {void}
     */
    document.getElementById('command-toggle-terminal').addEventListener('click', () => {
        if (screenGetCurrent() === SCREEN.TERMINAL) {
            screenShow(SCREEN.MAIN);
        } else {
            screenShow(SCREEN.TERMINAL);
            logScrollToEnd();
        }
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
}

/**
 * Get current screen
 * @returns {ScreenType}
 */
export function screenGetCurrent()
{
    return app.getAttribute('data-active-screen');
}

/**
 * Show screen
 * @param {ScreenType} screen
 * @returns {void}
 */
export function screenShow(screen)
{
    if (screen === SCREEN.MAIN && !bluetoothIsConnected()) {
        screen = SCREEN.CONNECT;
    }

    app.setAttribute('data-active-screen', screen);
}

/**
 * Show error screen
 * @param {string} errorText
 * @returns {void}
 */
export function errorShow(errorText)
{
    errorMessage.innerText = errorText;
    screenShow(SCREEN.ERROR);
}

/**
 * Change connection button
 * @param {ConnectionStateType} state
 * @returns {void}
 */
export function uiSetConnectionState(state)
{
    btnConnect.disabled = (state === CONNECTION_STATE.CONNECTING);
    app.setAttribute('data-status', state);
}

/**
 * Show the device name in the status bar
 * @param {string|null} name null when not connected
 * @returns {void}
 */
export function uiShowDeviceName(name)
{
    textBluetoothDeviceName.textContent = name === null ? 'Not connected' : name;
}

/**
 * Show the firmware version in the status bar
 * @param {string|null} version null or empty when unknown
 * @returns {void}
 */
export function uiShowVersion(version)
{
    textFirmwareVersion.textContent = version ? ' · v' + version : '';
}

/**
 * Update direction text
 * @param {DriveStateType|'?'} drive
 * @returns {void}
 */
export function uiShowDirection(drive)
{
    textDisplayDirection.textContent = drive;
}

/**
 * Update speed text
 * @param {number} level Speed level 1-10
 * @returns {void}
 */
export function uiShowSpeed(level)
{
    textDisplaySpeed.textContent = level;
}

/**
 * Format the front distance
 * @param {number|null} cm Distance in cm, DISTANCE_MAX means nothing in range, null means no data
 * @returns {string}
 */
export function formatDistance(cm)
{
    if (cm === null) {
        return '—';
    }
    if (cm >= DISTANCE_MAX) {
        return DISTANCE_MAX + '+ cm';
    }
    return cm + ' cm';
}

/**
 * Format the motor speed: actual motor PWM as a percentage of MOTOR_PWM_MAX, 0% when stopped
 * @param {CarStatus|null} status
 * @returns {string}
 */
export function formatMotor(status)
{
    if (!status) {
        return '—';
    }
    return Math.round(status.driveSpeed / MOTOR_PWM_MAX * 100) + '%';
}

/**
 * Format the battery for the status bar
 * @param {CarStatus|null} status
 * @returns {string} empty when unknown
 */
export function formatBattery(status)
{
    if (!status || status.batteryMv <= 0) {
        return '';
    }
    return status.batteryPercent + '% (' + (status.batteryMv / 1000).toFixed(2) + ' V)';
}

/**
 * Update front distance text
 * @param {number|null} cm Distance in cm, DISTANCE_MAX means nothing in range, null means no data
 * @returns {void}
 */
export function uiShowDistance(cm)
{
    textDisplayDistance.textContent = formatDistance(cm);
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
 * @param {CarStatus|null} status
 * @returns {void}
 */
function commandFlagsUpdate(status)
{
    if (!status) {
        setPressed(ctrlAutopilot, null);
        setPressed(ctrlLights, null);
        setPressed(ctrlHorn, null);
        return;
    }

    const flags = status.flags;
    setPressed(ctrlAutopilot, (flags & STATUS_FLAG.AUTOPILOT) !== 0);
    setPressed(ctrlLights, (flags & (STATUS_FLAG.LIGHT_FRONT | STATUS_FLAG.LIGHT_REAR)) !== 0);
    setPressed(ctrlHorn, (flags & STATUS_FLAG.HORN) !== 0);
}

/**
 * Show the parts of the car status that only the car knows: motor speed, battery and toggle flags.
 * Direction and speed are shown by controls.js, which falls back to the last sent commands.
 * @param {CarStatus|null} status null clears it
 * @returns {void}
 */
export function uiShowCarStatus(status)
{
    textDisplayMotor.textContent = formatMotor(status);
    textBluetoothBattery.textContent = formatBattery(status);
    commandFlagsUpdate(status);
}

/**
 * Show `KEY=value;` data received on the command characteristic in the mapped displays
 * @param {string} text
 * @returns {void}
 */
export function uiShowReceived(text)
{
    const items = text.split(';');
    items.forEach((item) => {
        let command,
            data;

        [command, data] = item.split('=');
        if (command in displayFields) {
            displayFields[command].textContent = data;
        }
    });
}
