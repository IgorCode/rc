import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
    crc32,
    driveCommand,
    gridParse,
    manifestCacheCreate,
    manifestCommandGroups,
    manifestDownload,
    manifestDpads,
    manifestHeaderParse,
    manifestValidate,
    speedIndexFromPwm,
    speedLevels,
    statusDecode,
} from '../src/assets/js/manifest.js';
import {MANIFEST_LEGACY} from '../src/assets/js/manifest-legacy.js';

/**
 * Wrap bytes in a DataView, like a characteristic value
 * @param {number[]} bytes
 * @returns {DataView}
 */
function dataView(bytes)
{
    return new DataView(new Uint8Array(bytes).buffer);
}

/**
 * Build a manifest blob: 8-byte header + payload, like the car serves it on 0xFFE5
 * @param {string} text JSON payload
 * @param {{schema?: number, encoding?: number, crc?: number}} [override]
 * @returns {Uint8Array}
 */
function blobBuild(text, override = {})
{
    const payload = new TextEncoder().encode(text);
    const blob = new Uint8Array(8 + payload.length);
    const view = new DataView(blob.buffer);
    view.setUint8(0, override.schema ?? 1);
    view.setUint8(1, override.encoding ?? 0);
    view.setUint16(2, payload.length, true);
    view.setUint32(4, override.crc ?? crc32(payload), true);
    blob.set(payload, 8);
    return blob;
}

/**
 * Fake 0xFFE5: serves up to pageSize bytes from the requested offset and records the offsets
 * @param {Uint8Array} blob
 * @param {number} pageSize
 * @returns {{readPage: function(number): Promise<Uint8Array>, offsets: number[]}}
 */
function pagesFake(blob, pageSize = 500)
{
    const offsets = [];
    return {
        offsets,
        readPage: async (offset) => {
            offsets.push(offset);
            return blob.slice(offset, offset + pageSize);
        },
    };
}

/**
 * In-memory manifest cache
 * @returns {{get: function(number): (string|null), set: function(number, string): void, store: Map}}
 */
function cacheFake()
{
    const store = new Map();
    return {
        store,
        get: crc => store.get(crc) ?? null,
        set: (crc, text) => store.set(crc, text),
    };
}

describe('crc32', () => {
    it('matches the CRC-32/ISO-HDLC check value', () => {
        assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
    });

    it('is 0 for no data', () => {
        assert.equal(crc32(new Uint8Array(0)), 0);
    });
});

describe('manifestHeaderParse', () => {
    it('reads schema, encoding, length and CRC (little-endian)', () => {
        assert.deepEqual(manifestHeaderParse(new Uint8Array([1, 0, 0x34, 0x12, 0x26, 0x39, 0xF4, 0xCB])), {
            schema: 1,
            encoding: 0,
            length: 0x1234,
            crc: 0xCBF43926,
        });
    });

    it('returns null when shorter than 8 bytes', () => {
        assert.equal(manifestHeaderParse(new Uint8Array([1, 0, 0, 0, 0, 0, 0])), null);
    });
});

describe('manifestDownload', () => {
    const text = JSON.stringify({v: 1, pad: 'x'.repeat(1200)});

    it('reads pages across 500-byte boundaries and verifies the CRC', async () => {
        const blob = blobBuild(text);
        const pages = pagesFake(blob);
        const cache = cacheFake();

        const result = await manifestDownload(pages.readPage, cache);

        assert.equal(result.text, text);
        assert.equal(result.cached, false);
        assert.equal(result.crc, crc32(new TextEncoder().encode(text)));
        assert.deepEqual(pages.offsets, [0, 500, 1000]);
        assert.equal(cache.store.get(result.crc), text);
    });

    it('stops after page 0 when the CRC is cached', async () => {
        const blob = blobBuild(text);
        const pages = pagesFake(blob);
        const cache = cacheFake();
        cache.set(crc32(new TextEncoder().encode(text)), text);

        const result = await manifestDownload(pages.readPage, cache);

        assert.equal(result.cached, true);
        assert.equal(result.text, text);
        assert.deepEqual(pages.offsets, [0]);
    });

    it('works with pages smaller than the firmware page size', async () => {
        const pages = pagesFake(blobBuild(text), 180);
        const result = await manifestDownload(pages.readPage, cacheFake());
        assert.equal(result.text, text);
    });

    it('ignores bytes past the payload length', async () => {
        const blob = new Uint8Array([...blobBuild('{"v":1}'), 0, 0, 0]);
        const result = await manifestDownload(pagesFake(blob).readPage, cacheFake());
        assert.equal(result.text, '{"v":1}');
    });

    it('rejects a CRC mismatch and caches nothing', async () => {
        const cache = cacheFake();
        await assert.rejects(manifestDownload(pagesFake(blobBuild(text, {crc: 1})).readPage, cache), /CRC/);
        assert.equal(cache.store.size, 0);
    });

    it('rejects an unknown schema version and gzip encoding', async () => {
        await assert.rejects(manifestDownload(pagesFake(blobBuild(text, {schema: 2})).readPage, cacheFake()), /schema/);
        await assert.rejects(manifestDownload(pagesFake(blobBuild(text, {encoding: 1})).readPage, cacheFake()), /encoding/);
    });

    it('rejects an empty page before the end', async () => {
        const blob = blobBuild(text);
        const readPage = async offset => (offset === 0 ? blob.slice(0, 500) : new Uint8Array(0));
        await assert.rejects(manifestDownload(readPage, cacheFake()), /empty/);
    });

    it('rejects a header that is too short', async () => {
        await assert.rejects(manifestDownload(async () => new Uint8Array([1, 0]), cacheFake()), /header/);
    });
});

