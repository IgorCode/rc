/**
 * Web Bluetooth connection to the car: connect, disconnect, reconnect, send commands
 * and receive the car's data. It does not touch the screen, it fires events on
 * `bluetoothEvents` instead (see below), and app.js updates the UI from them.
 */
import {
    BT_CHARACTERISTIC_COMMAND,
    BT_CHARACTERISTIC_DISTANCE,
    BT_CHARACTERISTIC_STATUS,
    BT_CHARACTERISTIC_VERSION,
    BT_CONNECTION_TIMEOUT,
    BT_SERVICE,
    CONNECTION_STATE,
    LOG_TYPE,
} from './constants.js';
import {addLogEntry, errorLogger} from './log.js';
import {distanceParse, statusParse, versionParse} from './status.js';

/**
 * Bluetooth events. All are CustomEvents with the payload in `detail`:
 * - `state` {state: ConnectionStateType}: the connection state changed
 * - `device` {name: string|null}: a device was picked, null after a reset
 * - `version` {version: string|null}: firmware version, null when disconnected
 * - `status` {status: CarStatus}: car status received
 * - `distance` {cm: number}: front distance received
 * - `receive` {text: string}: data received on the command characteristic
 * - `disconnected` {manual: boolean}: the device disconnected. An unexpected disconnect reconnects on its own.
 * - `error` {error: Error|string}: connecting failed
 * @type {EventTarget}
 */
export const bluetoothEvents = new EventTarget();

let bluetoothDevice = null,
    bluetoothCharacteristic = null,
    bluetoothDistanceCharacteristic = null,
    bluetoothStatusCharacteristic = null,
    bluetoothBusy = false,
    commandQueue = [],
    isManualDisconnect = false;

/**
 * Fire a Bluetooth event
 * @param {string} type
 * @param {object} detail
 * @returns {void}
 */
function emit(type, detail)
{
    bluetoothEvents.dispatchEvent(new CustomEvent(type, {detail}));
}

/**
 * Whether the command characteristic is ready, so commands can be sent
 * @returns {boolean}
 */
export function bluetoothIsConnected()
{
    return Boolean(bluetoothCharacteristic);
}

/**
 * Forget the device and all characteristics
 * @returns {void}
 */
export function bluetoothReset()
{
    emit('state', {state: CONNECTION_STATE.DISCONNECTED});
    emit('device', {name: null});

    bluetoothDevice = null;
    bluetoothCharacteristic = null;
    bluetoothDistanceCharacteristic = null;
    bluetoothStatusCharacteristic = null;
    bluetoothBusy = false;
    isManualDisconnect = false;
}

/**
 * Encode a command for the wire: the command alone, or `cmd=<data>;` when there is a payload
 * @param {string} cmd
 * @param {number|string|object} data
 * @returns {Uint8Array}
 */
export function encodeCommand(cmd, data)
{
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
    return sendArray;
}

/**
 * Send a command to the Bluetooth
 * @param {string} cmd
 * @param {number|string|object} data
 * @returns {Promise<void>}
 */
export function bluetoothSendCommand(cmd, data)
{
    if (!bluetoothCharacteristic || bluetoothBusy) {
        // TODO: if busy send later
        // commandQueue.push({cmd, data});
        return Promise.resolve();
    }

    bluetoothBusy = true;

    const sendArray = encodeCommand(cmd, data);
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
 * Receive data via Bluetooth
 * @param {object} event
 * @returns {void}
 */
function bluetoothCharacteristicValueChanged(event)
{
    const value = new TextDecoder().decode(event.target.value);
    addLogEntry(value, LOG_TYPE.RECEIVE);
    emit('receive', {text: value});
}

/**
 * Receive front distance via Bluetooth (uint16 little-endian, cm)
 * NOTE: Notified about every 200 ms, so it is not written to the terminal log
 * @param {object} event
 * @returns {void}
 */
function bluetoothDistanceValueChanged(event)
{
    emit('distance', {cm: distanceParse(event.target.value)});
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
        emit('distance', {cm: distanceParse(initial)});

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
        emit('status', {status});
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
            emit('status', {status});
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
        const version = versionParse(await characteristic.readValue());

        emit('version', {version});
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
export function promiseTimeout(promise, ms, message)
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
export async function bluetoothConnect()
{
    addLogEntry('Connecting...');
    emit('state', {state: CONNECTION_STATE.CONNECTING});

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
        emit('device', {name: bluetoothDevice.name});

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
        emit('state', {state: CONNECTION_STATE.CONNECTED});

        // Optional, missing characteristics (older firmware) do not fail the connection.
        // Run one after another, GATT operations are not reliable in parallel.
        await bluetoothVersionRead(service);
        await bluetoothStatusStart(service);
        await bluetoothDistanceStart(service);
    } catch (error) {
        emit('error', {error});
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
export function bluetoothDisconnect()
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
 * Connect, or disconnect when already connected
 * @returns {void}
 */
export function bluetoothToggleConnection()
{
    if (bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected) {
        bluetoothDisconnect();
    } else {
        bluetoothConnect();
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

    addLogEntry('Bluetooth device disconnected');

    // Read before the event: after a manual disconnect the app resets, which clears the flag
    const manual = isManualDisconnect;
    emit('disconnected', {manual});

    if (!manual) {
        bluetoothConnect();
    }
}
