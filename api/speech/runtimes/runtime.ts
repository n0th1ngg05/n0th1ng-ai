import { RuntimeConfig, RuntimeHealth, RuntimeStatus } from '../types.js';
import { HttpClient } from './httpClient.js';
import { WebSocketClient } from './websocket.js';
import { ProcessManager } from './processManager.js';
import { RuntimeHealthChecker } from './health.js';
import { RuntimeLogger } from './logger.js';

/** Abstract base runtime */
export abstract class Runtime {
  protected status: RuntimeStatus = RuntimeStatus.STOPPED;
  protected healthChecker: RuntimeHealthChecker;
  protected httpClient: HttpClient;
  protected wsClient: WebSocketClient;
  protected processManager: ProcessManager;
  protected logger: RuntimeLogger;

  constructor(protected readonly config: RuntimeConfig) {
    this.healthChecker = new RuntimeHealthChecker();
    this.httpClient = new HttpClient(`http://${config.host}:${config.port}`);
    this.wsClient = new WebSocketClient(`ws://${config.host}:${config.port}/ws`);
    this.processManager = new ProcessManager(config);
    this.logger = this.processManager.getLogger();
  }

  /** Starts the runtime */
  abstract start(): Promise<void>;

  /** Stops the runtime */
  abstract stop(): Promise<void>;

  /** Returns runtime health */
  abstract health(): RuntimeHealth;

  /** Gets the HTTP client */
  getHttpClient(): HttpClient {
    return this.httpClient;
  }

  /** Gets the WebSocket client */
  getWebSocketClient(): WebSocketClient {
    return this.wsClient;
  }

  /** Gets the logger */
  getLogger(): RuntimeLogger {
    return this.logger;
  }

  /** Gets the configuration */
  getConfig(): RuntimeConfig {
    return this.config;
  }

  /** Gets current status */
  getStatus(): RuntimeStatus {
    return this.status;
  }
}