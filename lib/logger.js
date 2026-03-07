import path from 'path';
import pino from 'pino';

// ---------------------------------------------------------------------------
// Pino-based structured JSON-line file logger (singleton)
//
// External interface preserved exactly from the original implementation:
//   init({ command, workspace })
//   debug(msg, data), info(msg, data), warn(msg, data), error(msg, data)
//   close()
//   _reset()
//
// Log format uses pino with custom options to emit fields compatible with
// the existing log consumers:
//   { ts, level, command, message, [data] }
// ---------------------------------------------------------------------------

let logger = null;

function init({ command = '', workspace } = {}) {
  const level   = process.env.PM_LOG_LEVEL || 'info';
  const logPath = process.env.PM_LOG_FILE
    || (workspace ? path.join(workspace, 'logs', 'hal-project-manager.log') : null);

  const pinoOpts = {
    level,
    base:       { command },
    messageKey: 'message',
    timestamp:  () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level(label) { return { level: label }; },
    },
  };

  if (logPath) {
    let dest;
    try {
      dest   = pino.destination({ dest: logPath, append: true, mkdir: true, sync: true });
      logger = pino(pinoOpts, dest);
    } catch {
      // If we can't open the log destination, fall through to silent
      logger = pino({ level: 'silent' });
    }
  } else {
    logger = pino({ level: 'silent' });
  }
}

function _write(method, msg, data) {
  if (!logger) return;
  try {
    if (data != null) {
      logger[method]({ data }, msg);
    } else {
      logger[method](msg);
    }
  } catch { /* swallow — logging must never crash the CLI */ }
}

function debug(msg, data) { _write('debug', msg, data); }
function info(msg, data)  { _write('info',  msg, data); }
function warn(msg, data)  { _write('warn',  msg, data); }
function error(msg, data) { _write('error', msg, data); }

function close() {
  if (!logger) return;
  try {
    const stream = logger[pino.symbols.streamSym];
    if (stream && typeof stream.end === 'function') {
      stream.end();
    }
  } catch { /* ignore */ }
  logger = null;
}

function _reset() {
  close();
  logger = null;
}

export { init, debug, info, warn, error, close, _reset };
