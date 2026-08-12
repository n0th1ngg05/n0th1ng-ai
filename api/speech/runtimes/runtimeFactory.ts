import { RuntimeConfig } from '../types.js';
import { Runtime } from './runtime.js';
import { SharedRuntime } from './sharedRuntime.js';
import { PythonRuntime } from './pythonRuntime.js';

/** Factory for creating runtime instances */
export class RuntimeFactory {
  /**
   * Creates a runtime based on configuration.
   *
   * The Python speech runtime is a single multi-provider process (started
   * once by the outer boot sequence), not one process per provider. Every
   * provider therefore shares the same SharedRuntime instance/connection.
   */
  static create(config: RuntimeConfig): Runtime {
    return new PythonRuntime(config);
  }
}