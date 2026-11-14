/**
 * Terminal log screen and error logging.
 */
import {LOG_TYPE} from './constants.js';

/** @type {HTMLElement|null} */
let appLog = null;

/**
 * Find the terminal log element
 * @returns {void}
 */
export function logInit()
{
    appLog = document.getElementById('app-log');
}

/**
 * Scroll the terminal log to the newest entry
 * @returns {void}
 */
export function logScrollToEnd()
{
    appLog.scrollTo(0, appLog.scrollHeight);
}

/**
 * Add log entry
 * @param {string} text
 * @param {LogType} logType
 * @returns {void}
 */
export function addLogEntry(text, logType = LOG_TYPE.STANDARD)
{
    let prefix = '';
    if (window.Intl && window.Intl.DateTimeFormat) {
        prefix += new window.Intl.DateTimeFormat('default', {
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hour12: false,
        }).format(new Date());
    }

    switch (logType) {
        case LOG_TYPE.RECEIVE:
            prefix += ' < ';
            break;
        case LOG_TYPE.SEND:
            prefix += ' > ';
            break;
        default:
            prefix += ' - ';
            break;
    }

    const item = document.createElement('li');
    item.textContent = prefix + text;
    appLog.appendChild(item);

    logScrollToEnd();
}

/**
 * Log errors to browser console and terminal
 * @param {string} errorText
 * @returns {void}
 */
export function errorLogger(errorText)
{
    window.console.error(errorText);
    addLogEntry(errorText);
}
