/**
 * Car manifest (car-black#31): the car describes its controller (grid + cells) and how to decode
 * its status telemetry. Download with paging, CRC check, cache, validation, grid layout and status
 * decoding. No DOM access, so it can be imported in Node tests.
 */
import {
    DRIVE_STATE,
    MANIFEST_AUTO_COLUMNS,
    MANIFEST_CACHE_KEY,
    MANIFEST_CACHE_SIZE,
    MANIFEST_GRID_MAX,
    MANIFEST_HEADER_LENGTH,
    MANIFEST_SCHEMA_VERSION,
    WATCHDOG_DRIVE_TIMEOUT,
    WATCHDOG_HORN_TIMEOUT,
} from './constants.js';

/**
 * Manifest header (the first 8 bytes of the blob)
 * @typedef {object} ManifestHeader
 * @property {number} schema Schema version
 * @property {number} encoding 0 raw JSON, 1 gzip (reserved)
 * @property {number} length Payload length, without the header
 * @property {number} crc CRC-32/ISO-HDLC of the payload
 */

/**
 * Status value descriptor: where a value is in the binary telemetry
 * @typedef {object} StatusDescriptor
 * @property {string} id
 * @property {string} src Characteristic short UUID, lowercase (ffe2, ffe3)
 * @property {number} at Byte offset
 * @property {'u8'|'u16le'|'bit'} t
 * @property {number} [bit] Bit 0-7 when t is bit
 * @property {number} [max] Full scale, shown as 100%
 * @property {number} [none] Sentinel meaning "no value"
 * @property {string} [unit]
 * @property {string[]} [enum] Names by value
 */

/**
 * One cell of the controller, see car-black#31 for the fields of each type
 * @typedef {object} ManifestCell
 * @property {string} key Key in the grid
 * @property {'button'|'hold'|'toggle'|'dpad'|'speed'|'display'|'color'} type
 * @property {string} [id] Well-known id
 * @property {string} [label]
 * @property {string} [title]
 * @property {string} [icon]
 * @property {boolean} [danger]
 * @property {string} [overrides] Id of the cell this one overrides while on
 */

/**
 * Where a cell goes in the CSS grid, 1-based
 * @typedef {object} GridArea
 * @property {string} key
 * @property {number} row
 * @property {number} column
 * @property {number} rowSpan
 * @property {number} columnSpan
 */

/**
 * Grid layout
 * @typedef {object} GridLayout
 * @property {number} columns
 * @property {number} rows
 * @property {GridArea[]} areas
 * @property {boolean} auto The grid was invalid or missing, so the cells are laid out in key order
 * @property {string[]} warnings
 */

/**
 * Validated manifest
 * @typedef {object} Manifest
 * @property {{id: string|null, name: string|null, fw: string|null, watchdog: {drive: number, horn: number}}} car
 * @property {StatusDescriptor[]} status
 * @property {{[key: string]: ManifestCell}} cells By key
 * @property {GridLayout} layout
 * @property {string[]} warnings Everything that was skipped, for the terminal log
 */

const STATUS_TYPES = Object.freeze({u8: 1, u16le: 2, bit: 1});
const DPAD_AXES = Object.freeze(['v', 'h', 'both']);

let crcTable = null;

/**
 * CRC-32/ISO-HDLC, the zlib / PNG variant (reflected polynomial 0xEDB88320)
 * @param {Uint8Array} bytes
 * @returns {number} Unsigned
 */
