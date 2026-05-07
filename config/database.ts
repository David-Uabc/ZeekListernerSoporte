// config/database.ts
import mongoose from 'mongoose';

export async function conectarBD(): Promise<void> {
  const uri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/zeek';
  try {
    await mongoose.connect(uri);
    console.log(`  [BD] Conectado → ${uri}`);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    console.error(`  [BD] Error de conexión: ${mensaje}`);
    process.exit(1);
  }
}