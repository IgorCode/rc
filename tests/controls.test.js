import {describe, it, mock} from 'node:test';
import assert from 'node:assert/strict';
import {directionFromPressed, keepaliveCreate, keepalivePeriod} from '../src/assets/js/controls.js';
import {COMMAND, WATCHDOG_DRIVE_TIMEOUT, WATCHDOG_HORN_TIMEOUT} from '../src/assets/js/constants.js';

describe('keepalivePeriod', () => {
    it('resends several times within the watchdog timeout', () => {
        assert.equal(keepalivePeriod(WATCHDOG_DRIVE_TIMEOUT), 166);
        assert.equal(keepalivePeriod(WATCHDOG_HORN_TIMEOUT), 333);
    });
});

describe('keepaliveCreate', () => {
    it('sends every period between start and stop', (t) => {
        t.mock.timers.enable({apis: ['setInterval']});
        const send = mock.fn();
        const keepalive = keepaliveCreate(send, 100);

        keepalive.start();
        assert.equal(keepalive.isRunning(), true);
        t.mock.timers.tick(350);
        assert.equal(send.mock.callCount(), 3);

        keepalive.stop();
        assert.equal(keepalive.isRunning(), false);
        t.mock.timers.tick(500);
        assert.equal(send.mock.callCount(), 3);
    });

    it('does not start a second timer when started again', (t) => {
        t.mock.timers.enable({apis: ['setInterval']});
        const send = mock.fn();
        const keepalive = keepaliveCreate(send, 100);

        keepalive.start();
        keepalive.start();
        t.mock.timers.tick(100);
        assert.equal(send.mock.callCount(), 1);
        keepalive.stop();
    });
});

describe('directionFromPressed', () => {
    const cases = [
        // forward, backward, left, right -> drive state
        [false, false, false, false, 'S'],
        [true, false, false, false, 'F'],
        [false, true, false, false, 'B'],
        [false, false, true, false, 'L'],
        [false, false, false, true, 'R'],
        [true, false, true, false, 'FL'],
        [true, false, false, true, 'FR'],
        [false, true, true, false, 'BL'],
        [false, true, false, true, 'BR'],
        // Forward wins over backward, left wins over right
        [true, true, false, false, 'F'],
        [false, false, true, true, 'L'],
        [true, true, true, true, 'FL'],
    ];

    for (const [forward, backward, left, right, expected] of cases) {
        it(`${JSON.stringify({forward, backward, left, right})} gives ${expected}`, () => {
            assert.equal(directionFromPressed({forward, backward, left, right}), expected);
        });
    }

    it('gives a drive state with a command letter for every button combination', () => {
        for (let i = 0; i < 16; i++) {
            const direction = directionFromPressed({
                forward: Boolean(i & 1),
                backward: Boolean(i & 2),
                left: Boolean(i & 4),
                right: Boolean(i & 8),
            });
            assert.ok(Object.hasOwn(COMMAND, direction), `no command for ${direction}`);
        }
    });
});
