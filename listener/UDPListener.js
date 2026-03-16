// Importamos dgram para crear el socket UDP
const dgram = require('dgram');

// Importamos el servicio que guarda en MongoDB
const { saveLocation } = require('../services/LocationService');

// COLA DE MENSAJES anti colapso

class MessageQueue {

  constructor() {
    // Arreglo que guarda los mensajes esperando ser procesados
    this.queue      = [];
    // Bandera que indica si ya hay un mensaje siendo procesado
    this.processing = false;
    // Contador para monitorear el tamaño de la cola
    this.maxSize    = 10000;
  }

  // Agrega un mensaje al final de la cola y arranca el procesamiento
  enqueue(item) {
    // Si la cola esta llena descartamos el mensaje mas viejo
    // para evitar que la memoria se desborde
    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
      console.warn('  [QUEUE] Max size reached — oldest message discarded');
    }

    // Metemos el mensaje al final de la cola
    this.queue.push(item);

    // Si no hay nada procesandose arrancamos el ciclo
    if (!this.processing) this._processNext();
  }

  // Procesa el siguiente mensaje de la cola
  async _processNext() {
    // Si la cola esta vacia terminamos el ciclo
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    // Marcamos que hay algo procesandose para que enqueue no arranque otro ciclo
    this.processing = true;

    // Sacamos el primer mensaje de la cola
    const item = this.queue.shift();

    try {
      // Guardamos en MongoDB — esperamos a que termine antes de continuar
      await saveLocation(item.fields, item.remoteInfo);
    } catch (error) {
      console.error(`  [QUEUE] Processing error: ${error.message}`);
    }

    // Procesamos el siguiente mensaje de forma asincrona
    // setImmediate cede el control al event loop entre mensajes
    // esto evita bloquear el servidor mientras procesa la cola  IMPORTATE
    setImmediate(() => this._processNext());
  }

  // Regresa cuantos mensajes hay esperando en la cola
  get size() { return this.queue.length; }
}

// Clase principal del listener UDP

class UDPListener {

  constructor(host, port) {
    this.host            = host;
    this.port            = port;
    this.socket          = dgram.createSocket('udp4');
    this.messageCount    = 0;
    this.lastFrame       = null;
    this.lastFrameTime   = 0;
    this.duplicateWindow = 2000; // ms — tramas identicas en menos de 2s se ignoran
    this.queue           = new MessageQueue();
    this._bindEvents();
  }

  _bindEvents() {

    // Evento message  se dispara automaticamente por cada trama recibida
    this.socket.on('message', (msg, remoteInfo) => {
      const rawMessage = msg.toString();
      const now        = Date.now();

      // Ignoramos la trama si es identica a la anterior y llego en menos de 2 segundos
      const isDuplicate = rawMessage === this.lastFrame
        && (now - this.lastFrameTime) < this.duplicateWindow;
      if (isDuplicate) return;

      this.lastFrame     = rawMessage;
      this.lastFrameTime = now;
      this.messageCount++;

      console.log(`\n  MESSAGE #${this.messageCount} | Queue: ${this.queue.size} waiting`);
      console.log(`  Time : ${new Date().toLocaleString('es-MX')}`);
      console.log(`  From : ${remoteInfo.address}:${remoteInfo.port} | Size: ${msg.length} bytes`);

      // Parseamos la trama y la metemos a la cola
      // NO guardamos directamente — la cola se encarga de eso
      const fields = this._parseFrame(rawMessage);
      if (fields) {
        this.queue.enqueue({ fields, remoteInfo });
      }
    });

    // Evento listening se dispara cuando el servidor arranca correctamente
    this.socket.on('listening', () => {
      const address = this.socket.address();
      console.log('\n  UDP LISTENER — ListenerSoporte');
      console.log(`  Listening on : ${address.address}:${address.port}`);
      console.log('  Queue        : Active (anti-collapse)');
      console.log('  Waiting for GPS frames...\n');
    });

    // Evento error  se dispara si el socket tiene un problema
    this.socket.on('error', (error) => {
      console.error(`\n[ERROR] ${error.message}`);
      if (error.code === 'EADDRINUSE') {
        console.error(`[ERROR] Port ${this.port} is already in use.`);
      }
      this.socket.close();
    });

    // Evento close  se dispara cuando el socket se cierra limpiamente
    this.socket.on('close', () => console.log('\n[Listener] Socket closed.'));
  }

  // Extrae los campos de la trama  soporta JSON envuelto y trama directa
  _parseFrame(rawMessage) {
    try {
      // Intentamos leer como JSON
      // El paquete real viene asi: {"NBytes":137,"EndPoint":"...","Trama":"STT;..."}
      const json = JSON.parse(rawMessage);
      if (json.Trama) {
        return json.Trama.trim().split(';');
      }
      console.warn('  [WARN] JSON received but "Trama" field is missing.');
      return null;
    } catch (e) {
      // Si no es JSON asumimos que es una trama directa
      return rawMessage.trim().split(';');
    }
  }

  // Inicia el listener — amarra el socket al puerto configurado
  start() { this.socket.bind(this.port, this.host); }

  // Detiene el listener de forma limpia
  stop()  { this.socket.close(); }
}

module.exports = UDPListener;