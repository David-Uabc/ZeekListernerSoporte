// config/database.ts
import mongoose from 'mongoose';

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/zeek';
  try {
    await mongoose.connect(uri);
    console.log(`  [DB] Connected → ${uri}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  [DB] Connection failed: ${msg}`);
    process.exit(1);
  }
}