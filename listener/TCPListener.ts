// listener/TCPListener.ts
import net  from 'net';
import type { RemoteInfo } from '../types';
import { procesarTramaRuptela, type TramaResult } from '../services/LocationServiceRuptelaTCP';

const DEFAULT_PORT = 5002;
const DELIMITER    = '\n';

// ─── Datos de conexión en memoria ────────────────────────────────────────────
// Map<IMEI, ConnectionData> — clave es el IMEI del dispositivo
// Antes del Login la clave temporal es el connId (IP:Puerto)
// Al recibir el Login se mueve la entrada al IMEI y se borra la temporal

export interface ConnectionData {
  ipEquipo:         string;      // 1. IP del equipo (dispositivo GPS en campo)
  puertoEquipo:     number;      // 2. Puerto del equipo
  ipServidor:       string;      // 3. IP del servidor
  puertoServidor:   number;      // 4. Puerto del servidor TCP
  imei:             string;      // 5. IMEI del equipo (se llena en Login)
  respuestaComando: string;      // 6. Última respuesta de comando recibida
  socket:           net.Socket;  // Socket vivo para enviar comandos
  fechaConexion:    Date;
  autenticado:      boolean;     // true después de recibir el Login
}

// ─── TCPListener ─────────────────────────────────────────────────────────────

export default class TCPListener {
  private port:         number;
  private host:         string;
  private server:       net.Server;
  private messageCount: number = 0;

  // Map principal — clave: IMEI (después del Login)
  // Antes del Login la clave es connId temporal
  private connections: Map<string, ConnectionData> = new Map();

  constructor(host: string, port: number = DEFAULT_PORT) {
    this.host   = host;
    this.port   = port;
    this.server = net.createServer(socket => this._handleConnection(socket));
    this._bindServerEvents();
  }

  // ─── Nueva conexión ───────────────────────────────────────────────────────

