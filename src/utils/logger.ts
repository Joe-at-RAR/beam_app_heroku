// Centralized logger utility
export interface Logger {
  debug(...args: any[]): void
  appDebug(...args: any[]): void
  info(...args: any[]): void
  warn(...args: any[]): void
  error(...args: any[]): void
}

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'APPDEBUG' | 'DEBUG'

// Read environment settings
const ENV_LOG_LEVEL = (process.env['LOG_LEVEL'] || 'INFO').toUpperCase() as LogLevel
const ENV_LOG_PROCESSES = (process.env['LOG_PROCESSES'] || 'ALL').split(',').map(s => s.trim())

// Define numeric order for levels
const levelOrder: Record<LogLevel, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  APPDEBUG: 3,
  DEBUG: 4
}

// Check if a given level is enabled
function isLevelEnabled(level: LogLevel): boolean {
  return levelOrder[level] <= levelOrder[ENV_LOG_LEVEL]
}

// Check if logging is enabled for this process
function isProcessEnabled(processName: string): boolean {
  return ENV_LOG_PROCESSES.includes('ALL') || ENV_LOG_PROCESSES.includes(processName)
}

// Core logger function
function log(level: LogLevel, processName: string, args: any[]): void {
  if (!isLevelEnabled(level) || !isProcessEnabled(processName)) return
  const prefix = `[${level}][${processName}]`
  if (level === 'ERROR') {
    console.error(prefix, ...args)
  } else if (level === 'WARN') {
    console.warn(prefix, ...args)
  } else if (level === 'INFO') {
    console.info(prefix, ...args)
  } else {
    console.debug(prefix, ...args)
  }
}

// Factory to create a logger for a given process
export function createLogger(processName: string) {
  return {
    debug: (...args: any[]) => log('DEBUG', processName, args),
    appDebug: (...args: any[]) => log('APPDEBUG', processName, args),
    info: (...args: any[]) => log('INFO', processName, args),
    warn: (...args: any[]) => log('WARN', processName, args),
    error: (...args: any[]) => log('ERROR', processName, args)
  }
} 