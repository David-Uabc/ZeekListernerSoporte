"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// listener/UDPListener.ts
const dgram_1 = __importDefault(require("dgram"));
const SuntechParser = __importStar(require("../services/LocationService"));
const RuptelaParser = __importStar(require("../services/LocationServiceRuptela"));
// Tabla de parsers — agregar una marca nueva = una línea aquí
const PARSERS = {
    STUniversal: SuntechParser,
    Ruptela: RuptelaParser,
};
class MessageQueue {
    queue = [];
    processing = false;
    maxSize = 10000;
    enqueue(item) {
        if (this.queue.length >= this.maxSize) {
            this.queue.shift();
            console.warn('  [QUEUE] Max size reached — oldest message discarded');
        }
        this.queue.push(item);
        if (!this.processing)
            this._processNext();
    }
    async _processNext() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }
        this.processing = true;
        const item = this.queue.shift();
        try {
            await PARSERS[item.tipoEquipo].saveLocation(item.datos, item.remoteInfo);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`  [QUEUE] Processing error: ${msg}`);
        }
        setImmediate(() => this._processNext());
    }
    get size() { return this.queue.length; }
}
// ─── UDPListener ─────────────────────────────────────────────────────────────
class UDPListener {
    host;
    port;
    socket;
    messageCount = 0;
    lastFrame = '';
    lastFrameTime = 0;
    duplicateWindow = 2000;
    queue;
    constructor(host, port) {
        this.host = host;
        this.port = port;
        this.socket = dgram_1.default.createSocket('udp4');
        this.queue = new MessageQueue();
        this._bindEvents();
    }
    _bindEvents() {
        this.socket.on('message', (msg, remoteInfo) => {
            const rawMessage = msg.toString();
            const now = Date.now();
            const isDuplicate = rawMessage === this.lastFrame
                && (now - this.lastFrameTime) < this.duplicateWindow;
            if (isDuplicate)
                return;
            this.lastFrame = rawMessage;
            this.lastFrameTime = now;
            this.messageCount++;
            console.log(`\n  MESSAGE #${this.messageCount} | Queue: ${this.queue.size} waiting`);
            console.log(`  Time : ${new Date().toLocaleString('es-MX')}`);
            console.log(`  From : ${remoteInfo.address}:${remoteInfo.port} | Size: ${msg.length} bytes`);
            const parsed = this._parseFrame(rawMessage);
            if (!parsed)
                return;
            if (PARSERS[parsed.marca]) {
                this.queue.enqueue({ datos: parsed.datos, remoteInfo, tipoEquipo: parsed.marca });
            }
            else {
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
        this.socket.on('error', (error) => {
            console.error(`\n[ERROR] ${error.message}`);
            if (error.code === 'EADDRINUSE') {
                console.error(`[ERROR] Port ${this.port} is already in use.`);
            }
            this.socket.close();
        });
        this.socket.on('close', () => console.log('\n[Listener] Socket closed.'));
    }
    _parseFrame(rawMessage) {
        try {
            const json = JSON.parse(rawMessage);
            if (!json.Trama) {
                console.warn('  [WARN] JSON received but "Trama" field is missing.');
                return null;
            }
            const marca = json.Identificar ?? 'STUniversal';
            const datos = marca === 'STUniversal'
                ? json.Trama.trim().split(';')
                : json.Trama.trim();
            return { marca, datos };
        }
        catch {
            return {
                marca: 'STUniversal',
                datos: rawMessage.trim().split(';'),
            };
        }
    }
    start() { this.socket.bind(this.port, this.host); }
    stop() { this.socket.close(); }
}
exports.default = UDPListener;