export function crc32(bytes)
{
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            crcTable[n] = c >>> 0;
        }
    }

    let crc = 0xFFFFFFFF;
    for (const byte of bytes) {
        crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Parse the manifest header
 * @param {Uint8Array} bytes Start of the blob
 * @returns {ManifestHeader|null} null when shorter than the header
 */
export function manifestHeaderParse(bytes)
{
    if (bytes.length < MANIFEST_HEADER_LENGTH) {
        return null;
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, MANIFEST_HEADER_LENGTH);
    return {
        schema: view.getUint8(0),
        encoding: view.getUint8(1),
        length: view.getUint16(2, true),
        crc: view.getUint32(4, true),
    };
}

/**
 * Download the manifest page by page. Page 0 is read without writing an offset (the car resets
 * it on connect). When its CRC is cached, nothing more is read.
 * @param {function(number): Promise<Uint8Array>} readPage Reads up to a page from a blob offset
 * @param {{get: function(number): (string|null), set: function(number, string): void}} cache
 * @returns {Promise<{text: string, crc: number, cached: boolean}>}
 */
export async function manifestDownload(readPage, cache)
{
    const first = await readPage(0);
    const header = manifestHeaderParse(first);
    if (!header) {
        throw new Error('Manifest header too short: ' + first.length + ' bytes');
    }
    if (header.schema !== MANIFEST_SCHEMA_VERSION) {
        throw new Error('Unknown manifest schema ' + header.schema);
    }
    if (header.encoding !== 0) {
        throw new Error('Unsupported manifest encoding ' + header.encoding);
    }

    const cachedText = cache.get(header.crc);
    if (cachedText !== null) {
        return {text: cachedText, crc: header.crc, cached: true};
    }

    // Stop at header + payload length, without relying on a short last page
    const total = MANIFEST_HEADER_LENGTH + header.length;
    const blob = new Uint8Array(total);
    let received = Math.min(first.length, total);
    blob.set(first.subarray(0, received));

    while (received < total) {
        const page = await readPage(received);
        if (page.length === 0) {
            throw new Error('Manifest page at offset ' + received + ' is empty');
        }
        const length = Math.min(page.length, total - received);
        blob.set(page.subarray(0, length), received);
        received += length;
    }

    const payload = blob.subarray(MANIFEST_HEADER_LENGTH);
    if (crc32(payload) !== header.crc) {
        throw new Error('Manifest CRC mismatch');
    }

    const text = new TextDecoder().decode(payload);
    cache.set(header.crc, text);
    return {text, crc: header.crc, cached: false};
}

/**
 * Manifest cache in localStorage, keyed by CRC. Keeps the newest MANIFEST_CACHE_SIZE manifests.
 * Every access is guarded: without storage the cache is empty, which only costs a full download.
 * @param {Storage|null} storage
 * @returns {{get: function(number): (string|null), set: function(number, string): void}}
 */
export function manifestCacheCreate(storage)
{
    /**
     * Read the stored entries, newest last
     * @returns {Array<[number, string]>}
     */
    function entriesRead()
    {
        try {
            const entries = JSON.parse(storage.getItem(MANIFEST_CACHE_KEY));
            return Array.isArray(entries) ? entries : [];
        } catch {
            return [];
        }
    }

    return {
        get(crc) {
            const entry = entriesRead().find(item => Array.isArray(item) && item[0] === crc);
            return entry && typeof entry[1] === 'string' ? entry[1] : null;
        },
        set(crc, text) {
            const entries = entriesRead().filter(item => Array.isArray(item) && item[0] !== crc);
            entries.push([crc, text]);
            try {
                storage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(entries.slice(-MANIFEST_CACHE_SIZE)));
            } catch {
                // Storage blocked or full, the next connect downloads the manifest again
            }
        },
    };
}

/**
 * Lay the cells out in key order, MANIFEST_AUTO_COLUMNS per row
 * @param {string[]} keys
 * @param {string[]} warnings
 * @returns {GridLayout}
 */
function gridAuto(keys, warnings)
{
    const columns = Math.max(1, Math.min(keys.length, MANIFEST_AUTO_COLUMNS));
    return {
        columns,
        rows: Math.max(1, Math.ceil(keys.length / columns)),
        areas: keys.map((key, index) => ({
            key,
            row: Math.floor(index / columns) + 1,
            column: (index % columns) + 1,
            rowSpan: 1,
            columnSpan: 1,
        })),
        auto: true,
        warnings,
    };
}

/**
 * Parse the grid map: one string per row, keys separated by spaces, `.` for an empty slot.
 * A key repeated over a rectangle spans it. A key without a cell is left empty, a cell that is
 * not in the grid is not shown. An invalid grid gives the automatic layout in key order.
 * @param {string[]} rows
 * @param {string[]} keys Keys of the cells
 * @returns {GridLayout}
 */
export function gridParse(rows, keys)
{
    const warnings = [];
    const invalid = (reason) => {
        warnings.push('Invalid grid (' + reason + '), using an automatic layout');
        return gridAuto(keys, warnings);
    };

    if (!Array.isArray(rows) || rows.length === 0) {
        return invalid('no rows');
    }
    if (!rows.every(row => typeof row === 'string' && row.trim() !== '')) {
        return invalid('a row is not text');
    }

    const tokens = rows.map(row => row.trim().split(/\s+/));
    const columns = tokens[0].length;
    if (tokens.some(row => row.length !== columns)) {
        return invalid('every row needs the same number of slots');
    }
    if (tokens.length > MANIFEST_GRID_MAX || columns > MANIFEST_GRID_MAX) {
        return invalid('larger than ' + MANIFEST_GRID_MAX + ' x ' + MANIFEST_GRID_MAX);
    }

    // Bounding box and slot count per key, in reading order
    const boxes = new Map();
    tokens.forEach((row, y) => {
        row.forEach((key, x) => {
            if (key === '.') {
                return;
            }
            const box = boxes.get(key) ?? {top: y, bottom: y, left: x, right: x, count: 0};
            box.top = Math.min(box.top, y);
            box.bottom = Math.max(box.bottom, y);
            box.left = Math.min(box.left, x);
            box.right = Math.max(box.right, x);
            box.count++;
            boxes.set(key, box);
        });
    });

    for (const [key, box] of boxes) {
        if (box.count !== (box.bottom - box.top + 1) * (box.right - box.left + 1)) {
            return invalid('"' + key + '" is not one filled rectangle');
        }
    }

    const areas = [];
    for (const [key, box] of boxes) {
        if (!keys.includes(key)) {
            warnings.push('Grid key "' + key + '" has no cell, left empty');
            continue;
        }
        areas.push({
            key,
            row: box.top + 1,
            column: box.left + 1,
            rowSpan: box.bottom - box.top + 1,
            columnSpan: box.right - box.left + 1,
        });
    }
    keys.filter(key => !boxes.has(key)).forEach((key) => {
        warnings.push('Cell "' + key + '" is not in the grid, not shown');
    });

    return {columns, rows: tokens.length, areas, auto: false, warnings};
}

