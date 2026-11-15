/**
 * Entry point: wires the modules together and starts the app.
 * Loaded as a module script, which runs after the document is parsed.
 */
import {CONNECTION_STATE, SCREEN} from './constants.js';
import {errorLogger, logInit} from './log.js';
import {bluetoothEvents, bluetoothReset, bluetoothToggleConnection} from './bluetooth.js';
import {controlsInit, controlsRender, controlsReset, controlsSetValues} from './controls.js';
import {manifestValidate} from './manifest.js';
import {MANIFEST_LEGACY} from './manifest-legacy.js';
import {
    errorShow,
    screenShow,
    uiInit,
    uiSetConnectionState,
    uiShowBattery,
    uiShowControlsHelp,
    uiShowDeviceName,
    uiShowReceived,
    uiShowVersion,
} from './ui.js';

/**
 * Status values the car reported, by id. The status and distance characteristics each send their own.
 * @type {{[key: string]: number|boolean|string}}
 */
let carValues = {};

/**
 * Show the car's status values, null clears them and the controls fall back to the last sent commands
 * @param {{[key: string]: number|boolean|string}|null} values
 * @returns {void}
 */
function valuesApply(values)
{
    carValues = values ?? {};
    controlsSetValues(carValues);
    uiShowBattery(carValues);
}

/**
 * Build the controller and the connect screen help from a manifest
 * @param {Manifest} manifest
 * @returns {void}
 */
function manifestApply(manifest)
{
    controlsRender(manifest);
    uiShowControlsHelp(manifest);
}

/**
 * Clear the data that only the connected car knows
 * @returns {void}
 */
function carDataClear()
{
    controlsReset();
    valuesApply(null);
    uiShowVersion(null);
}

/**
 * Reset all
 * @returns {void}
 */
function reset()
{
    bluetoothReset();
    carDataClear();
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
 * Update the UI from the Bluetooth events
 * @returns {void}
 */
function bluetoothEventsBind()
{
    bluetoothEvents.addEventListener('state', (event) => {
        uiSetConnectionState(event.detail.state);
        if (event.detail.state === CONNECTION_STATE.CONNECTED) {
            screenShow(SCREEN.MAIN);
        }
    });
    bluetoothEvents.addEventListener('device', (event) => {
        uiShowDeviceName(event.detail.name);
    });
    bluetoothEvents.addEventListener('version', (event) => {
        uiShowVersion(event.detail.version);
    });
    bluetoothEvents.addEventListener('manifest', (event) => {
        manifestApply(event.detail.manifest);
    });
    bluetoothEvents.addEventListener('values', (event) => {
        valuesApply({...carValues, ...event.detail.values});
    });
    bluetoothEvents.addEventListener('receive', (event) => {
        uiShowReceived(event.detail.text);
    });
    bluetoothEvents.addEventListener('disconnected', (event) => {
        carDataClear();
        if (event.detail.manual) {
            reset();
        }
    });
    bluetoothEvents.addEventListener('error', (event) => {
        errorHandler(event.detail.error);
    });
}

/**
 * Initialize app
 * @returns {void}
 */
function init()
{
    // Until a car connects, show the layout of firmware without a manifest
    manifestApply(manifestValidate(MANIFEST_LEGACY));
    reset();
}


logInit();
uiInit();
controlsInit();
bluetoothEventsBind();

/**
 * Toggle Bluetooth connection
 * @returns {void}
 */
document.getElementById('connect').addEventListener('click', bluetoothToggleConnection);

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

init();


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
