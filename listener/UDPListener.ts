// listener/UDPListener.ts
import dgram from 'dgram';
import type { InfoRemota } from '../types';
import * as SuntechParser  from '../services/LocationServiceSuntechUDP';
import * as RuptelaParser  from '../services/LocationServiceRuptelaUDP';

const ANALIZADORES: Record<string, { guardarUbicacion: (datos: any, infoRemota: InfoRemota) => Promise<void> }> = {
  STUniversal: SuntechParser,
  Ruptela:     RuptelaParser,
};

// --- Configuración del lote --------------------------------------------------
const TAMANO_LOTE       = 50;    // guarda cada 50 documentos
const INTERVALO_VACIADO = 5000;  // o cada 5 segundos, lo que ocurra primero

// --- Documento pendiente -----------------------------------------------------
interface DocumentoPendiente {
  tipoEquipo: string;
  datos:      string | string[];
  infoRemota: InfoRemota;
}

// --- BufferLote --------------------------------------------------------------
// Acumula documentos y dispara el guardado cuando:
//   a) El buffer llega a TAMANO_LOTE (50 docs)
//   b) Pasan INTERVALO_VACIADO ms sin llegar a 50

class BufferLote {
  private buffer:       DocumentoPendiente[]   = [];
  private temporizador: NodeJS.Timeout | null  = null;

  agregar(doc: DocumentoPendiente): void {
    this.buffer.push(doc);

    // Arrancamos el temporizador solo con el primer documento del lote
    if (this.buffer.length === 1) {
      this.temporizador = setTimeout(() => this._vaciar('temporizador'), INTERVALO_VACIADO);
    }

    // Cuando llegamos exactamente a TAMANO_LOTE disparamos inmediatamente
    if (this.buffer.length >= TAMANO_LOTE) {
      this._vaciar('tamano');
    }
  }

  private _vaciar(motivo: 'tamano' | 'temporizador'): void {
    // Cancelamos el temporizador si el guardado fue por tamaño
    if (this.temporizador) {
      clearTimeout(this.temporizador);
      this.temporizador = null;
    }

    // Si no hay nada que guardar salimos
    if (this.buffer.length === 0) return;

    // Tomamos exactamente lo que hay y limpiamos el buffer
    const lote = this.buffer.splice(0, this.buffer.length);

    console.log(`  [LOTE] Guardando ${lote.length} docs — motivo: ${motivo}`);

    // Guardamos en paralelo con allSettled para que un error
    // no cancele el resto del lote
    Promise.allSettled(
      lote.map(elemento =>
        ANALIZADORES[elemento.tipoEquipo].guardarUbicacion(elemento.datos, elemento.infoRemota)
      )
    ).then(resultados => {
      const errores = resultados.filter(r => r.status === 'rejected').length;
      if (errores > 0) {
        console.error(`  [LOTE] ${errores}/${lote.length} docs fallaron`);
      }
    });
  }

  // Fuerza el guardado de lo que quede al cerrar el servidor
  vaciarTodo(): void {
    this._vaciar('temporizador');
  }

  get tamano(): number { return this.buffer.length; }
}

// --- ColaMensajes -------------------------------------------------------------

interface ElementoCola {
  datos:      string | string[];
  infoRemota: InfoRemota;
  tipoEquipo: string;
}

class ColaMensajes {
  private cola:       ElementoCola[] = [];
  private procesando: boolean        = false;
  private tamanoMax:  number         = 50000;
  private lote:       BufferLote     = new BufferLote();

  encolar(elemento: ElementoCola): void {
    if (this.cola.length >= this.tamanoMax) {
      this.cola.shift();
      console.warn('  [COLA] Tamaño máximo alcanzado — se descartó el mensaje más antiguo');
    }
    this.cola.push(elemento);
    if (!this.procesando) this._procesarSiguiente();
  }