/**
 * Whether a value is a non-empty string
 * @param {*} value
 * @returns {boolean}
 */
function isText(value)
{
    return typeof value === 'string' && value !== '';
}

/**
 * Whether a value is an object whose values all pass a check
 * @param {*} value
 * @param {function(*): boolean} check
 * @returns {boolean}
 */
function isMapOf(value, check)
{
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length > 0 && Object.values(value).every(check);
}

/**
 * Why a cell can not be used, by its type
 * @param {object} cell
 * @returns {string|null} null when the cell is fine
 */
function cellProblem(cell)
{
    switch (cell.type) {
        case 'button':
        case 'color':
            return isText(cell.cmd) ? null : 'no cmd';
        case 'hold':
            if (!isText(cell.press)) {
                return 'no press';
            }
            return cell.release === undefined || isText(cell.release) ? null : 'invalid release';
        case 'toggle':
            return isText(cell.on) && isText(cell.off) ? null : 'needs on and off';
        case 'dpad':
            if (!isMapOf(cell.cmd, isText)) {
                return 'no cmd map';
            }
            return cell.axis === undefined || DPAD_AXES.includes(cell.axis) ? null : 'unknown axis ' + cell.axis;
        case 'speed':
            return isMapOf(cell.keys, value => Number.isFinite(value)) ? null : 'no keys';
        case 'display':
            return isText(cell.status) ? null : 'no status';
        default:
            return 'unknown type ' + cell.type;
    }
}

/**
 * Why a status descriptor can not be used
 * @param {object} descriptor
 * @returns {string|null} null when the descriptor is fine
 */
function statusProblem(descriptor)
{
    if (!descriptor || !isText(descriptor.id) || !isText(descriptor.src)) {
        return 'needs id and src';
    }
    if (!Number.isInteger(descriptor.at) || descriptor.at < 0) {
        return 'invalid at';
    }
    if (!Object.hasOwn(STATUS_TYPES, descriptor.t)) {
        return 'unknown type ' + descriptor.t;
    }
    if (descriptor.t === 'bit' && !(Number.isInteger(descriptor.bit) && descriptor.bit >= 0 && descriptor.bit <= 7)) {
        return 'bit must be 0-7';
    }
    return null;
}

/**
 * Validate a parsed manifest. Unknown schema versions throw (the caller falls back to the legacy
 * manifest). Unknown or incomplete cells and status descriptors are skipped with a warning,
 * never guessed.
 * @param {object} data Parsed JSON
 * @returns {Manifest}
 */
export function manifestValidate(data)
{
    if (!data || typeof data !== 'object' || data.v !== MANIFEST_SCHEMA_VERSION) {
        throw new Error('Unknown manifest schema version ' + (data ? data.v : data));
    }

    const warnings = [];
    const car = data.car && typeof data.car === 'object' ? data.car : {};
    const watchdog = car.watchdog && typeof car.watchdog === 'object' ? car.watchdog : {};
    const positive = value => Number.isFinite(value) && value > 0;

    const status = [];
    (Array.isArray(data.status) ? data.status : []).forEach((descriptor, index) => {
        const problem = statusProblem(descriptor);
        if (problem) {
            warnings.push('Skipped status ' + (descriptor && descriptor.id ? descriptor.id : '#' + index) + ': ' + problem);
            return;
        }
        status.push({...descriptor, src: descriptor.src.toLowerCase()});
    });

    const cells = {};
    const source = data.cells && typeof data.cells === 'object' ? data.cells : {};
    Object.entries(source).forEach(([key, cell]) => {
        if (key === '.' || /\s/.test(key)) {
            warnings.push('Skipped cell "' + key + '": invalid key');
            return;
        }
        const problem = cell && typeof cell === 'object' ? cellProblem(cell) : 'not an object';
        if (problem) {
            warnings.push('Skipped cell "' + key + '": ' + problem);
            return;
        }
        cells[key] = {...cell, key};
    });

    const layout = gridParse(data.grid, Object.keys(cells));
    warnings.push(...layout.warnings);

    return {
        car: {
            id: isText(car.id) ? car.id : null,
            name: isText(car.name) ? car.name : null,
            fw: isText(car.fw) ? car.fw : null,
            watchdog: {
                drive: positive(watchdog.drive) ? watchdog.drive : WATCHDOG_DRIVE_TIMEOUT,
                horn: positive(watchdog.horn) ? watchdog.horn : WATCHDOG_HORN_TIMEOUT,
            },
        },
        status,
        cells,
        layout,
        warnings,
    };
}

