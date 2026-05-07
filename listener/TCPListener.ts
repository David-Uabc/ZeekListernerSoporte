// listener/TCPListener.ts
import net  from 'net';
import type { InfoRemota } from '../types';
import {
  esTramaTcpRuptela,
  procesarTramaRuptela,
  type ResultadoTrama,
} from '../services/LocationServiceRuptelaTCP';

const PUERTO_DEFECTO = 5002;
const DELIMITADOR    = '\n';

// --- Datos de conexión en memoria
// Mapa<IMEI, DatosConexion> — la clave es el IMEI del dispositivo
// Antes del Login la clave temporal es el idConexion (IP:Puerto)
// Al recibir el Login se mueve la entrada al IMEI y se borra la temporal

export interface DatosConexion {
  ipEquipo:         string;      // 1. IP del equipo (dispositivo GPS en campo)
  puertoEquipo:     number;      // 2. Puerto del equipo
  ipServidor:       string;      // 3. IP del servidor
  puertoServidor:   number;      // 4. Puerto del servidor TCP
  imei:             string;      // 5. IMEI del equipo (se llena en Login)
  respuestaComando: string;      // 6. Última respuesta de comando recibida
  socket:           net.Socket;  // Conexión viva para enviar comandos
  fechaConexion:    Date;
  autenticado:      boolean;     // verdadero después de recibir el Login
}

// --- EscuchadorTCP

export default class EscuchadorTCP {
  private puerto:           number;
  private host:             string;
  private servidor:         net.Server;
  private contadorMensajes: number = 0;

  // Mapa principal — clave: IMEI (después del Login)
  // Antes del Login la clave es idConexion temporal
  private conexiones: Map<string, DatosConexion> = new Map();

  constructor(host: string, puerto: number = PUERTO_DEFECTO) {
    this.host     = host;
    this.puerto   = puerto;
    this.servidor = net.createServer(socket => this._manejarConexion(socket));
    this._vincularEventosServidor();
  }

  // --- Nueva conexión

  private _manejarConexion(socket: net.Socket): void {
    // idConexion temporal hasta que llegue el Login con el IMEI real
    const idConexion = `${socket.remoteAddress}:${socket.remotePort}`;

    const datosConexion: DatosConexion = {
      ipEquipo:         socket.remoteAddress ?? '',  // 1. IP equipo
      puertoEquipo:     socket.remotePort    ?? 0,   // 2. Puerto equipo
      ipServidor:       this.host,                   // 3. IP servidor
      puertoServidor:   this.puerto,                 // 4. Puerto servidor
      imei:             '',                          // 5. Pendiente Login
      respuestaComando: '',                          // 6. Pendiente comando
      socket,
      fechaConexion:    new Date(),
      autenticado:      false,
    };

    this.conexiones.set(idConexion, datosConexion);

    console.log(`\n  [TCP] Nueva conexión`);
    console.log(`  [TCP] 1. IP equipo      : ${datosConexion.ipEquipo}`);
    console.log(`  [TCP] 2. Puerto equipo  : ${datosConexion.puertoEquipo}`);
    console.log(`  [TCP] 3. IP servidor    : ${datosConexion.ipServidor}`);
    console.log(`  [TCP] 4. Puerto servidor: ${datosConexion.puertoServidor}`);
    console.log(`  [TCP] 5. IMEI           : pendiente Login`);
    console.log(`  [TCP] 6. Resp. comando  : pendiente`);
    console.log(`  [TCP] Equipos conectados: ${this.conexiones.size}`);

    let acumulador = '';

    // -- Evento data
    socket.on('data', (fragmento: Buffer) => {
      acumulador += fragmento.toString();
      const lineas = acumulador.split(DELIMITADOR);
      acumulador = lineas.pop() ?? '';

      for (const linea of lineas) {
        const trama = linea.trim();
        if (!trama) continue;
        this.contadorMensajes++;
        this._manejarMensaje(trama, idConexion, socket);
      }
    });

    // -- Evento end — cierre limpio
    socket.on('end', () => {
      this._manejarDesconexion(idConexion);
    });

    // -- Evento error — ECONNRESET y otros
    // ECONNRESET ocurre cuando el cliente cierra abruptamente (netcat Ctrl+C)
    // Lo manejamos silenciosamente — es comportamiento normal
    socket.on('error', (error: Error) => {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ECONNRESET') {
        console.error(`\n  [TCP] Error en ${idConexion}: ${error.message}`);
      }
      this._manejarDesconexion(idConexion);
    });

