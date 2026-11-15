import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {controlsHelpItems, formatBattery, formatSpeed, formatStatusValue} from '../src/assets/js/ui.js';
import {manifestValidate} from '../src/assets/js/manifest.js';
import {MANIFEST_LEGACY} from '../src/assets/js/manifest-legacy.js';

const legacy = manifestValidate(MANIFEST_LEGACY);

/**
 * Status descriptor of the legacy manifest
 * @param {string} id
 * @returns {StatusDescriptor}
 */
function descriptor(id)
{
    return legacy.status.find(item => item.id === id);
}

describe('formatStatusValue', () => {
    it('shows a dash without a value', () => {
        assert.equal(formatStatusValue(descriptor('distance'), undefined), '—');
        assert.equal(formatStatusValue(descriptor('motor'), null), '—');
    });

    it('shows the front distance in cm, 400+ at or above the sentinel (nothing in range)', () => {
        assert.equal(formatStatusValue(descriptor('distance'), 42), '42 cm');
        assert.equal(formatStatusValue(descriptor('distance'), 399), '399 cm');
        assert.equal(formatStatusValue(descriptor('distance'), 400), '400+ cm');
        assert.equal(formatStatusValue(descriptor('distance'), 500), '400+ cm');
    });

    it('shows the motor PWM as a percentage of max', () => {
        assert.equal(formatStatusValue(descriptor('motor'), 0), '0%');
        assert.equal(formatStatusValue(descriptor('motor'), 60), '24%');
        assert.equal(formatStatusValue(descriptor('motor'), 125), '50%');
        assert.equal(formatStatusValue(descriptor('motor'), 250), '100%');
    });

    it('shows enum names, bits as On / Off', () => {
        assert.equal(formatStatusValue(descriptor('drive'), 'FR'), 'FR');
        assert.equal(formatStatusValue(descriptor('horn'), true), 'On');
        assert.equal(formatStatusValue(descriptor('horn'), false), 'Off');
    });

    it('shows a generic value with its unit, and a dash for a generic sentinel', () => {
        assert.equal(formatStatusValue({id: 'temp', unit: '°C'}, 21), '21 °C');
        assert.equal(formatStatusValue({id: 'level', unit: '%'}, 7), '7%');
        assert.equal(formatStatusValue({id: 'count'}, 3), '3');
        assert.equal(formatStatusValue({id: 'rpm', none: 65535, unit: 'rpm'}, 65535), '—');
    });
});

describe('formatSpeed', () => {
    it('shows the selected level', () => {
        assert.equal(formatSpeed(1, false), '1');
        assert.equal(formatSpeed(10, false), '10');
    });

    it('shows MAX while Mad Max overrides the selection', () => {
        assert.equal(formatSpeed(3, true), 'MAX');
    });
});

describe('formatBattery', () => {
    it('is empty without values or with an unknown voltage', () => {
        assert.equal(formatBattery(null), '');
        assert.equal(formatBattery({}), '');
        assert.equal(formatBattery({battery: 0, batteryPct: 50}), '');
    });

    it('shows percent and volts', () => {
        assert.equal(formatBattery({battery: 7420, batteryPct: 85}), '85% (7.42 V)');
    });

    it('shows volts alone without a percentage', () => {
        assert.equal(formatBattery({battery: 7420}), '7.42 V');
    });
});

describe('controlsHelpItems', () => {
    it('lists the buttons in grid order with their label and title', () => {
        assert.deepEqual(controlsHelpItems(legacy), [
            {label: 'A', text: 'Autopilot'},
            {label: 'L', text: 'Lights'},
            {label: 'H', text: 'Horn (hold)'},
            {label: 'O', text: 'Obstacle stop'},
            {label: 'M', text: 'Mad Max'},
        ]);
    });

    it('marks hold buttons and uses the label over the key', () => {
        const manifest = manifestValidate({
            v: 1,
            grid: ['h b d'],
            cells: {
                h: {type: 'hold', press: 'V', title: 'Horn'},
                b: {type: 'button', cmd: 'Z', label: 'Zz', title: 'Zap'},
                d: {type: 'display', status: 'motor', title: 'Motor'},
            },
        });
        assert.deepEqual(controlsHelpItems(manifest), [
            {label: 'h', text: 'Horn (hold)'},
            {label: 'Zz', text: 'Zap'},
        ]);
    });
});
