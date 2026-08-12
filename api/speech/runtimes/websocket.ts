import { EventEmitter } from 'events';
import { SpeechError } from '../types.js';

/** WebSocket message */
export interface WSMessage {
  type: string;
  payload: unknown;
}

/** Lightweight WebSocket client for runtime communication */
export class WebSocketClient extends EventEmitter {
  private ws?: unknown;
  private connected = false;
  private url: string;

  constructor(url: string) {
    super();
    this.url = url;
  }

  /** Connects to the WebSocket server */
  async connect(): Promise<void> {
    try {
      const WebSocket = await this.loadWS();
      this.ws = new WebSocket(this.url);
      (this.ws as WebSocket).onopen = () => {
        this.connected = true;
        this.emit('open');
      };
      (this.ws as WebSocket).onmessage = (event: { data: string }) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;
          this.emit('message', msg);
        } catch { /* ignore invalid */ }
      };
      (this.ws as WebSocket).onclose = () => {
        this.connected = false;
        this.emit('close');
      };
      (this.ws as WebSocket).onerror = (err: Error) => {
        this.emit('error', err);
      };
    } catch {
      throw new SpeechError('WebSocket module not available', 'WEBSOCKET_ERROR');
    }
  }

  /** Sends a message */
  send(message: WSMessage): void {
    if (!this.ws || !this.connected) {
      throw new SpeechError('WebSocket not connected', 'WEBSOCKET_ERROR');
    }
    (this.ws as { send: (data: string) => void }).send(JSON.stringify(message));
  }

  /** Disconnects from the server */
  disconnect(): void {
    if (this.ws) {
      try {
        (this.ws as { close: () => void }).close();
      } catch { /* ignore */ }
      this.connected = false;
    }
  }

  /** Checks if connected */
  isConnected(): boolean {
    return this.connected;
  }

  private async loadWS(): Promise<typeof WebSocket> {
    const { default: WS } = await import('ws');
    return WS as unknown as typeof WebSocket;
  }
}