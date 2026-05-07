// index.ts — punto de entrada
import 'dotenv/config';
import { conectarBD }  from './config/database';
import EscuchadorUDP   from './listener/UDPListener';
import EscuchadorTCP   from './listener/TCPListener';

const HOST       = process.env.UDP_HOST  ?? '0.0.0.0';
const PUERTO_UDP = parseInt(process.env.UDP_PORT ?? '5001');
const PUERTO_TCP = parseInt(process.env.TCP_PORT ?? '5002');

async function principal(): Promise<void> {
  console.log('\n  ListenerSoporte — IoT GPS');
  console.log('  -----------------------------------------');

  await conectarBD();

  // Arrancamos ambos escuchadores en paralelo
  const escuchadorUDP = new EscuchadorUDP(HOST, PUERTO_UDP);
  const escuchadorTCP = new EscuchadorTCP(HOST, PUERTO_TCP);

  escuchadorUDP.iniciar();
  escuchadorTCP.iniciar();

  // Cierre limpio — vaciamos lote UDP y cerramos conexiones TCP
  process.on('SIGINT', () => {
    console.log('\n  [Servidor] Deteniendo...');
    escuchadorUDP.detener();
    escuchadorTCP.detener();
    process.exit(0);
  });
}

principal().catch(error => {
  console.error('\n[FATAL]', error instanceof Error ? error.message : error);
  process.exit(1);
});