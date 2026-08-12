import { spawn, ChildProcess } from 'child_process';
import { RuntimeConfig } from '../types.js';
import { RuntimeLogger } from './logger.js';
import { SpeechError } from '../types.js';
import { freePort } from '../../services/runtime/freePort.js';

/** Manages the Python runtime process */
export class ProcessManager {
  private process?: ChildProcess;
  private logger: RuntimeLogger;

  constructor(private readonly config: RuntimeConfig) {
    this.logger = new RuntimeLogger();
  }

  /** Starts the Python process */
  async start(): Promise<number> {
    console.log("========== PROCESS START ==========");
    if (this.process && !this.process.killed) {
      return this.process.pid || 0;
    }

    return new Promise((resolve, reject) => {
      // Same defensive sweep as the Python tool runtime (port 8002): kill
      // whatever's already bound to this port before spawning, since
      // speech-runtime/main.py has no port guard of its own and will just
      // crash on bind() if a previous crashed/force-quit session left a
      // process here. this.config.port is the shared port (default 9000,
      // see runtimeManager.ts's sharedPort).
      freePort(this.config.port);

      console.log("========== PYTHON SPAWN ==========");
console.log("Python :", this.config.pythonPath);
console.log("Script :", this.config.scriptPath);
console.log("Args   :", this.config.args);
console.log("==================================");
      this.process = spawn(this.config.pythonPath, [this.config.scriptPath, ...this.config.args], {
        env: { ...process.env, ...this.config.env },
        detached: false,
      });

      if (!this.process.pid) {
        reject(new SpeechError('Failed to start process', 'PROCESS_ERROR'));
        return;
      }

      this.process.stdout?.on("data", (data: Buffer) => {
        // Log each chunk from the speech runtime stdout as it arrives.
        // Lines are prefixed so they are identifiable in a mixed log stream.
        const text = data.toString().trimEnd();
        if (text) {
          text.split("\n").forEach(line => {
            if (line.trim()) console.log(`[SPEECH RUNTIME] ${line}`);
          });
        }
        this.logger.log("info", data.toString(), "stdout");
      });


      this.process.stderr?.on("data", (data: Buffer) => {

    const text = data.toString();

    console.error("========== PYTHON STDERR ==========");
    console.error(text);
    console.error("===================================");

    this.logger.log("error", text, "stderr");

});

      this.process.on('error', (err) => {
        this.logger.log('error', err.message, 'system');
        reject(new SpeechError(`Process error: ${err.message}`, 'PROCESS_ERROR'));
      });

      this.process.on('exit', (code) => {
        this.logger.log('info', `Process exited with code ${code}`, 'system');
        this.process = undefined;
      });

      setTimeout(() => {
        if (this.process && !this.process.killed) {
          resolve(this.process.pid);
        } else {
          reject(new SpeechError('Process failed to start', 'PROCESS_ERROR'));
        }
      }, 2000);
    });
  }

  /** Stops the process */
  async stop(): Promise<void> {
    if (!this.process || this.process.killed) {
      return;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill('SIGKILL');
        resolve();
      }, this.config.timeout);

      this.process?.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.process?.kill('SIGTERM');
    });
  }

  /** Gets the process PID */
  getPid(): number | undefined {
    return this.process?.pid;
  }

  /** Checks if process is running */
  isRunning(): boolean {
    return !!this.process && !this.process.killed;
  }

  /** Gets the logger */
  getLogger(): RuntimeLogger {
    return this.logger;
  }
}