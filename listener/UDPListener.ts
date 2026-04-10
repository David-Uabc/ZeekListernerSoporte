// listener/UDPListener.ts
import dgram from 'dgram';
import type { RemoteInfo } from '../types';
import * as SuntechParser  from '../services/LocationService';
import * as RuptelaParser  from '../services/LocationServiceRuptela';

const PARSERS: Record<string, { saveLocation: (data: any, remote: RemoteInfo) => Promise<void> }> = {
  STUniversal: SuntechParser,
  Ruptela:     RuptelaParser,
};

// ─── Configuración del batch ──────────────────────────────────────────────────
const BATCH_SIZE     = 50;    // guarda cada 50 documentos
const FLUSH_INTERVAL = 5000;  // o cada 5 segundos, lo que ocurra primero

// ─── Documento pendiente ──────────────────────────────────────────────────────
interface PendingDoc {
  tipoEquipo: string;
  datos:      string | string[];
  remoteInfo: RemoteInfo;
}

// ─── BatchBuffer ──────────────────────────────────────────────────────────────
// Acumula documentos y dispara el guardado cuando:
//   a) El buffer llega a BATCH_SIZE (50 docs)
//   b) Pasan FLUSH_INTERVAL ms sin llegar a 50

class BatchBuffer {
  private buffer: PendingDoc[]       = [];
  private timer:  NodeJS.Timeout | null = null;

  add(doc: PendingDoc): void {
    this.buffer.push(doc);

    // Arrancamos el timer solo con el primer documento del batch
    if (this.buffer.length === 1) {
      this.timer = setTimeout(() => this._flush('timer'), FLUSH_INTERVAL);
    }

    // Cuando llegamos exactamente a BATCH_SIZE disparamos inmediatamente
    if (this.buffer.length >= BATCH_SIZE) {
      this._flush('size');
    }
  }

  private _flush(reason: 'size' | 'timer'): void {
    // Cancelamos el timer si el flush fue por tamaño
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Si no hay nada que guardar salimos
    if (this.buffer.length === 0) return;

    // Tomamos exactamente lo que hay y limpiamos el buffer
    // Los documentos que lleguen después irán al siguiente batch
    const batch = this.buffer.splice(0, this.buffer.length);

    console.log(`  [BATCH] Flushing ${batch.length} docs — reason: ${reason}`);

    // Guardamos en paralelo con allSettled para que un error
    // no cancele el resto del batch
    Promise.allSettled(
      batch.map(item =>
        PARSERS[item.tipoEquipo].saveLocation(item.datos, item.remoteInfo)
      )
    ).then(results => {
      const errors = results.filter(r => r.status === 'rejected').length;
      if (errors > 0) {
        console.error(`  [BATCH] ${errors}/${batch.length} docs failed`);
      }
    });
  }

  // Fuerza el guardado de lo que quede al cerrar el servidor
  flushAll(): void {
    this._flush('timer');
  }

  get size(): number { return this.buffer.length; }
}

// ─── MessageQueue ─────────────────────────────────────────────────────────────

interface QueueItem {
  datos:      string | string[];
  remoteInfo: RemoteInfo;
  tipoEquipo: string;
}

class MessageQueue {
  private queue:      QueueItem[] = [];
  private processing: boolean     = false;
  private maxSize:    number      = 50000;
  private batch:      BatchBuffer = new BatchBuffer();

  enqueue(item: QueueItem): void {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
      console.warn('  [QUEUE] Max size reached — oldest message discarded');
    }
    this.queue.push(item);
    if (!this.processing) this._processNext();
  }

  private _processNext(): void {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    this.processing = true;
    const item = this.queue.shift()!;
    this.batch.add({
      tipoEquipo: item.tipoEquipo,
      datos:      item.datos,
      remoteInfo: item.remoteInfo,
    });
    setImmediate(() => this._processNext());
  }

  flushAll(): void { this.batch.flushAll(); }

  get size():      number { return this.queue.length; }
  get batchSize(): number { return this.batch.size; }
}

// ─── UDPListener ─────────────────────────────────────────────────────────────

export default class UDPListener {
  private host:            string;
  private port:            number;
  private socket:          dgram.Socket;
  private messageCount:    number       = 0;
  private lastFrame:       string       = '';
  private lastFrameTime:   number       = 0;
  private duplicateWindow: number       = 2000;
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

      console.log(`\n  MESSAGE #${this.messageCount} | Queue: ${this.queue.size} | Batch: ${this.queue.batchSize}`);
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
      console.log(`  Listening on  : ${address.address}:${address.port}`);
      console.log(`  Batch size    : ${BATCH_SIZE} docs`);
      console.log(`  Flush interval: ${FLUSH_INTERVAL / 1000}s`);
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

  stop(): void {
    console.log('\n  [Listener] Flushing pending batch before closing...');
    this.queue.flushAll();
    this.socket.close();
  }

  start(): void { this.socket.bind(this.port, this.host); }
}