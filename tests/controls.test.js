import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {directionFromPressed} from '../src/assets/js/controls.js';
import {COMMAND} from '../src/assets/js/constants.js';

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
