/**
 * Built-in manifest for car firmware without the manifest characteristic (0xFFE5, firmware 1.3.x
 * and older). Same schema as the manifest the car sends (car-black#31), matching the controls and
 * telemetry those firmwares have. The car fields stay unknown.
 * No DOM access, so it can be imported in Node tests.
 */
export const MANIFEST_LEGACY = Object.freeze({
    v: 1,
    car: {watchdog: {drive: 500, horn: 1000}},
    status: [
        {id: 'drive', src: 'ffe3', at: 0, t: 'u8', enum: ['S', 'F', 'B', 'L', 'R', 'FL', 'FR', 'BL', 'BR']},
        {id: 'motor', src: 'ffe3', at: 1, t: 'u8', max: 250},
        {id: 'cruise', src: 'ffe3', at: 2, t: 'u8', max: 250},
        {id: 'autopilot', src: 'ffe3', at: 3, t: 'bit', bit: 0},
        {id: 'lightFront', src: 'ffe3', at: 3, t: 'bit', bit: 1},
        {id: 'lightRear', src: 'ffe3', at: 3, t: 'bit', bit: 2},
        {id: 'horn', src: 'ffe3', at: 3, t: 'bit', bit: 3},
        {id: 'obstacleStop', src: 'ffe3', at: 3, t: 'bit', bit: 4},
        {id: 'madMax', src: 'ffe3', at: 3, t: 'bit', bit: 5},
        {id: 'battery', src: 'ffe3', at: 4, t: 'u16le', unit: 'mV'},
        {id: 'batteryPct', src: 'ffe3', at: 6, t: 'u8', unit: '%', max: 100},
        {id: 'distance', src: 'ffe2', at: 0, t: 'u16le', unit: 'cm', none: 400},
    ],
    // The layout before the manifest: displays left / center / right, then forward / back on the left
    // next to the speed picker, left / right (twice as tall) and the toggles
    grid: [
        'd d . m . . x',
        'v v s s s s s',
        'v v h h h h h',
        'v v h h h h h',
        'v v A L H O M',
    ],
    cells: {
        d: {type: 'display', status: 'drive', title: 'Direction'},
        m: {type: 'display', status: 'motor', title: 'Motor speed'},
        x: {type: 'display', status: 'distance', title: 'Front distance'},
        v: {
            type: 'dpad',
            id: 'drive',
            axis: 'v',
            cmd: {F: 'F', B: 'B', FL: 'G', FR: 'I', BL: 'H', BR: 'J', stop: 'S'},
        },
        h: {type: 'dpad', id: 'drive', axis: 'h', cmd: {L: 'L', R: 'R'}},
        s: {
            type: 'speed',
            id: 'speed',
            title: 'Speed',
            keys: {1: 60, 2: 90, 3: 110, 4: 130, 5: 150, 6: 170, 7: 190, 8: 210, 9: 230, 0: 250},
        },
        A: {type: 'toggle', id: 'autopilot', title: 'Autopilot', on: 'X', off: 'x', status: 'autopilot'},
        L: {type: 'toggle', id: 'lights', title: 'Lights', on: 'W', off: 'w', status: 'lightFront'},
        H: {type: 'hold', id: 'horn', title: 'Horn (hold)', press: 'V', release: 'v'},
        O: {type: 'toggle', id: 'obstacleStop', title: 'Obstacle stop', on: 'C', off: 'c', status: 'obstacleStop'},
        M: {
            type: 'toggle',
            id: 'madMax',
            title: 'Mad Max',
            on: 'M',
            off: 'm',
            status: 'madMax',
            danger: true,
            overrides: 'speed',
        },
    },
});