  private _handleConnection(socket: net.Socket): void {
    // connId temporal hasta que llegue el Login con el IMEI real
    const connId = `${socket.remoteAddress}:${socket.remotePort}`;

    // Guardamos con connId temporal — los 4 primeros campos ya los tenemos
    const connData: ConnectionData = {
      ipEquipo:         socket.remoteAddress ?? '',  // 1. IP equipo
      puertoEquipo:     socket.remotePort    ?? 0,   // 2. Puerto equipo
      ipServidor:       this.host,                   // 3. IP servidor
      puertoServidor:   this.port,                   // 4. Puerto servidor
      imei:             '',                          // 5. Pendiente Login
      respuestaComando: '',                          // 6. Pendiente comando
      socket,
      fechaConexion:    new Date(),
      autenticado:      false,
    };

    this.connections.set(connId, connData);

    console.log(`\n  [TCP] Nueva conexión`);
    console.log(`  [TCP] 1. IP equipo      : ${connData.ipEquipo}`);
    console.log(`  [TCP] 2. Puerto equipo  : ${connData.puertoEquipo}`);
    console.log(`  [TCP] 3. IP servidor    : ${connData.ipServidor}`);
    console.log(`  [TCP] 4. Puerto servidor: ${connData.puertoServidor}`);
    console.log(`  [TCP] 5. IMEI           : pendiente Login`);
    console.log(`  [TCP] 6. Resp. comando  : pendiente`);
    console.log(`  [TCP] Dispositivos conectados: ${this.connections.size}`);

    let buffer = '';

    // ── Evento data ──────────────────────────────────────────────────────────
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(DELIMITER);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trama = line.trim();
        if (!trama) continue;
        this.messageCount++;
        this._handleMessage(trama, connId, socket);
      }
    });

    // ── Evento end — cierre limpio ───────────────────────────────────────────
    socket.on('end', () => {
      this._handleDisconnect(connId);
    });

    // ── Evento error — ECONNRESET y otros ───────────────────────────────────
    // ECONNRESET ocurre cuando el cliente cierra abruptamente (netcat Ctrl+C)
    // Lo manejamos silenciosamente — es comportamiento normal
    socket.on('error', (error: Error) => {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ECONNRESET') {
        // Solo logueamos errores que NO sean desconexiones abruptas
        console.error(`\n  [TCP] Error en ${connId}: ${error.message}`);
      }
      this._handleDisconnect(connId);
    });

    socket.on('close', () => {
      this._handleDisconnect(connId);
    });
  }

  // ─── Desconexión ─────────────────────────────────────────────────────────

  private _handleDisconnect(connId: string): void {
    // Buscamos la entrada en el Map — puede estar por connId o por IMEI
    const byConnId = this.connections.get(connId);
    if (byConnId) {
      const label = byConnId.imei || connId;
      console.log(`\n  [TCP] Desconectado: ${label}`);
      this.connections.delete(connId);
    } else {
      // Buscar por connId dentro de los valores (si ya se movió al IMEI)
      for (const [key, data] of this.connections) {
        if (data.ipEquipo === connId.split(':')[0] &&
            data.puertoEquipo === parseInt(connId.split(':')[1] ?? '0')) {
          console.log(`\n  [TCP] Desconectado: ${data.imei}`);
          this.connections.delete(key);
          break;
        }
      }
    }
    console.log(`  [TCP] Dispositivos conectados: ${this.connections.size}`);
  }

  // ─── Procesamiento de trama ───────────────────────────────────────────────

  private _handleMessage(trama: string, connId: string, socket: net.Socket): void {
    const remoteInfo: RemoteInfo = {
      address: connId.split(':')[0] ?? '',
      port:    parseInt(connId.split(':')[1] ?? '0'),
    };

    // Buscamos la conexión — puede estar en connId temporal o en IMEI
    const connData = this.connections.get(connId)
      ?? this._findBySocket(socket);

    console.log(`\n  MESSAGE #${this.messageCount}`);
    console.log(`  Time  : ${new Date().toLocaleString('es-MX')}`);
    console.log(`  From  : ${connId}`);
    console.log(`  IMEI  : ${connData?.imei || 'pendiente Login'}`);
    console.log(`  Trama : ${trama.slice(0, 60)}${trama.length > 60 ? '...' : ''}`);

    const isHex = /^[0-9A-Fa-f]+$/.test(trama.trim());

    if (isHex) {
      // Trama Ruptela — procesamos y detectamos tipo
      procesarTramaRuptela(trama, remoteInfo).then((result: TramaResult) => {

        // ── Login: actualizar Map con IMEI como clave ──────────────────────
        if (result.tipo === 'Login' && result.imei && connData) {
          const imei = result.imei;

          // Actualizamos los datos de la conexión con el IMEI
          connData.imei        = imei;
          connData.autenticado = true;

          // Movemos la entrada del Map: de connId temporal → IMEI real
          this.connections.delete(connId);
          this.connections.set(imei, connData);

          console.log(`  [TCP] 5. IMEI registrado: ${imei}`);
          console.log(`  [TCP] Map actualizado → clave: ${imei}`);

          // Enviamos ACK al dispositivo
          if (result.ack) {
            socket.write(result.ack);
            console.log(`  [TCP] ACK enviado → ${imei}`);
          }
        }

        // Ubicacion: mantener Map actualizado en cada reporte
        // El inge confirmo que los siguientes reportes tambien deben
        // mantener actualizado el diccionario, no solo el Login
        if (result.tipo === 'Ubicacion' && result.imei) {
          const entry = this.connections.get(result.imei);
          if (entry) {
            entry.socket = socket; // actualizamos socket por si cambio
          } else {
            // Llego Ubicacion antes del Login — creamos entrada con IMEI
            const byConnId = this.connections.get(connId);
            if (byConnId) {
              byConnId.imei        = result.imei;
              byConnId.autenticado = true;
              this.connections.delete(connId);
              this.connections.set(result.imei, byConnId);
              console.log(`  [TCP] Map actualizado por Ubicacion → ${result.imei}`);
            }
          }
        }

        // RespuestaComando: guardar en campo 6 del Map
        if (result.tipo === 'RespuestaComando' && result.respuestaComando) {
          const entry = result.imei
            ? this.connections.get(result.imei)
            : connData;

          if (entry) {
            entry.respuestaComando = result.respuestaComando;
            console.log(`  [TCP] 6. Respuesta comando guardada: ${result.respuestaComando}`);
          }
        }
      });

    } else {
      // Texto plano — pruebas con netcat o terminal
      console.log(`  [TCP] Mensaje texto: ${trama}`);
      socket.write(`ACK:${this.messageCount}\n`);
    }
  }

  // ─── Buscar conexión por socket ───────────────────────────────────────────

  private _findBySocket(socket: net.Socket): ConnectionData | undefined {
    for (const data of this.connections.values()) {
      if (data.socket === socket) return data;
    }
    return undefined;
  }

  // ─── Enviar comando ───────────────────────────────────────────────────────
  // Busca el dispositivo por IMEI en el Map y envía el comando
  // Solo funciona si el dispositivo ya se autenticó con Login

  sendCommand(imei: string, command: string): boolean {
    const connData = this.connections.get(imei);

    if (!connData) {
      console.warn(`  [TCP] IMEI no encontrado en Map: ${imei}`);
      return false;
    }

    if (!connData.autenticado) {
      console.warn(`  [TCP] Dispositivo ${imei} no autenticado aún`);
      return false;
    }

    connData.socket.write(`${command}\n`);
    console.log(`  [TCP] Comando enviado → ${imei}: ${command}`);
    return true;
  }

  // ─── Getters ─────────────────────────────────────────────────────────────

  // Retorna todos los dispositivos autenticados con sus 6 campos
  // (sin el socket — no serializable)
  getConnectedDevices(): Omit<ConnectionData, 'socket'>[] {
    return Array.from(this.connections.values())
      .filter(d => d.autenticado)
      .map(({ socket, ...rest }) => rest);
  }

  get totalConnections(): number { return this.connections.size; }

  // ─── Ciclo de vida ────────────────────────────────────────────────────────

  start(): void { this.server.listen(this.port, this.host); }

  stop(): void {
    console.log('\n  [TCP] Cerrando conexiones...');
    this.connections.forEach((data, key) => {
      data.socket.end();
      console.log(`  [TCP] Closed: ${key}`);
    });
    this.server.close(() => console.log('  [TCP] Server closed.'));
  }

  private _bindServerEvents(): void {
    this.server.on('listening', () => {
      const addr = this.server.address() as net.AddressInfo;
      console.log('\n  TCP LISTENER — ListenerSoporte');
      console.log(`  Listening on : ${addr.address}:${addr.port}`);
      console.log(`  Protocolo    : TCP persistente`);
      console.log(`  Delimiter    : \\n`);
      console.log('  Waiting for TCP connections...\n');
    });

    this.server.on('error', (error: Error) => {
      const err = error as NodeJS.ErrnoException;
      console.error(`\n  [TCP ERROR] ${error.message}`);
      if (err.code === 'EADDRINUSE') {
        console.error(`  [TCP ERROR] Port ${this.port} is already in use.`);
      }
    });
  }
}