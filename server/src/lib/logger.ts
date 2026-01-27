const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelColors: Record<LogLevel, string> = {
  debug: colors.gray,
  info: colors.cyan,
  warn: colors.yellow,
  error: colors.red,
};

const levelLabels: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

function formatTimestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, ...args: unknown[]) {
  const timestamp = formatTimestamp();
  const color = levelColors[level];
  const label = levelLabels[level];
  
  const formattedMessage = `${colors.gray}${timestamp}${colors.reset} ${color}[${label}]${colors.reset} ${message}`;
  
  if (args.length > 0) {
    console.log(formattedMessage, ...args);
  } else {
    console.log(formattedMessage);
  }
}

export const logger = {
  debug: (message: string, ...args: unknown[]) => {
    if (process.env.NODE_ENV === 'development') {
      log('debug', message, ...args);
    }
  },
  info: (message: string, ...args: unknown[]) => log('info', message, ...args),
  warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
  error: (message: string, ...args: unknown[]) => log('error', message, ...args),
};
