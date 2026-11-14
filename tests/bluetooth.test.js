import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {encodeCommand, promiseTimeout} from '../src/assets/js/bluetooth.js';

describe('encodeCommand', () => {
    it('sends a command alone as its ASCII bytes', () => {
        assert.deepEqual([...encodeCommand('F')], [0x46]);
    });

    it('sends a byte array payload as cmd=<bytes>;', () => {
        assert.deepEqual([...encodeCommand('4', [255, 0, 16])], [0x34, 0x3D, 255, 0, 16, 0x3B]);
    });

    it('sends a number payload as one byte', () => {
        assert.deepEqual([...encodeCommand('A', 7)], [0x41, 0x3D, 7, 0x3B]);
    });

    it('sends a string payload as its ASCII bytes', () => {
        assert.deepEqual([...encodeCommand('A', 'bc')], [0x41, 0x3D, 0x62, 0x63, 0x3B]);
    });
});

describe('promiseTimeout', () => {
    it('resolves with the value when the promise settles in time', async () => {
        assert.equal(await promiseTimeout(Promise.resolve(42), 1000, 'too slow'), 42);
    });

    it('rejects with the message when the promise takes too long', async () => {
        const never = new Promise(() => null);
        await assert.rejects(promiseTimeout(never, 10, 'too slow'), {message: 'too slow'});
    });

    it('passes on the rejection of the promise', async () => {
        await assert.rejects(promiseTimeout(Promise.reject(new Error('failed')), 1000, 'too slow'), {message: 'failed'});
    });
});