describe('manifestCacheCreate', () => {
    /**
     * Minimal localStorage stand-in
     * @returns {Storage}
     */
    function storageFake()
    {
        const data = new Map();
        return {
            getItem: key => data.get(key) ?? null,
            setItem: (key, value) => data.set(key, String(value)),
        };
    }

    it('stores and returns a payload by CRC', () => {
        const cache = manifestCacheCreate(storageFake());
        cache.set(0xCBF43926, '{"v":1}');
        assert.equal(cache.get(0xCBF43926), '{"v":1}');
        assert.equal(cache.get(1), null);
    });

    it('keeps only the newest entries', () => {
        const cache = manifestCacheCreate(storageFake());
        for (let crc = 1; crc <= 7; crc++) {
            cache.set(crc, 'text ' + crc);
        }
        assert.equal(cache.get(1), null);
        assert.equal(cache.get(2), null);
        assert.equal(cache.get(3), 'text 3');
        assert.equal(cache.get(7), 'text 7');
    });

    it('works without storage and when storage throws', () => {
        const throwing = {
            getItem() {
                throw new Error('blocked');
            },
            setItem() {
                throw new Error('blocked');
            },
        };
        [null, throwing].forEach((storage) => {
            const cache = manifestCacheCreate(storage);
            cache.set(1, 'x');
            assert.equal(cache.get(1), null);
        });
    });

    it('ignores a corrupt stored value', () => {
        const storage = storageFake();
        storage.setItem('rc-manifest-cache', 'not json');
        assert.equal(manifestCacheCreate(storage).get(1), null);
    });
});

describe('gridParse', () => {
    it('gives each key its rectangle (1-based CSS lines)', () => {
        const layout = gridParse(['a a b', 'c c b'], ['a', 'b', 'c']);

        assert.equal(layout.auto, false);
        assert.equal(layout.columns, 3);
        assert.equal(layout.rows, 2);
        assert.deepEqual(layout.areas, [
            {key: 'a', row: 1, column: 1, rowSpan: 1, columnSpan: 2},
            {key: 'b', row: 1, column: 3, rowSpan: 2, columnSpan: 1},
            {key: 'c', row: 2, column: 1, rowSpan: 1, columnSpan: 2},
        ]);
        assert.deepEqual(layout.warnings, []);
    });

    it('leaves . slots and keys without a cell empty', () => {
        const layout = gridParse(['a . x', 'a b b'], ['a', 'b']);
        assert.equal(layout.auto, false);
        assert.deepEqual(layout.areas.map(area => area.key), ['a', 'b']);
        assert.match(layout.warnings.join(), /x/);
    });

    it('accepts multi-character keys and extra spaces', () => {
        const layout = gridParse(['  drive   speed ', 'drive speed'], ['drive', 'speed']);
        assert.deepEqual(layout.areas[0], {key: 'drive', row: 1, column: 1, rowSpan: 2, columnSpan: 1});
    });

    it('does not show a cell that is not in the grid', () => {
        const layout = gridParse(['a'], ['a', 'z']);
        assert.deepEqual(layout.areas.map(area => area.key), ['a']);
        assert.match(layout.warnings.join(), /z/);
    });

    it('falls back to an automatic layout for ragged rows', () => {
        const layout = gridParse(['a b', 'a'], ['a', 'b']);
        assert.equal(layout.auto, true);
        assert.match(layout.warnings.join(), /row/);
    });

    it('falls back to an automatic layout for a key that is not one rectangle', () => {
        ['a b a', 'a b|b a'].forEach((rows) => {
            const layout = gridParse(rows.split('|'), ['a', 'b']);
            assert.equal(layout.auto, true);
            assert.match(layout.warnings.join(), /rectangle/);
        });
    });

    it('falls back to an automatic layout for grids over 12 x 12 or no grid', () => {
        assert.equal(gridParse(['a '.repeat(13)], ['a']).auto, true);
        assert.equal(gridParse(Array(13).fill('a'), ['a']).auto, true);
        assert.equal(gridParse(undefined, ['a']).auto, true);
        assert.equal(gridParse([], ['a']).auto, true);
        assert.equal(gridParse([42], ['a']).auto, true);
    });

    it('lays the cells out in key order in the automatic layout', () => {
        const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        const layout = gridParse(['a b', 'a'], keys);
        assert.equal(layout.columns, 6);
        assert.equal(layout.rows, 2);
        assert.deepEqual(layout.areas.map(area => [area.key, area.row, area.column]), [
            ['a', 1, 1],
            ['b', 1, 2],
            ['c', 1, 3],
            ['d', 1, 4],
            ['e', 1, 5],
            ['f', 1, 6],
            ['g', 2, 1],
        ]);
    });
});

