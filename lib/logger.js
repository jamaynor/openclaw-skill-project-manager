'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Structured JSON-line file logger (singleton)
// ---------------------------------------------------------------------------

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

let _logPath   = null;
let _fd        = null;
let _minLevel  = LEVELS.info;
let _command   = '';

function init({ command, workspace } = {}) {
  _command  = command || '';
  _minLevel = LEVELS[process.env.PM_LOG_LEVEL] != null
    ? LEVELS[process.env.PM_LOG_LEVEL]
    : LEVELS.info;
  _logPath  = process.env.PM_LOG_FILE
    || (workspace ? path.join(workspace, 'logs', 'project-manager.log') : null);
}

function _open() {
  if (_fd != null) return true;
  if (!_logPath) return false;
  try {
    fs.mkdirSync(path.dirname(_logPath), { recursive: true });
    _fd = fs.openSync(_logPath, 'a');
    return true;
  } catch {
    _logPath = null;          // disable further attempts
    return false;
  }
}

function _write(level, message, data) {
  if (!_logPath) return;
  if (LEVELS[level] < _minLevel) return;
  if (!_open()) return;
  const entry = { ts: new Date().toISOString(), level, command: _command, message };
  if (data !== undefined) entry.data = data;
  try {
    fs.writeSync(_fd, JSON.stringify(entry) + '\n');
  } catch { /* swallow — logging must never crash the CLI */ }
}

function debug(message, data) { _write('debug', message, data); }
function info(message, data)  { _write('info',  message, data); }
function warn(message, data)  { _write('warn',  message, data); }
function error(message, data) { _write('error', message, data); }

function close() {
  if (_fd != null) {
    try { fs.closeSync(_fd); } catch { /* ignore */ }
    _fd = null;
  }
}

function _reset() {
  close();
  _logPath  = null;
  _minLevel = LEVELS.info;
  _command  = '';
}

module.exports = { init, debug, info, warn, error, close, _reset };
