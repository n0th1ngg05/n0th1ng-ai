import { EventEmitter } from "events";

// ── Shared master connection state ────────────────────────────────────────────
//
// server.ts fires events here when the master connection status changes.
// exposureService.ts listens to make real-time AUTO-mode decisions without
// polling.
//
// This is a tiny module — the only state it holds is `connected` (bool) and
// the timestamp of the last transition. The actual auto-trigger timer lives
// entirely in exposureService.ts.

class ConnectionState extends EventEmitter {

    private _connected = false;
    private _isRemote = false;
    private _lastChange = Date.now();

    get connected(): boolean {
        return this._connected;
    }

    get isRemote(): boolean {
        return this._isRemote;
    }

    get lastChangedAt(): number {
        return this._lastChange;
    }

    setConnected(value: boolean, isRemote: boolean = false) {
        if (this._connected === value && this._isRemote === isRemote) return; // no-op on same state
        this._connected = value;
        this._isRemote = value ? isRemote : false;
        this._lastChange = Date.now();
        this.emit(value ? "connected" : "disconnected", { isRemote: this._isRemote });
    }
}

export const connectionState = new ConnectionState();
