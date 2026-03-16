// Cargamos las variables de entorno del archivo .env
require('dotenv').config();

// Importamos la funcion de conexion a MongoDB
const connectDB   = require('./config/database');

// Importamos el listener UDP con cola anti-colapso
const UDPListener = require('./listener/UDPListener');

// Configuracion del servidor UDP
// Se leen del .env o se usan valores por defecto
const HOST = process.env.UDP_HOST || '0.0.0.0';
const PORT = parseInt(process.env.UDP_PORT) || 5001;

// Funcion principal asincrona
// Primero conectamos a MongoDB y luego arrancamos el listener
async function main() {
  console.log('\n  ListenerSoporte — IoT GPS');
  console.log('  ─────────────────────────────────────────');

  // Conectamos a MongoDB antes de arrancar el listener
  // Si la conexion falla el proceso termina automaticamente en database.js
  await connectDB();

  // Creamos e iniciamos el listener UDP
  const listener = new UDPListener(HOST, PORT);
  listener.start();

  // Manejamos el cierre limpio cuando el usuario presiona CTRL+C
  process.on('SIGINT', () => {
    console.log('\n  [Server] Stopping...');
    listener.stop();
    process.exit(0);
  });
}

// Ejecutamos la funcion principal
main().catch(err => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});