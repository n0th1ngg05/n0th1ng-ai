import { RuntimeHealth, RuntimeStatus } from '../types.js';

/** Runtime health checker */
export class RuntimeHealthChecker {
  private lastPing = new Date();
  private consecutiveFailures = 0;
  private maxFailures = 3;

  /** Updates health on successful ping */
  ping(): void {
    this.lastPing = new Date();
    this.consecutiveFailures = 0;
  }

  /** Records a health check failure */
  recordFailure(): void {
    this.consecutiveFailures++;
  }

  /** Checks if runtime is healthy */
  isHealthy(): boolean {
    return this.consecutiveFailures < this.maxFailures;
  }

  /** Builds health report */
  getHealth(status: RuntimeStatus, pid?: number, port: number = 0): RuntimeHealth {
    return {
      status,
      pid,
      port,
      uptime: Date.now() - this.lastPing.getTime(),
      memoryUsage: 0,
      cpuUsage: 0,
      lastPing: this.lastPing,
    };
  }
}