// Importamos mongoose para conectarnos a MongoDB
const mongoose = require('mongoose');

// Funcion de conexion a MongoDB
// Es asincrona porque la conexion toma tiempo
async function connectDB() {

  // Leemos la URI del archivo .env
  // Si no existe usamos la conexion local por defecto
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/zeek';

  try {
    await mongoose.connect(uri);
    console.log(`  [DB] Connected → ${uri}`);
  } catch (error) {
    console.error(`  [DB] Connection failed: ${error.message}`);
    // Si no podemos conectar a la DB no tiene sentido seguir corriendo
    process.exit(1);
  }
}

module.exports = connectDB;