  private _procesarSiguiente(): void {
    if (this.cola.length === 0) {
      this.procesando = false;
      return;
    }
    this.procesando = true;
    const elemento = this.cola.shift()!;
    this.lote.agregar({
      tipoEquipo: elemento.tipoEquipo,
      datos:      elemento.datos,
      infoRemota: elemento.infoRemota,
    });
    setImmediate(() => this._procesarSiguiente());
  }

  vaciarTodo(): void { this.lote.vaciarTodo(); }

  get tamano():     number { return this.cola.length; }
  get tamanoLote(): number { return this.lote.tamano; }
}

// --- EscuchadorUDP -----------------------------------------------------------

export default class EscuchadorUDP {
  private host:              string;
  private puerto:            number;
  private socket:            dgram.Socket;
  private contadorMensajes:  number       = 0;
  private ultimaTrama:       string       = '';
  private tiempoUltimaTrama: number       = 0;
  private ventanaDuplicados: number       = 2000;
  private cola:              ColaMensajes;

  constructor(host: string, puerto: number) {
    this.host   = host;
    this.puerto = puerto;
    this.socket = dgram.createSocket('udp4');
    this.cola   = new ColaMensajes();
    this._vincularEventos();
  }

  private _vincularEventos(): void {

    this.socket.on('message', (msg: Buffer, infoRemota: InfoRemota) => {
      const mensajeCrudo = msg.toString();
      const ahora        = Date.now();

      const esDuplicado = mensajeCrudo === this.ultimaTrama
        && (ahora - this.tiempoUltimaTrama) < this.ventanaDuplicados;
      if (esDuplicado) return;

      this.ultimaTrama       = mensajeCrudo;
      this.tiempoUltimaTrama = ahora;
      this.contadorMensajes++;

      console.log(`\n  MENSAJE #${this.contadorMensajes} | Cola: ${this.cola.tamano} | Lote: ${this.cola.tamanoLote}`);
      console.log(`  Hora : ${new Date().toLocaleString('es-MX')}`);
      console.log(`  Desde: ${infoRemota.address}:${infoRemota.port} | Tamaño: ${msg.length} bytes`);

      const analizado = this._analizarTrama(mensajeCrudo);
      if (!analizado) return;

      if (ANALIZADORES[analizado.marca]) {
        this.cola.encolar({ datos: analizado.datos, infoRemota, tipoEquipo: analizado.marca });
      } else {
        console.warn(`  [WARN] Marca desconocida: ${analizado.marca}`);
      }
    });

    this.socket.on('listening', () => {
      const direccion = this.socket.address();
      console.log('\n  ESCUCHADOR UDP — ListenerSoporte');
      console.log(`  Escuchando en  : ${direccion.address}:${direccion.port}`);
      console.log(`  Tamaño de lote : ${TAMANO_LOTE} docs`);
      console.log(`  Intervalo      : ${INTERVALO_VACIADO / 1000}s`);
      console.log('  Esperando tramas GPS...\n');
    });

    this.socket.on('error', (error: Error) => {
      console.error(`\n[ERROR] ${error.message}`);
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        console.error(`[ERROR] El puerto ${this.puerto} ya está en uso.`);
      }
      this.socket.close();
    });

    this.socket.on('close', () => console.log('\n[Escuchador] Conexión cerrada.'));
  }

  private _analizarTrama(mensajeCrudo: string): { marca: string; datos: string | string[] } | null {
    try {
      const json = JSON.parse(mensajeCrudo);
      if (!json.Trama) {
        console.warn('  [WARN] JSON recibido pero falta el campo "Trama".');
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
        datos: mensajeCrudo.trim().split(';'),
      };
    }
  }

  detener(): void {
    console.log('\n  [Escuchador] Guardando lote pendiente antes de cerrar...');
    this.cola.vaciarTodo();
    this.socket.close();
  }

  iniciar(): void { this.socket.bind(this.puerto, this.host); }
}