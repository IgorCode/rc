/**
 * Screens, status bar, connect screen help and the display formatting. Only shows what it is
 * given, the state lives in bluetooth.js and controls.js. The controller cells are built by
 * controls.js from the manifest and use the format*() helpers here.
 */
import {CONNECTION_STATE, SCREEN} from './constants.js';
import {bluetoothIsConnected} from './bluetooth.js';
import {logScrollToEnd} from './log.js';

let app = null,
    errorMessage = null,
    textBluetoothDeviceName = null,
    textBluetoothBattery = null,
    textFirmwareVersion = null,
    textControlsHelp = null,
    btnConnect = null,

    // screens = {
    //     connect: document.getElementById('screen-connect'),
    //     error: document.getElementById('screen-error'),
    //     terminal: document.getElementById('screen-terminal'),
    // },
    // Displays filled from incoming `KEY=value;` data on the command characteristic, by key.
    // None are mapped: the displays show the status values the manifest describes.
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
    textControlsHelp = document.getElementById('controls-help');
    btnConnect = document.getElementById('connect');

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
 * Format the speed display
 * @param {number} level Selected speed level, 1 is the slowest
 * @param {boolean} overridden Another control (Mad Max) overrides the selection, so the car drives at full speed
 * @returns {string}
 */
export function formatSpeed(level, overridden)
{
    return overridden ? 'MAX' : String(level);
}

/**
 * Unit after a value: `%` right after it, other units after a space
 * @param {string} [unit]
 * @returns {string}
 */
function unitSuffix(unit)
{
    if (!unit) {
        return '';
    }
    return unit === '%' ? unit : ' ' + unit;
}

/**
 * Format a status value for a display cell
 * - no value: a dash
 * - bit: On / Off, enum: its name
 * - `none` (the sentinel): a dash, for the front distance `400+ cm` (nothing in range)
 * - `max`: a percentage of it (motor PWM 250 is 100%)
 * - otherwise the number and its unit
 * @param {StatusDescriptor} descriptor
 * @param {number|boolean|string|undefined|null} value
 * @returns {string}
 */
export function formatStatusValue(descriptor, value)
{
    if (value === undefined || value === null) {
        return '—';
    }
    if (typeof value === 'boolean') {
        return value ? 'On' : 'Off';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (descriptor.none !== undefined && value >= descriptor.none) {
        return descriptor.id === 'distance' ? descriptor.none + '+' + unitSuffix(descriptor.unit) : '—';
    }
    if (descriptor.max > 0) {
        return Math.round(value / descriptor.max * 100) + '%';
    }
    return value + unitSuffix(descriptor.unit);
}

/**
 * Format the battery for the status bar, from the `battery` (mV) and `batteryPct` values
 * @param {{[key: string]: *}|null} values
 * @returns {string} empty when unknown
 */
export function formatBattery(values)
{
    if (!values || !(values.battery > 0)) {
        return '';
    }
    const volts = (values.battery / 1000).toFixed(2) + ' V';
    return typeof values.batteryPct === 'number' ? values.batteryPct + '% (' + volts + ')' : volts;
}

/**
 * Show the battery in the status bar
 * @param {{[key: string]: *}|null} values Status values by id, null clears it
 * @returns {void}
 */
export function uiShowBattery(values)
{
    textBluetoothBattery.textContent = formatBattery(values);
}

/**
 * Controls help for the connect screen: the buttons of the manifest, in grid order
 * @param {Manifest} manifest
 * @returns {Array<{label: string, text: string}>}
 */
export function controlsHelpItems(manifest)
{
    const types = ['button', 'hold', 'toggle', 'color'];
    return manifest.layout.areas
        .map(area => manifest.cells[area.key])
        .filter(cell => types.includes(cell.type) && cell.title)
        .map(cell => ({
            label: cell.label ?? cell.key,
            text: cell.type === 'hold' && !/hold/i.test(cell.title) ? cell.title + ' (hold)' : cell.title,
        }));
}

/**
 * Show the controls help on the connect screen
 * @param {Manifest} manifest
 * @returns {void}
 */
export function uiShowControlsHelp(manifest)
{
    const items = controlsHelpItems(manifest);
    textControlsHelp.replaceChildren();
    if (items.length === 0) {
        return;
    }

    textControlsHelp.append('Controls: ');
    items.forEach((item, index) => {
        const label = document.createElement('b');
        label.textContent = item.label;
        textControlsHelp.append(index > 0 ? ', ' : '', label, ' ' + item.text);
    });
    textControlsHelp.append('.');
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
