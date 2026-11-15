import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {versionParse} from '../src/assets/js/status.js';

/**
 * Wrap bytes in a DataView, like a characteristic value
 * @param {number[]} bytes
 * @returns {DataView}
 */
function dataView(bytes)
{
    return new DataView(new Uint8Array(bytes).buffer);
}

// The status and distance values are decoded with the manifest, see manifest.test.js (statusDecode)

describe('versionParse', () => {
    it('decodes the ASCII version', () => {
        assert.equal(versionParse(dataView([...Buffer.from('1.1.0')])), '1.1.0');
    });

    it('cuts at the first NUL and trims whitespace', () => {
        assert.equal(versionParse(dataView([...Buffer.from(' 1.2.3 '), 0, 0, 65])), '1.2.3');
    });
});
