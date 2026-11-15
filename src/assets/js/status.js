/**
 * Parsing of the firmware version the car sends. The status and distance values are decoded
 * with the car's manifest (statusDecode() in manifest.js). No DOM access.
 */

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
