// index.ts — punto de entrada
import 'dotenv/config';
import { connectDB }  from './config/database';
import UDPListener    from './listener/UDPListener';
import TCPListener    from './listener/TCPListener';

const HOST     = process.env.UDP_HOST  ?? '0.0.0.0';
const UDP_PORT = parseInt(process.env.UDP_PORT ?? '5001');
const TCP_PORT = parseInt(process.env.TCP_PORT ?? '5002');

async function main(): Promise<void> {
  console.log('\n  ListenerSoporte — IoT GPS');
  console.log('  ─────────────────────────────────────────');

  await connectDB();

  // Arrancamos ambos listeners en paralelo
  const udpListener = new UDPListener(HOST, UDP_PORT);
  const tcpListener = new TCPListener(HOST, TCP_PORT);

  udpListener.start();
  tcpListener.start();

  // Cierre limpio — vaciamos batch UDP y cerramos conexiones TCP
  process.on('SIGINT', () => {
    console.log('\n  [Server] Stopping...');
    udpListener.stop();
    tcpListener.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});