    socket.on('close', () => {
      this._manejarDesconexion(idConexion);
    });
  }

  // --- Desconexión

  private _manejarDesconexion(idConexion: string): void {
    const porIdConexion = this.conexiones.get(idConexion);
    if (porIdConexion) {
      const etiqueta = porIdConexion.imei || idConexion;
      console.log(`\n  [TCP] Desconectado: ${etiqueta}`);
      this.conexiones.delete(idConexion);
    } else {
      // Buscar por idConexion dentro de los valores (si ya se movió al IMEI)
      for (const [clave, datos] of this.conexiones) {
        if (datos.ipEquipo === idConexion.split(':')[0] &&
            datos.puertoEquipo === parseInt(idConexion.split(':')[1] ?? '0')) {
          console.log(`\n  [TCP] Desconectado: ${datos.imei}`);
          this.conexiones.delete(clave);
          break;
        }
      }
    }
    console.log(`  [TCP] Equipos conectados: ${this.conexiones.size}`);
  }

  // --- Procesamiento de trama

  private _manejarMensaje(trama: string, idConexion: string, socket: net.Socket): void {
    const infoRemota: InfoRemota = {
      address: idConexion.split(':')[0] ?? '',
      port:    parseInt(idConexion.split(':')[1] ?? '0'),
    };

    const datosConexion = this.conexiones.get(idConexion)
      ?? this._buscarPorSocket(socket);

    console.log(`\n  MENSAJE #${this.contadorMensajes}`);
    console.log(`  Hora  : ${new Date().toLocaleString('es-MX')}`);
    console.log(`  Desde : ${idConexion}`);
    console.log(`  IMEI  : ${datosConexion?.imei || 'pendiente Login'}`);
    console.log(`  Trama : ${trama.slice(0, 60)}${trama.length > 60 ? '...' : ''}`);

    const esHexadecimal = /^[0-9A-Fa-f]+$/.test(trama.trim());
    const esRuptela     = esHexadecimal && esTramaTcpRuptela(trama);

    if (esRuptela) {
      console.log('  [TCP] Identificado como Ruptela por estructura de trama.');

      procesarTramaRuptela(trama, infoRemota).then((resultado: ResultadoTrama) => {

        // -- Login: actualizar Map con IMEI como clave
        if (resultado.tipo === 'Login' && resultado.imei && datosConexion) {
          const imei = resultado.imei;

          datosConexion.imei        = imei;
          datosConexion.autenticado = true;

          // Movemos la entrada del Map: de idConexion temporal → IMEI real
          this.conexiones.delete(idConexion);
          this.conexiones.set(imei, datosConexion);

          console.log(`  [TCP] 5. IMEI registrado: ${imei}`);
          console.log(`  [TCP] Map actualizado → clave: ${imei}`);

          if (resultado.ack) {
            const ackHex = resultado.ack.toString('hex').toUpperCase();
            socket.write(resultado.ack);
            console.log(`  [TCP] ACK enviado → ${imei}: ${ackHex}`);
          }
        }

        // Ubicacion: mantener Map actualizado en cada reporte
        if (resultado.tipo === 'Ubicacion' && resultado.imei) {
          const entrada = this.conexiones.get(resultado.imei);
          if (entrada) {
            entrada.socket = socket;
          } else {
            const porIdConexion = this.conexiones.get(idConexion);
            if (porIdConexion) {
              porIdConexion.imei        = resultado.imei;
              porIdConexion.autenticado = true;
              this.conexiones.delete(idConexion);
              this.conexiones.set(resultado.imei, porIdConexion);
              console.log(`  [TCP] Map actualizado por Ubicacion → ${resultado.imei}`);
            }
          }
        }

        // RespuestaComando: guardar en campo 6 del Map
        if (resultado.tipo === 'RespuestaComando' && resultado.respuestaComando) {
          const entrada = resultado.imei
            ? this.conexiones.get(resultado.imei)
            : datosConexion;

          if (entrada) {
            entrada.respuestaComando = resultado.respuestaComando;
            console.log(`  [TCP] 6. Respuesta comando guardada: ${resultado.respuestaComando}`);
          }
        }

      }).catch((error: unknown) => {
        const mensaje = error instanceof Error ? error.message : String(error);
        console.error(`  [TCP][Ruptela] Error procesando trama: ${mensaje}`);
      });

    } else if (esHexadecimal) {
      console.warn('  [TCP] Trama HEX no identificada como Ruptela; no se procesa.');
    } else {
      console.log(`  [TCP] Mensaje texto: ${trama}`);
      socket.write(`ACK:${this.contadorMensajes}\n`);
    }
  }

  // --- Buscar conexión por socket

  private _buscarPorSocket(socket: net.Socket): DatosConexion | undefined {
    for (const datos of this.conexiones.values()) {
      if (datos.socket === socket) return datos;
    }
    return undefined;
  }

  // --- Enviar comando
  // Busca el dispositivo por IMEI en el Map y envía el comando
  // Solo funciona si el dispositivo ya se autenticó con Login

  enviarComando(imei: string, comando: string): boolean {
    const datosConexion = this.conexiones.get(imei);

    if (!datosConexion) {
      console.warn(`  [TCP] IMEI no encontrado en Map: ${imei}`);
      return false;
    }

    if (!datosConexion.autenticado) {
      console.warn(`  [TCP] Equipo ${imei} no autenticado aún`);
      return false;
    }

    datosConexion.socket.write(`${comando}\n`);
    console.log(`  [TCP] Comando enviado → ${imei}: ${comando}`);
    return true;
  }

  // --- Getters

  // Retorna todos los dispositivos autenticados con sus 6 campos
  // (sin el socket — no serializable)
  obtenerDispositivosConectados(): Omit<DatosConexion, 'socket'>[] {
    return Array.from(this.conexiones.values())
      .filter(d => d.autenticado)
      .map(({ socket, ...resto }) => resto);
  }

  get totalConexiones(): number { return this.conexiones.size; }

  // --- Ciclo de vida

  iniciar(): void { this.servidor.listen(this.puerto, this.host); }

  detener(): void {
    console.log('\n  [TCP] Cerrando conexiones...');
    this.conexiones.forEach((datos, clave) => {
      datos.socket.end();
      console.log(`  [TCP] Cerrado: ${clave}`);
    });
    this.servidor.close(() => console.log('  [TCP] Servidor cerrado.'));
  }

  private _vincularEventosServidor(): void {
    this.servidor.on('listening', () => {
      const direccion = this.servidor.address() as net.AddressInfo;
      console.log('\n  TCP LISTENER — ListenerSoporte');
      console.log(`  Escuchando en: ${direccion.address}:${direccion.port}`);
      console.log(`  Protocolo    : TCP persistente`);
      console.log(`  Delimitador  : \\n`);
      console.log('  Esperando conexiones TCP...\n');
    });

    this.servidor.on('error', (error: Error) => {
      const err = error as NodeJS.ErrnoException;
      console.error(`\n  [TCP ERROR] ${error.message}`);
      if (err.code === 'EADDRINUSE') {
        console.error(`  [TCP ERROR] El puerto ${this.puerto} ya está en uso.`);
      }
    });
  }
}