/**
 * Parsing of the data the car sends (status, distance, firmware version). No DOM access.
 */
import {CRUISE_SPEEDS, STATUS_DRIVE_STATES, STATUS_LENGTH} from './constants.js';

/**
 * Car status as reported by the status characteristic
 * @typedef {object} CarStatus
 * @property {DriveStateType|'?'} drive Actual drive state, '?' when the value is unknown
 * @property {number} driveSpeed Actual motor PWM, 0 when stopped
 * @property {number} speed Selected speed level 1-10
 * @property {number} flags STATUS_FLAG bits
 * @property {number} batteryMv Battery voltage in mV, 0 means unknown
 * @property {number} batteryPercent Battery estimate 0-100
 */

/**
 * Convert the status cruise speed (motor PWM) to the closest speed level 1-10
 * @param {number} pwm
 * @returns {number}
 */
export function cruiseSpeedToLevel(pwm)
{
    let level = 1;
    CRUISE_SPEEDS.forEach((speed, index) => {
        if (Math.abs(speed - pwm) < Math.abs(CRUISE_SPEEDS[level - 1] - pwm)) {
            level = index + 1;
        }
    });
    return level;
}

/**
 * Parse the status characteristic value
 * @param {DataView} value
 * @returns {CarStatus|null} null when the value is too short
 */
export function statusParse(value)
{
    if (value.byteLength < STATUS_LENGTH) {
        return null;
    }

    return {
        drive: STATUS_DRIVE_STATES[value.getUint8(0)] ?? '?',
        driveSpeed: value.getUint8(1),
        speed: cruiseSpeedToLevel(value.getUint8(2)),
        flags: value.getUint8(3),
        batteryMv: value.getUint16(4, true),
        batteryPercent: value.getUint8(6),
    };
}

/**
 * Parse the distance characteristic value (uint16 little-endian, cm)
 * @param {DataView} value
 * @returns {number}
 */
export function distanceParse(value)
{
    return value.getUint16(0, true);
}

/**
 * Parse the firmware version characteristic value (ASCII)
 * @param {DataView} value
 * @returns {string}
 */
export function versionParse(value)
{
    // Cut at the first NUL in case the firmware pads the string
    const text = new TextDecoder().decode(value);
    return text.split('\0')[0].trim();
}
