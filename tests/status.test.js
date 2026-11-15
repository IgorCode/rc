import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {cruiseSpeedToLevel, distanceParse, statusParse, versionParse} from '../src/assets/js/status.js';
import {CRUISE_SPEEDS, DRIVE_STATE, STATUS_FLAG} from '../src/assets/js/constants.js';

/**
 * Wrap bytes in a DataView, like a characteristic value
 * @param {number[]} bytes
 * @returns {DataView}
 */
function dataView(bytes)
{
    return new DataView(new Uint8Array(bytes).buffer);
}

describe('statusParse', () => {
    it('parses a full status packet', () => {
        // FORWARD_RIGHT, motor 150, cruise 150 (level 5), autopilot + front light, 7420 mV, 85 %
        const status = statusParse(dataView([6, 150, 150, STATUS_FLAG.AUTOPILOT | STATUS_FLAG.LIGHT_FRONT, 0xFC, 0x1C, 85]));

        assert.deepEqual(status, {
            drive: DRIVE_STATE.FORWARD_RIGHT,
            driveSpeed: 150,
            speed: 5,
            flags: 0x03,
            batteryMv: 7420,
            batteryPercent: 85,
        });
    });

    it('maps every firmware drive state value', () => {
        const expected = ['S', 'F', 'B', 'L', 'R', 'FL', 'FR', 'BL', 'BR'];
        expected.forEach((drive, value) => {
            assert.equal(statusParse(dataView([value, 0, 60, 0, 0, 0, 0])).drive, drive);
        });
    });

    it('reports an unknown drive state as ?', () => {
        assert.equal(statusParse(dataView([9, 0, 60, 0, 0, 0, 0])).drive, '?');
    });

    it('returns null for a packet shorter than 7 bytes', () => {
        assert.equal(statusParse(dataView([0, 0, 60, 0, 0, 0])), null);
    });

    it('keeps the obstacle stop flag (bit 4)', () => {
        const status = statusParse(dataView([0, 0, 60, STATUS_FLAG.OBSTACLE_STOP | STATUS_FLAG.HORN, 0, 0, 0]));
        assert.equal(STATUS_FLAG.OBSTACLE_STOP, 0x10);
        assert.equal(status.flags & STATUS_FLAG.OBSTACLE_STOP, STATUS_FLAG.OBSTACLE_STOP);
        assert.equal(status.flags & STATUS_FLAG.AUTOPILOT, 0);
    });

    it('ignores extra bytes', () => {
        assert.equal(statusParse(dataView([1, 60, 60, 0, 0, 0, 0, 99])).drive, DRIVE_STATE.FORWARD);
    });
});

describe('cruiseSpeedToLevel', () => {
    it('maps each firmware cruise speed to its level 1-10', () => {
        CRUISE_SPEEDS.forEach((pwm, index) => {
            assert.equal(cruiseSpeedToLevel(pwm), index + 1);
        });
    });

    it('clamps values outside the table', () => {
        assert.equal(cruiseSpeedToLevel(0), 1);
        assert.equal(cruiseSpeedToLevel(255), 10);
    });

    it('picks the closest level, the lower one on a tie', () => {
        assert.equal(cruiseSpeedToLevel(95), 2);
        assert.equal(cruiseSpeedToLevel(105), 3);
        assert.equal(cruiseSpeedToLevel(100), 2);
    });
});

describe('distanceParse', () => {
    it('reads uint16 little-endian cm', () => {
        assert.equal(distanceParse(dataView([0x2A, 0x00])), 42);
        assert.equal(distanceParse(dataView([0x90, 0x01])), 400);
    });
});

describe('versionParse', () => {
    it('decodes the ASCII version', () => {
        assert.equal(versionParse(dataView([...Buffer.from('1.1.0')])), '1.1.0');
    });

    it('cuts at the first NUL and trims whitespace', () => {
        assert.equal(versionParse(dataView([...Buffer.from(' 1.2.3 '), 0, 0, 65])), '1.2.3');
    });
});