describe('manifestValidate', () => {
    it('accepts the legacy manifest without warnings', () => {
        const manifest = manifestValidate(MANIFEST_LEGACY);
        assert.deepEqual(manifest.warnings, []);
        assert.equal(manifest.layout.auto, false);
        assert.deepEqual(Object.keys(manifest.cells).sort(), ['A', 'H', 'L', 'M', 'O', 'd', 'h', 'm', 's', 'v', 'x']);
    });

    it('rejects an unknown schema version', () => {
        assert.throws(() => manifestValidate({v: 2, status: [], grid: [], cells: {}}), /schema/);
        assert.throws(() => manifestValidate(null), /schema/);
    });

    it('skips unknown types and incomplete cells, their area stays empty', () => {
        const manifest = manifestValidate({
            v: 1,
            status: [],
            grid: ['a b c'],
            cells: {
                a: {type: 'button', cmd: 'X'},
                b: {type: 'laser', cmd: 'Z'},
                c: {type: 'toggle', on: 'Q'},
            },
        });
        assert.deepEqual(Object.keys(manifest.cells), ['a']);
        assert.equal(manifest.layout.auto, false);
        assert.deepEqual(manifest.layout.areas.map(area => area.key), ['a']);
        assert.match(manifest.warnings.join(), /laser/);
        assert.match(manifest.warnings.join(), /c/);
    });

    it('skips invalid status descriptors', () => {
        const manifest = manifestValidate({
            v: 1,
            status: [
                {id: 'ok', src: 'ffe3', at: 0, t: 'u8'},
                {id: 'type', src: 'ffe3', at: 0, t: 'u32'},
                {id: 'bit', src: 'ffe3', at: 0, t: 'bit', bit: 8},
                {id: 'at', src: 'ffe3', at: -1, t: 'u8'},
            ],
            grid: [],
            cells: {},
        });
        assert.deepEqual(manifest.status.map(descriptor => descriptor.id), ['ok']);
        assert.equal(manifest.warnings.filter(warning => /status/.test(warning)).length, 3);
    });

    it('fills in car defaults and the watchdog timeouts', () => {
        const manifest = manifestValidate({v: 1, status: [], grid: [], cells: {}});
        assert.deepEqual(manifest.car, {id: null, name: null, fw: null, watchdog: {drive: 500, horn: 1000}});

        const car = manifestValidate({
            v: 1,
            car: {id: 'a1b2c3d4e5f6', name: 'Car black', fw: '1.4.0', watchdog: {drive: 300, horn: 'x'}},
            status: [],
            grid: [],
            cells: {},
        }).car;
        assert.deepEqual(car, {id: 'a1b2c3d4e5f6', name: 'Car black', fw: '1.4.0', watchdog: {drive: 300, horn: 1000}});
    });
});

