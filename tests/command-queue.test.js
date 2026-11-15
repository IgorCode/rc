import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {commandGroup, commandQueueAdd, commandQueueCreate} from '../src/assets/js/command-queue.js';

/**
 * Queue entry for the pure commandQueueAdd() tests
 * @param {string} cmd
 * @param {*} [data]
 * @param {boolean} [log]
 * @returns {QueuedCommand}
 */
function entry(cmd, data, log = true)
{
    return {cmd, data, log, done: []};
}

/**
 * Write function whose writes stay in flight until released by the test
 * @returns {{write: function(QueuedCommand): Promise<void>, written: string[], release: function(): Promise<void>}}
 */
function controlledWriter()
{
    const written = [];
    const waiting = [];
    return {
        written,
        write(item) {
            written.push(item.cmd);
            return new Promise(resolve => waiting.push(resolve));
        },
        async release() {
            waiting.shift()();
            // Let the queue's await continue to the next write
            await new Promise(resolve => setImmediate(resolve));
        },
    };
}

describe('commandGroup', () => {
    it('puts all drive state letters in one group, including the stop', () => {
        for (const cmd of ['S', 'F', 'I', 'R', 'J', 'B', 'H', 'L', 'G']) {
            assert.equal(commandGroup(cmd), 'drive', cmd);
        }
    });

    it('puts the speed digits in one group', () => {
        assert.equal(commandGroup('1'), 'speed');
        assert.equal(commandGroup('0'), 'speed');
    });

    it('groups a payload command by its command', () => {
        assert.equal(commandGroup('4', [255, 0, 0]), 'data:4');
    });

    it('does not group toggles and the horn', () => {
        for (const cmd of ['X', 'x', 'W', 'w', 'V', 'v', 'C', 'c', 'M', 'm']) {
            assert.equal(commandGroup(cmd), null, cmd);
        }
    });

    it('uses the drive letters and speed keys of the manifest when given', () => {
        const groups = {drive: new Set(['u', 'd', '_']), speed: new Set(['a', 'b'])};
        assert.equal(commandGroup('u', undefined, groups), 'drive');
        assert.equal(commandGroup('_', undefined, groups), 'drive');
        assert.equal(commandGroup('b', undefined, groups), 'speed');
        assert.equal(commandGroup('F', undefined, groups), null);
        assert.equal(commandGroup('1', undefined, groups), null);
    });
});

describe('commandQueueAdd', () => {
    it('replaces a pending drive state with the newer one in its place', () => {
        const queue = [entry('F'), entry('W')];
        commandQueueAdd(queue, entry('S'));
        assert.deepEqual(queue.map(item => item.cmd), ['S', 'W']);
    });

    it('replaces a pending speed and payload', () => {
        const queue = [entry('3'), entry('4', [1, 2, 3])];
        commandQueueAdd(queue, entry('5'));
        commandQueueAdd(queue, entry('4', [9, 9, 9]));
        assert.deepEqual(queue.map(item => [item.cmd, item.data]), [['5', undefined], ['4', [9, 9, 9]]]);
    });

    it('keeps toggle on and off as separate commands', () => {
        const queue = [entry('X')];
        commandQueueAdd(queue, entry('x'));
        assert.deepEqual(queue.map(item => item.cmd), ['X', 'x']);
    });

    it('does not add a command that is already pending twice', () => {
        const queue = [entry('V', undefined, false)];
        commandQueueAdd(queue, entry('V', undefined, false));
        assert.equal(queue.length, 1);
    });

    it('keeps logging and all waiting callers of merged commands', () => {
        const first = () => null;
        const second = () => null;
        const queue = [{cmd: 'F', data: undefined, log: true, done: [first]}];
        commandQueueAdd(queue, {cmd: 'F', data: undefined, log: false, done: [second]});
        assert.equal(queue[0].log, true);
        assert.deepEqual(queue[0].done, [first, second]);
    });
});

describe('commandQueueCreate', () => {
    it('merges by the groups set with setGroups()', async () => {
        const writer = controlledWriter();
        const queue = commandQueueCreate(item => writer.write(item), assert.fail);
        queue.setGroups({drive: new Set(['u', 'd', '_']), speed: new Set()});

        queue.add('u', undefined, true);
        queue.add('d', undefined, true);
        queue.add('_', undefined, true);

        await writer.release();
        await writer.release();
        assert.deepEqual(writer.written, ['u', '_']);
    });

    it('writes one command at a time, in order', async () => {
        const writer = controlledWriter();
        const queue = commandQueueCreate(item => writer.write(item), assert.fail);

        queue.add('W', undefined, true);
        queue.add('X', undefined, true);
        assert.deepEqual(writer.written, ['W']);

        await writer.release();
        assert.deepEqual(writer.written, ['W', 'X']);
        await writer.release();
        assert.equal(queue.size(), 0);
    });

    it('does not drop the release stop while a write is in flight', async () => {
        const writer = controlledWriter();
        const queue = commandQueueCreate(item => writer.write(item), assert.fail);

        queue.add('F', undefined, true);
        queue.add('I', undefined, true);
        queue.add('S', undefined, true);

        await writer.release();
        await writer.release();
        assert.deepEqual(writer.written, ['F', 'S']);
    });

    it('resolves each caller once its command, or the one it merged into, is written', async () => {
        const writer = controlledWriter();
        const queue = commandQueueCreate(item => writer.write(item), assert.fail);
        const resolved = [];

        queue.add('F', undefined, true).then(() => resolved.push('F'));
        queue.add('I', undefined, true).then(() => resolved.push('I'));
        queue.add('S', undefined, true).then(() => resolved.push('S'));

        await writer.release();
        assert.deepEqual(resolved, ['F']);
        await writer.release();
        assert.deepEqual(resolved, ['F', 'I', 'S']);
    });

    it('reports a failed write and goes on with the next command', async () => {
        const errors = [];
        const written = [];
        const queue = commandQueueCreate(async (item) => {
            written.push(item.cmd);
            if (item.cmd === 'W') {
                throw new Error('write failed');
            }
        }, error => errors.push(error.message));

        await Promise.all([queue.add('W', undefined, true), queue.add('X', undefined, true)]);
        assert.deepEqual(written, ['W', 'X']);
        assert.deepEqual(errors, ['write failed']);
    });

    it('drops and resolves pending commands on clear', async () => {
        const writer = controlledWriter();
        const queue = commandQueueCreate(item => writer.write(item), assert.fail);

        queue.add('F', undefined, true);
        const pending = queue.add('W', undefined, true);
        queue.clear();
        await pending;
        assert.equal(queue.size(), 0);

        await writer.release();
        assert.deepEqual(writer.written, ['F']);
    });
});