/**
 * Decode the values of one characteristic: u8, u16 LE or one bit (boolean), enum values as their
 * name ('?' when out of range). Values past the end of a short packet are left out.
 * `max`, `none` and `unit` are left to the display, so the raw value stays usable (cruise PWM).
 * @param {StatusDescriptor[]} descriptors
 * @param {string} src Characteristic short UUID, lowercase
 * @param {DataView} view
 * @returns {{[key: string]: number|boolean|string}} By status id
 */
export function statusDecode(descriptors, src, view)
{
    const values = {};
    descriptors.forEach((descriptor) => {
        if (descriptor.src !== src || descriptor.at + STATUS_TYPES[descriptor.t] > view.byteLength) {
            return;
        }

        let value;
        if (descriptor.t === 'bit') {
            value = ((view.getUint8(descriptor.at) >> descriptor.bit) & 1) === 1;
        } else if (descriptor.t === 'u16le') {
            value = view.getUint16(descriptor.at, true);
        } else {
            value = view.getUint8(descriptor.at);
        }

        if (Array.isArray(descriptor.enum) && typeof value === 'number') {
            value = descriptor.enum[value] ?? '?';
        }
        values[descriptor.id] = value;
    });
    return values;
}

/**
 * Speed levels of a speed cell, slowest first
 * @param {{[key: string]: number}} keys Key char -> PWM
 * @returns {Array<{key: string, pwm: number}>}
 */
export function speedLevels(keys)
{
    return Object.entries(keys)
        .map(([key, pwm]) => ({key, pwm}))
        .sort((a, b) => a.pwm - b.pwm);
}

/**
 * Speed level closest to a PWM value (the cruise status), the slower one on a tie
 * @param {Array<{key: string, pwm: number}>} levels
 * @param {number} pwm
 * @returns {number} Index into levels
 */
export function speedIndexFromPwm(levels, pwm)
{
    let best = 0;
    levels.forEach((level, index) => {
        if (Math.abs(level.pwm - pwm) < Math.abs(levels[best].pwm - pwm)) {
            best = index;
        }
    });
    return best;
}

/**
 * Group the dpad cells: cells with the same id form one d-pad (for example forward / back under
 * the left thumb and left / right under the right one) and their cmd maps are merged.
 * A dpad without an id is a d-pad of its own, by key.
 * @param {{[key: string]: ManifestCell}} cells
 * @returns {Map<string, {keys: string[], cmd: {[key: string]: string}}>}
 */
export function manifestDpads(cells)
{
    const dpads = new Map();
    Object.values(cells)
        .filter(cell => cell.type === 'dpad')
        .forEach((cell) => {
            const id = cell.id ?? cell.key;
            const dpad = dpads.get(id) ?? {keys: [], cmd: {}};
            dpad.keys.push(cell.key);
            Object.assign(dpad.cmd, cell.cmd);
            dpads.set(id, dpad);
        });
    return dpads;
}

/**
 * Command of a drive state. A diagonal without a command falls back to forward / backward.
 * @param {{[key: string]: string}} cmd Drive state -> command, `stop` for STOP
 * @param {DriveStateType} state
 * @returns {string|null} null when the d-pad has no command for it
 */
export function driveCommand(cmd, state)
{
    if (state === DRIVE_STATE.STOP) {
        return cmd.stop ?? null;
    }
    return cmd[state] ?? (state.length === 2 ? cmd[state[0]] : undefined) ?? null;
}

/**
 * Commands the send queue merges: drive letters (only the latest drive state matters, and the
 * release stop replaces a pending drive) and speed keys
 * @param {Manifest} manifest
 * @returns {{drive: Set<string>, speed: Set<string>}}
 */
export function manifestCommandGroups(manifest)
{
    const drive = new Set();
    const speed = new Set();
    Object.values(manifest.cells).forEach((cell) => {
        if (cell.type === 'dpad') {
            Object.values(cell.cmd).forEach(cmd => drive.add(cmd));
        } else if (cell.type === 'speed') {
            Object.keys(cell.keys).forEach(key => speed.add(key));
        }
    });
    return {drive, speed};
}
