import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {formatBattery, formatDistance, formatMotor} from '../src/assets/js/ui.js';

describe('formatDistance', () => {
    it('shows a dash without data', () => {
        assert.equal(formatDistance(null), '—');
    });

    it('shows cm below the maximum', () => {
        assert.equal(formatDistance(42), '42 cm');
        assert.equal(formatDistance(399), '399 cm');
    });

    it('shows 400+ at or above the maximum (nothing in range)', () => {
        assert.equal(formatDistance(400), '400+ cm');
        assert.equal(formatDistance(500), '400+ cm');
    });
});

describe('formatMotor', () => {
    it('shows a dash without status', () => {
        assert.equal(formatMotor(null), '—');
    });

    it('shows motor PWM as a percentage of 250', () => {
        assert.equal(formatMotor({driveSpeed: 0}), '0%');
        assert.equal(formatMotor({driveSpeed: 60}), '24%');
        assert.equal(formatMotor({driveSpeed: 125}), '50%');
        assert.equal(formatMotor({driveSpeed: 250}), '100%');
    });
});

describe('formatBattery', () => {
    it('is empty without status or with an unknown voltage', () => {
        assert.equal(formatBattery(null), '');
        assert.equal(formatBattery({batteryMv: 0, batteryPercent: 50}), '');
    });

    it('shows percent and volts', () => {
        assert.equal(formatBattery({batteryMv: 7420, batteryPercent: 85}), '85% (7.42 V)');
    });
});
