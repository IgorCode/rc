/**
 * Send queue for the command characteristic. Web Bluetooth runs one GATT write at a time, so
 * commands wait here while a write is in flight instead of being dropped. Pending commands that
 * only matter as their latest value (drive state, speed, payload commands) are merged.
 * NOTE: No DOM access, so it can be imported in Node tests.
 */
import {COMMAND, DRIVE_STATE} from './constants.js';

/**
 * A command waiting to be written
 * @typedef {object} QueuedCommand
 * @property {string} cmd
 * @property {number|string|object|undefined} data Payload, sent as `cmd=<data>;`
 * @property {boolean} log Write it to the terminal log once sent
 * @property {Array<function(): void>} done Resolvers of the callers waiting for it
 */

/**
 * Command queue
 * @typedef {object} CommandQueue
 * @property {function(string, (number|string|object|undefined), boolean): Promise<void>} add Queue a command,
 *     resolves once it (or the command it was merged into) is written or dropped
 * @property {function(): void} clear Drop all pending commands, for example after a disconnect
 * @property {function(): number} size Number of pending commands, not counting the one in flight
 * @property {function(CommandGroups): void} setGroups Merge by the commands of the connected car's manifest
 */

/**
 * Commands that are merged with each other: drive states and speed keys
 * @typedef {object} CommandGroups
 * @property {Set<string>} drive
 * @property {Set<string>} speed
 */

/**
 * Defaults until a manifest sets the groups: the legacy drive letters (S F I R J B H L G) and speed digits
 * @type {CommandGroups}
 */
const DEFAULT_GROUPS = Object.freeze({
    drive: new Set(Object.values(DRIVE_STATE).map(state => COMMAND[state])),
    speed: new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']),
});

/**
 * Merge group of a command. A pending command of the same group is replaced by the newer one,
 * because only the latest drive state, speed or payload matters. The release `S` is a drive state,
 * so it is never dropped: it can only be replaced by a newer drive state.
 * @param {string} cmd
 * @param {number|string|object|undefined} data
 * @param {CommandGroups} [groups] Drive and speed commands, from the manifest
 * @returns {string|null} null when the command is not merged with other commands
 */
export function commandGroup(cmd, data, groups = DEFAULT_GROUPS)
{
    if (data !== undefined) {
        return 'data:' + cmd;
    }
    if (groups.drive.has(cmd)) {
        return 'drive';
    }
    if (groups.speed.has(cmd)) {
        return 'speed';
    }
    return null;
}

/**
 * Add a command to a queue of pending commands. A pending command of the same group takes the new
 * command's place in the queue (see commandGroup()), and a command without a group that is already
 * pending is not added twice (toggle on / off are different commands, so both stay).
 * @param {QueuedCommand[]} queue Pending commands, changed in place
 * @param {QueuedCommand} entry
 * @param {CommandGroups} [groups] Drive and speed commands, from the manifest
 * @returns {QueuedCommand} The entry the command ended up in, a pending one when it was merged
 */
export function commandQueueAdd(queue, entry, groups = DEFAULT_GROUPS)
{
    const group = commandGroup(entry.cmd, entry.data, groups);
    const pending = queue.find((item) => {
        if (group !== null) {
            return commandGroup(item.cmd, item.data, groups) === group;
        }
        return item.cmd === entry.cmd && item.data === undefined && entry.data === undefined;
    });

    if (!pending) {
        queue.push(entry);
        return entry;
    }

    pending.cmd = entry.cmd;
    pending.data = entry.data;
    pending.log = pending.log || entry.log;
    pending.done.push(...entry.done);
    return pending;
}

/**
 * Create a command queue that writes one command at a time
 * @param {function(QueuedCommand): Promise<void>} write Writes one command, the next one waits for it
 * @param {function(Error): void} onError Called when a write fails, the queue goes on with the next command
 * @returns {CommandQueue}
 */
export function commandQueueCreate(write, onError)
{
    const queue = [];
    let busy = false,
        groups = DEFAULT_GROUPS;

    /**
     * Write the pending commands one after another, unless that is already running
     * @returns {Promise<void>}
     */
    async function drain()
    {
        if (busy) {
            return;
        }
        busy = true;

        while (queue.length > 0) {
            const entry = queue.shift();
            try {
                await write(entry);
            } catch (error) {
                onError(error);
            }
            entry.done.forEach(resolve => resolve());
        }

        busy = false;
    }

    return {
        add(cmd, data, log) {
            return new Promise((resolve) => {
                commandQueueAdd(queue, {cmd, data, log, done: [resolve]}, groups);
                drain();
            });
        },
        clear() {
            queue.splice(0).forEach(entry => entry.done.forEach(resolve => resolve()));
        },
        size() {
            return queue.length;
        },
        setGroups(newGroups) {
            groups = newGroups;
        },
    };
}