describe('statusDecode', () => {
    const status = manifestValidate(MANIFEST_LEGACY).status;

    it('decodes the legacy status packet like the old statusParse()', () => {
        // FORWARD_RIGHT, motor 150, cruise 150, autopilot + front light, 7420 mV, 85 %
        assert.deepEqual(statusDecode(status, 'ffe3', dataView([6, 150, 150, 0x03, 0xFC, 0x1C, 85])), {
            drive: 'FR',
            motor: 150,
            cruise: 150,
            autopilot: true,
            lightFront: true,
            lightRear: false,
            horn: false,
            obstacleStop: false,
            madMax: false,
            battery: 7420,
            batteryPct: 85,
        });
    });

    it('maps every firmware drive state value', () => {
        ['S', 'F', 'B', 'L', 'R', 'FL', 'FR', 'BL', 'BR'].forEach((drive, value) => {
            assert.equal(statusDecode(status, 'ffe3', dataView([value, 0, 60, 0, 0, 0, 0])).drive, drive);
        });
    });

    it('reports an unknown enum value as ?', () => {
        assert.equal(statusDecode(status, 'ffe3', dataView([9, 0, 60, 0, 0, 0, 0])).drive, '?');
    });

    it('reads the obstacle stop (bit 4) and Mad Max (bit 5) flags', () => {
        const values = statusDecode(status, 'ffe3', dataView([1, 250, 110, 0x30, 0, 0, 0]));
        assert.equal(values.obstacleStop, true);
        assert.equal(values.madMax, true);
        assert.equal(values.autopilot, false);
        assert.equal(values.motor, 250);
        assert.equal(values.cruise, 110);
    });

    it('decodes the distance from its own characteristic', () => {
        assert.deepEqual(statusDecode(status, 'ffe2', dataView([0x90, 0x01])), {distance: 400});
        assert.deepEqual(statusDecode(status, 'ffe2', dataView([42, 0])), {distance: 42});
    });

    it('ignores extra bytes', () => {
        assert.equal(statusDecode(status, 'ffe3', dataView([1, 60, 60, 0, 0, 0, 0, 99])).drive, 'F');
    });

    it('leaves out values past the end of a short packet', () => {
        const values = statusDecode(status, 'ffe3', dataView([0, 0, 60, 0, 0x10]));
        assert.equal(values.drive, 'S');
        assert.equal('battery' in values, false);
        assert.equal('batteryPct' in values, false);
    });
});

describe('speedLevels / speedIndexFromPwm', () => {
    const levels = speedLevels(MANIFEST_LEGACY.cells.s.keys);

    it('orders the keys by PWM', () => {
        assert.deepEqual(levels.map(level => level.key), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
        assert.equal(levels[9].pwm, 250);
    });

    it('maps the cruise PWM to the closest level', () => {
        assert.equal(speedIndexFromPwm(levels, 60), 0);
        assert.equal(speedIndexFromPwm(levels, 150), 4);
        assert.equal(speedIndexFromPwm(levels, 250), 9);
        assert.equal(speedIndexFromPwm(levels, 0), 0);
        assert.equal(speedIndexFromPwm(levels, 255), 9);
        assert.equal(speedIndexFromPwm(levels, 99), 1);
        assert.equal(speedIndexFromPwm(levels, 101), 2);
        // Tie between 90 and 110: the slower level
        assert.equal(speedIndexFromPwm(levels, 100), 1);
    });
});

describe('manifestDpads', () => {
    it('combines dpad cells with the same id and merges their commands', () => {
        const cells = manifestValidate(MANIFEST_LEGACY).cells;
        const dpads = manifestDpads(cells);

        assert.deepEqual([...dpads.keys()], ['drive']);
        assert.deepEqual(dpads.get('drive').keys, ['v', 'h']);
        assert.deepEqual(dpads.get('drive').cmd, {F: 'F', B: 'B', FL: 'G', FR: 'I', BL: 'H', BR: 'J', stop: 'S', L: 'L', R: 'R'});
    });

    it('keeps a dpad without an id on its own, by key', () => {
        const cells = manifestValidate({v: 1, grid: ['p'], cells: {p: {type: 'dpad', cmd: {F: 'F', stop: 'S'}}}}).cells;
        const dpads = manifestDpads(cells);
        assert.deepEqual([...dpads.keys()], ['p']);
    });
});

describe('driveCommand', () => {
    const cmd = {F: 'F', B: 'B', L: 'L', R: 'R', FR: 'I', stop: 'S'};

    it('maps a drive state to its command', () => {
        assert.equal(driveCommand(cmd, 'F'), 'F');
        assert.equal(driveCommand(cmd, 'FR'), 'I');
        assert.equal(driveCommand(cmd, 'S'), 'S');
    });

    it('falls back to forward / backward when a diagonal has no command', () => {
        assert.equal(driveCommand(cmd, 'BL'), 'B');
    });

    it('returns null when nothing matches', () => {
        assert.equal(driveCommand({stop: 'S'}, 'L'), null);
        assert.equal(driveCommand({}, 'S'), null);
    });
});

describe('manifestCommandGroups', () => {
    it('collects the drive letters and speed keys for the command queue', () => {
        const groups = manifestCommandGroups(manifestValidate(MANIFEST_LEGACY));
        assert.deepEqual([...groups.drive].sort(), ['B', 'F', 'G', 'H', 'I', 'J', 'L', 'R', 'S']);
        assert.deepEqual([...groups.speed].sort(), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    });
});
