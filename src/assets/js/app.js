/**
 * Entry point: wires the modules together and starts the app.
 * Loaded as a module script, which runs after the document is parsed.
 */
import {CONNECTION_STATE, SCREEN} from './constants.js';
import {addLogEntry, errorLogger, logInit} from './log.js';
import {bluetoothEvents, bluetoothReset, bluetoothToggleConnection} from './bluetooth.js';
import {controlsInit, controlsReset, controlsSetStatus} from './controls.js';
import {
    errorShow,
    screenShow,
    uiInit,
    uiSetConnectionState,
    uiShowCarStatus,
    uiShowDeviceName,
    uiShowDistance,
    uiShowReceived,
    uiShowVersion,
} from './ui.js';

/**
 * Show the car status, null clears it and falls back to the last sent commands
 * @param {CarStatus|null} status
 * @returns {void}
 */
function statusApply(status)
{
    controlsSetStatus(status);
    uiShowCarStatus(status);
}

/**
 * Clear the data that only the connected car knows
 * @returns {void}
 */
function carDataClear()
{
    controlsReset();
    statusApply(null);
    uiShowDistance(null);
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
    bluetoothEvents.addEventListener('status', (event) => {
        statusApply(event.detail.status);
    });
    bluetoothEvents.addEventListener('distance', (event) => {
        uiShowDistance(event.detail.cm);
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
    reset();


// TODO: temporary
// setConnectionState(CONNECTION_STATE.CONNECTED);
// screenShow('main');
document.getElementById('app').setAttribute('data-active-screen', 'main');
addLogEntry('TESTING STUFF');

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
