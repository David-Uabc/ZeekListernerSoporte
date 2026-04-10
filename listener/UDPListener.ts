// listener/UDPListener.ts
import dgram from 'dgram';
import type { RemoteInfo } from '../types';
import * as SuntechParser  from '../services/LocationService';
import * as RuptelaParser  from '../services/LocationServiceRuptela';

// Tabla de parsers — agregar una marca nueva = una línea aquí
const PARSERS: Record<string, { saveLocation: (data: any, remote: RemoteInfo) => Promise<void> }> = {
  STUniversal: SuntechParser,
  Ruptela:     RuptelaParser,
};

// ─── MessageQueue 

interface QueueItem {
  datos:      string | string[];
  remoteInfo: RemoteInfo;
  tipoEquipo: string;
}

class MessageQueue {
  private queue:      QueueItem[] = [];
  private processing: boolean     = false;
  private maxSize:    number       = 10000;

  enqueue(item: QueueItem): void {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
      console.warn('  [QUEUE] Max size reached — oldest message discarded');
    }
    this.queue.push(item);
    if (!this.processing) this._processNext();
  }

  private async _processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    this.processing = true;
    const item = this.queue.shift()!;
    try {
      await PARSERS[item.tipoEquipo].saveLocation(item.datos, item.remoteInfo);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  [QUEUE] Processing error: ${msg}`);
    }
    setImmediate(() => this._processNext());
  }

  get size(): number { return this.queue.length; }
}

// ─── UDPListener ─────────────────────────────────────────────────────────────

export default class UDPListener {
  private host:            string;
  private port:            number;
  private socket:          dgram.Socket;
  private messageCount:    number  = 0;
  private lastFrame:       string  = '';
  private lastFrameTime:   number  = 0;
  private duplicateWindow: number  = 2000;
  private queue:           MessageQueue;

  constructor(host: string, port: number) {
    this.host   = host;
    this.port   = port;
    this.socket = dgram.createSocket('udp4');
    this.queue  = new MessageQueue();
    this._bindEvents();
  }

  private _bindEvents(): void {

    this.socket.on('message', (msg: Buffer, remoteInfo: RemoteInfo) => {
      const rawMessage = msg.toString();
      const now        = Date.now();

      const isDuplicate = rawMessage === this.lastFrame
        && (now - this.lastFrameTime) < this.duplicateWindow;
      if (isDuplicate) return;

      this.lastFrame     = rawMessage;
      this.lastFrameTime = now;
      this.messageCount++;

      console.log(`\n  MESSAGE #${this.messageCount} | Queue: ${this.queue.size} waiting`);
      console.log(`  Time : ${new Date().toLocaleString('es-MX')}`);
      console.log(`  From : ${remoteInfo.address}:${remoteInfo.port} | Size: ${msg.length} bytes`);

      const parsed = this._parseFrame(rawMessage);
      if (!parsed) return;

      if (PARSERS[parsed.marca]) {
        this.queue.enqueue({ datos: parsed.datos, remoteInfo, tipoEquipo: parsed.marca });
      } else {
        console.warn(`  [WARN] Marca desconocida: ${parsed.marca}`);
      }
    });

    this.socket.on('listening', () => {
      const address = this.socket.address();
      console.log('\n  UDP LISTENER — ListenerSoporte');
      console.log(`  Listening on : ${address.address}:${address.port}`);
      console.log('  Queue        : Active (anti-collapse)');
      console.log('  Waiting for GPS frames...\n');
    });

    this.socket.on('error', (error: Error) => {
      console.error(`\n[ERROR] ${error.message}`);
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        console.error(`[ERROR] Port ${this.port} is already in use.`);
      }
      this.socket.close();
    });

    this.socket.on('close', () => console.log('\n[Listener] Socket closed.'));
  }

  private _parseFrame(rawMessage: string): { marca: string; datos: string | string[] } | null {
    try {
      const json = JSON.parse(rawMessage);
      if (!json.Trama) {
        console.warn('  [WARN] JSON received but "Trama" field is missing.');
        return null;
      }
      const marca = json.Identificar ?? 'STUniversal';
      const datos = marca === 'STUniversal'
        ? (json.Trama as string).trim().split(';')
        : (json.Trama as string).trim();
      return { marca, datos };
    } catch {
      return {
        marca: 'STUniversal',
        datos: rawMessage.trim().split(';'),
      };
    }
  }

  start(): void  { this.socket.bind(this.port, this.host); }
  stop():  void  { this.socket.close(); }
}