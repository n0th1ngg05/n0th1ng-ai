import { EventEmitter } from 'events';

/** Runtime log entry */
export interface RuntimeLogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source: 'stdout' | 'stderr' | 'system';
}

/** Runtime logger that captures process output */
export class RuntimeLogger extends EventEmitter {
  private logs: RuntimeLogEntry[] = [];
  private maxLogs = 1000;

  /** Logs a message */
  log(level: RuntimeLogEntry['level'], message: string, source: RuntimeLogEntry['source']): void {
    const entry: RuntimeLogEntry = { timestamp: new Date(), level, message: message.trim(), source };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.emit('log', entry);
  }

  /** Gets all logs */
  getLogs(): RuntimeLogEntry[] {
    return [...this.logs];
  }

  /** Gets recent logs */
  getRecentLogs(count = 100): RuntimeLogEntry[] {
    return this.logs.slice(-count);
  }

  /** Clears logs */
  clear(): void {
    this.logs = [];
  }
}