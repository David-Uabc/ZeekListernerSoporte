// index.ts
import 'dotenv/config';
import { connectDB } from './config/database';
import UDPListener   from './listener/UDPListener';

const HOST = process.env.UDP_HOST ?? '0.0.0.0';
const PORT = parseInt(process.env.UDP_PORT ?? '5001');

async function main(): Promise<void> {
  console.log('\n  ListenerSoporte — IoT GPS');
  console.log('  ─────────────────────────────────────────');

  await connectDB();

  const listener = new UDPListener(HOST, PORT);
  listener.start();

  process.on('SIGINT', () => {
    console.log('\n  [Server] Stopping...');
    listener.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});