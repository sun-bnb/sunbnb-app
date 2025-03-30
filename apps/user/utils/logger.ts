/**
 * Our simplistic approach:
 * LOG_LEVEL can be 'debug', 'info', or 'error'.
 * You can expand to 'warn', 'trace', etc. as needed.
 */

// We define which levels are "above" or "equal" to debug
const debugLevels = ['debug']
const infoLevels = ['debug', 'info']

const LOG_LEVEL = process.env.NEXT_PUBLIC_LOG_LEVEL || 'info'

function debug(...args: any[]) {
  if (debugLevels.includes(LOG_LEVEL)) {
    console.debug('[DEBUG]', ...args);
  }
}

function info(...args: any[]) {
  if (infoLevels.includes(LOG_LEVEL)) {
    console.info('[INFO]', ...args);
  }
}

function error(...args: any[]) {
  // We always show errors regardless of log level
  console.error('[ERROR]', ...args);
}

// Export a simple logger object
export default {
  debug,
  info,
  error
};
