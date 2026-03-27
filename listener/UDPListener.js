// Importamos dgram para crear el socket UDP
const dgram = require('dgram');

// Tabla de parsers por marca  cada parser expone saveLocation() con la misma interfaz
// para agregar una marca nueva solo se agrega una linea aqui
// el resto del codigo nunca cambia aunque lleguen cientos de marcas nuevas
const PARSERS = {
  'STUniversal': require('../services/LocationService'),         // Suntech  trama separada por ";"
  'Ruptela':     require('../services/LocationServiceRuptela'),  // Ruptela  trama hexadecimal

  // 'NuevaMarca': require('../services/LocationServiceNuevaMarca'), ← asi se agrega una nueva marca
};

class MessageQueue {

  constructor() {
    // Arreglo que guarda los mensajes esperando ser procesados
    this.queue      = [];
    // Bandera que indica si ya hay un mensaje siendo procesado
    this.processing = false;
    // Si la cola llega a este limite descartamos el mensaje mas viejo
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

    // Sacamos el primer mensaje de la cola (el mas antiguo)
    const item = this.queue.shift();

    try {
      // Llamamos siempre a saveLocation sin importar la marca
      // cada parser sabe como guardar su propia trama en MongoDB
      await PARSERS[item.tipoEquipo].saveLocation(item.datos, item.remoteInfo);
      // y la ejecutaba así await item.parser(item.datos, item.remoteInfo);
    } catch (error) {
      console.error(`  [QUEUE] Processing error: ${error.message}`);
    }

    // Procesamos el siguiente mensaje de forma asincrona
    // setImmediate cede el control al event loop entre mensajes
    // esto evita bloquear el servidor mientras procesa la cola
    setImmediate(() => this._processNext());
  }

  // Regresa cuantos mensajes hay esperando en la cola
  get size() { return this.queue.length; }
}


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

    // Evento message — se dispara automaticamente por cada trama recibida
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

      // Leemos la trama y la marca del paquete recibido
      const parsed = this._parseFrame(rawMessage);
      if (!parsed) return;

      // Verificamos que la marca este registrada en la tabla PARSERS
      if (PARSERS[parsed.marca]) {
        // Metemos a la cola con tipoEquipo en lugar de parser
        // la cola llama a PARSERS[tipoEquipo].saveLocation() al procesar
        this.queue.enqueue({ datos: parsed.datos, remoteInfo, tipoEquipo: parsed.marca });

          //// enqueue guardaba la función directamente this.queue.enqueue({ datos, remoteInfo, parser });


      } else {
        console.warn(`  [WARN] Marca desconocida: ${parsed.marca} — agrega su parser en la tabla PARSERS`);
      }
    });

    // Evento listening — se dispara cuando el servidor arranca correctamente
    this.socket.on('listening', () => {
      const address = this.socket.address();
      console.log('\n  UDP LISTENER — ListenerSoporte');
      console.log(`  Listening on : ${address.address}:${address.port}`);
      console.log('  Queue        : Active (anti-collapse)');
      console.log('  Waiting for GPS frames...\n');
    });

    // Evento error — se dispara si el socket tiene un problema
    this.socket.on('error', (error) => {
      console.error(`\n[ERROR] ${error.message}`);
      if (error.code === 'EADDRINUSE') {
        console.error(`[ERROR] Port ${this.port} is already in use.`);
      }
      this.socket.close();
    });

    // Evento close — se dispara cuando el socket se cierra limpiamente
    this.socket.on('close', () => console.log('\n[Listener] Socket closed.'));
  }

  // Lee el paquete recibido y extrae la trama y la marca del dispositivo
  // El paquete real viene asi: {"NBytes":137,"EndPoint":"...","Trama":"STT;...","Identificar":"STUniversal"}
  // El campo Identificar nos dice la marca sin necesidad de analizar la trama
  _parseFrame(rawMessage) {
    try {
      // Intentamos leer como JSON
      const json = JSON.parse(rawMessage);

      if (!json.Trama) {
        console.warn('  [WARN] JSON received but "Trama" field is missing.');
        return null;
      }

      // Leemos la marca directamente del campo Identificar del JSON
      // si no viene asumimos que es Suntech
      const marca = json.Identificar || 'STUniversal';

      // Suntech necesita los campos separados por ";"
      // Ruptela y demas marcas necesitan la trama cruda completa
      const datos = marca === 'STUniversal'
        ? json.Trama.trim().split(';')
        : json.Trama.trim();

      return { marca, datos };

    } catch (e) {
      // Si no es JSON asumimos que es una trama directa de Suntech
      return {
        marca: 'STUniversal',
        datos: rawMessage.trim().split(';'),
      };
    }
  }

  // Inicia el listener — amarra el socket al puerto configurado
  start() { this.socket.bind(this.port, this.host); }

  // Detiene el listener de forma limpia
  stop()  { this.socket.close(); }
}

module.exports = UDPListener;