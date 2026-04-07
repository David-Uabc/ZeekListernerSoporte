//paseador de ruptela
const HistoryPosition = require('../models/HistoryPosition');
const LastPosition    = require('../models/LastPosition');

// Tabla de operadores de telefonia a partir del valor del IOID 150
// El valor combina MCC y MNC, ejemplo 334020 = Mexico Telcel
const CARRIERS = {
  '334020': 'Telcel',
  '334030': 'Movistar',
  '334050': 'AT&T',
};

// Tabla de tecnologias de comunicacion a partir del IOID 762
const TECHNOLOGIES = {
  0:  '2G',
  2:  '3G',
  7:  'LTE Cat 1',
  8:  'CAT-M1',
  9:  'NB-IoT',
  10: 'CAT1/CAT4',
};

// El valor 65535 significa que el sensor no tiene lectura — se guarda como null
// El valor 0 si es un valor valido en lecturas de sensores
const NULL_VALUE_16 = 65535;

// Codigos de error para sensores del Scan  rangos que indican lectura invalida
// Si el valor cae en estos rangos se guarda como null
const SCAN_ERROR_RANGE_16  = (v) => v >= 65024 && v <= 65279;   // error en sensores de 2 bytes // TemAmbiente,RendiCombus,rpm, VelociCan
const SCAN_ERROR_RANGE_32  = (v) => v >= 4261412864 && v <= 4278190079; // error en sensores de 4 bytes // odometro y horometro
const SCAN_ERROR_BYTE      = (v) => v === 254; // error en sensores de 1 byte // anticongelante, posicionAcelerador y nivel de combustible

// Traduce el nivel de señal del IOID 27 a palabras en español
// Ruptela usa una escala del 0 al 31 — diferente a Suntech
function getSignalLevel(value) {
  if (value === 31)               return 'Excelente';
  if (value >= 20 && value <= 30) return 'Muy bueno';
  if (value >= 10 && value <= 19) return 'Regular';
  if (value >= 2  && value <= 9)  return 'Malo';
  if (value === 1)                return 'Deficiente';
  return 'Desconocido';
}

// Convierte el voltaje de la bateria interna a porcentaje
// El dispositivo reporta milivolts, el rango util es de 3300 a 4300
function getBatteryPercent(millivolts) {
  const MIN  = 3300;
  const MAX  = 4300;
  const perc = ((millivolts - MIN) / (MAX - MIN)) * 100;
  // Nos aseguramos de que el resultado quede entre 0 y 100
  return Math.min(100, Math.max(0, Math.round(perc)));
}

function hexToCoordinate(hex) {
  const unsigned = parseInt(hex, 16); // Convertimos el texto hexadecimal a un numero entero sin signo // ejemplo: "BA57B707" se convierte en 3126683399
  const signed   = unsigned > 0x7FFFFFFF ? unsigned - 4294967296 : unsigned;//  // Revisamos si el numero es mayor a 2,147,483,647 que es el maximo de un numero positivo de 4 bytes 
  return signed / 10000000;/// Dividimos entre 10,000,000 para convertir el numero entero a grados decimales
}

// Verifica si un valor es nulo segun el protocolo Ruptela
// 65535 significa que el accesorio no tiene lectura disponible
function isNullValue(value) {
  return value === NULL_VALUE_16;
}

function parseIOIDs(buf, offset) {
  const ios = {};  // Diccionario vacio donde guardaremos todos los sensores que vienen en la trama
// valores simples de 0 o 1 
  const count1 = buf.readUInt8(offset++);  // Grupo de sensores con valor de 1 byte 

  for (let i = 0; i < count1; i++) {  // Leemos cada sensor del grupo uno por uno la trama nos dice primero cuantos sensores de 1 byte vienen en este grupo
    const ioid  = buf.readUInt16BE(offset); offset += 2;    // Los primeros 2 bytes de cada sensor son su numero de identificacion (IOID)
    const value = buf.readUInt8(offset);    offset += 1;    // El siguiente byte es el valor del sensor
    ios[ioid]   = value;    // Guardamos el sensor en el diccionario usando su IOID como llave
  }

  //para obtener el voltaje y la bateria
  const count2 = buf.readUInt8(offset++);//Grupo de sensores con valor de 2 bytes
  for (let i = 0; i < count2; i++) {
    const ioid  = buf.readUInt16BE(offset); offset += 2;
    const value = buf.readUInt16BE(offset); offset += 2; //Ahora el valor ocupa 2 bytes en lugar de 1
    ios[ioid]   = value;
  }
//valores muy grandes como el odometro y operador de telefonia
  const count4 = buf.readUInt8(offset++); //Grupo de sensores con valor de 4 bytes
  for (let i = 0; i < count4; i++) {
    const ioid  = buf.readUInt16BE(offset); offset += 2;
    const value = buf.readUInt32BE(offset); offset += 4;  // Ahora el valor ocupa 4 bytes
    ios[ioid]   = value;
  }
//esto lo manejamos para sensores futuros que manejan numeros muy grandes
  const count8 = buf.readUInt8(offset++); //Grupo de sensores con valor de 8 bytes
  for (let i = 0; i < count8; i++) {
    const ioid = buf.readUInt16BE(offset); offset += 2;
    const high = buf.readUInt32BE(offset);     offset += 4;//lo leemos en dos partes de 4 bytes cada una  la parte alta y la parte baja
    const low  = buf.readUInt32BE(offset);     offset += 4;
    ios[ioid]  = (BigInt(high) << 32n | BigInt(low)).toString();// Combinamos las dos partes usando BigInt para no perder precision y une las dos partes en un solo numero
  }
  return ios;  //Regresamos el diccionario completo con todos  los sensores
}

// Extrae los sensores de combustible Bluetooth de los IOIDs 779 al 782
// Si el valor es 65535 significa que el tanque no tiene lectura  se guarda como null
function parseFuel(ios) {
  const tanques = [
    { ioid: 779, tanque: 'Tanque 1' },
    { ioid: 780, tanque: 'Tanque 2' },
    { ioid: 781, tanque: 'Tanque 3' },
    { ioid: 782, tanque: 'Tanque 4' },
  ];

  return tanques
    // Solo incluimos los tanques que vienen en la trama
    .filter(t => ios[t.ioid] != null)
    // Si el valor es 65535 es nulo  no lo incluimos
    .filter(t => !isNullValue(ios[t.ioid]))
    .map(t => ({ tanque: t.tanque, valor: ios[t.ioid] }));
}

// Extrae los sensores de temperatura Bluetooth de los IOIDs 600 al 603
// El valor final se divide entre 10 para obtener grados centigrados
// Si el valor es 65535 significa que el sensor no tiene lectura  se guarda como null
function parseTemperature(ios) {
  const sensores = [
    { ioid: 600, sensor: 'Temp 1' },
    { ioid: 601, sensor: 'Temp 2' },
    { ioid: 602, sensor: 'Temp 3' },
    { ioid: 603, sensor: 'Temp 4' },
  ];

  return sensores
    // Solo incluimos los sensores que vienen en la trama
    .filter(s => ios[s.ioid] != null)
    // Si el valor es 65535 es nulo — no lo incluimos
    .filter(s => !isNullValue(ios[s.ioid]))
    // Dividimos entre 10 para obtener grados centigrados reales
    .map(s => ({ sensor: s.sensor, valor: ios[s.ioid] / 10 }));
}

// Extrae los sensores de humedad Bluetooth de los IOIDs 605 al 608
// El valor final se divide entre 10 para obtener el porcentaje real
// Si el valor es 65535 significa que el sensor no tiene lectura  se guarda como null
function parseHumidity(ios) {
  const sensores = [
    { ioid: 605, sensor: 'Hum 1' },
    { ioid: 606, sensor: 'Hum 2' },
    { ioid: 607, sensor: 'Hum 3' },
    { ioid: 608, sensor: 'Hum 4' },
  ];

  return sensores
    // Solo incluimos los sensores que vienen en la trama
    .filter(s => ios[s.ioid] != null)
    // Si el valor es 65535 es nulo — no lo incluimos
    .filter(s => !isNullValue(ios[s.ioid]))
    // Dividimos entre 10 para obtener el porcentaje real
    .map(s => ({ sensor: s.sensor, valor: ios[s.ioid] / 10 }));
}

// Extrae los parametros del Scan (OBD/CAN) del vehiculo
// Cada parametro tiene su propia formula de conversion y su propio codigo de error
// Si el valor cae en el rango de error se guarda como null
function parseScan(ios) {
  const scan = {};

  // IOID 89  Temperatura ambiente en grados centigrados
  // Rango de error: 65024 al 65279
  // Formula: (valor * 0.03125) - 273
  if (ios[89] != null && !SCAN_ERROR_RANGE_16(ios[89])) {
    scan.temperaturaAmbiente = parseFloat(((ios[89] * 0.03125) - 273).toFixed(2));
  }
  // IOID 90  Rendimiento de combustible en km/L
  // Rango de error: 65024 al 65279
  // Formula: valor * (1 / 512)
  if (ios[90] != null && !SCAN_ERROR_RANGE_16(ios[90])) {
    scan.rendimientoCombustible = parseFloat((ios[90] * (1 / 512)).toFixed(3));
  }

  // IOID 114  Odometro en metros
  // Rango de error: 4261412864 al 4278190079
  // Formula: valor * 5
  if (ios[114] != null && !SCAN_ERROR_RANGE_32(ios[114])) {
    scan.odometro = ios[114] * 5;
  }

  // IOID 115  Temperatura del anticongelante en grados centigrados
  // Codigo de error: 254
  // No requiere formula de conversion
  if (ios[115] != null && !SCAN_ERROR_BYTE(ios[115])) {
    scan.temperaturaAnticongelante = ios[115];
  }

  // IOID 197  Revoluciones por minuto
  // Rango de error: 65024 al 65279
  // Formula: valor * 0.125
  if (ios[197] != null && !SCAN_ERROR_RANGE_16(ios[197])) {
    scan.rpm = parseFloat((ios[197] * 0.125).toFixed(1));
  }

  // IOID 203  Horometro en horas
  // Rango de error: 4261412864 al 4278190079
  // Formula: (valor * 0.05) * 3600
  if (ios[203] != null && !SCAN_ERROR_RANGE_32(ios[203])) {
    scan.horometro = parseFloat(((ios[203] * 0.05) * 3600).toFixed(2));
  }

  // IOID 206  Posicion del acelerador en porcentaje
  // Codigo de error: 254
  // Formula: valor * 0.4
  if (ios[206] != null && !SCAN_ERROR_BYTE(ios[206])) {
    scan.posicionAcelerador = parseFloat((ios[206] * 0.4).toFixed(1));
  }

  // IOID 207  Nivel de combustible en porcentaje
  // Codigo de error: 254
  // Formula: valor * 0.4
  if (ios[207] != null && !SCAN_ERROR_BYTE(ios[207])) {
    scan.nivelCombustible = parseFloat((ios[207] * 0.4).toFixed(1));
  }

  // IOID 210  Velocidad en km/h
  // Rango de error: 65024 al 65279
  // Formula: valor * (1 / 256)
  if (ios[210] != null && !SCAN_ERROR_RANGE_16(ios[210])) {
    scan.velocidadCAN = parseFloat((ios[210] * (1 / 256)).toFixed(2));
  }

  return scan;
}

function buildDocument(rawHex, remoteInfo) {

  const buf = Buffer.from(rawHex.trim(), 'hex');  // Convertimos el texto hexadecimal a bytes reales en memoria sin esto no podriamos leer posicion por posicion

  const imeiHex  = buf.slice(2, 10).toString('hex').toUpperCase();  // Cortamos los bytes del 2 al 9 que son donde vive el IMEI en la trama, el slide es para cortar los  bytes
  const imeiDec  = BigInt('0x' + imeiHex).toString();// Convertimos el IMEI de hexadecimal a numero decimal usamos bigint para que JavaScript no redondee los digitos
  const unidadId = `${imeiDec}ru`;  // Agregamos "ru" al final para identificar que este vehiculo es un dispositivo Ruptela
  const inBuffer = buf.readUInt8(11) === 1;  // Leemos el byte 11 que nos dice si la trama venia guardada en la memoria del dispositivo
  const timestamp = buf.readUInt32BE(13);  // Leemos los bytes 13 al 16 que son los segundos transcurridos desde el 1 de enero de 1970
  const fechaHoraUbicacion = new Date(timestamp * 1000);  // Multiplicamos por 1000 para convertir de segundos a milisegundos esto lo hago porque javascript los necesita en milis para que se pueda guardar en mongo

  // Coordenadas 
  const longitud = hexToCoordinate(buf.slice(20, 24).toString('hex')); // Los bytes 20 al 23 son la longitud  los cortamos y los convertimos a grados decimales
  const latitud  = hexToCoordinate(buf.slice(24, 28).toString('hex'));// Los bytes 24 al 27 son la latitud  mismo proceso que la longitud
  const altitud  = buf.readUInt16BE(28) / 10;// Los bytes 28 y 29 son la altitud  el dispositivo la manda multiplicada por 10 entonces dividimos
  const orientacion = buf.readUInt16BE(30) / 100;// Los bytes 30 y 31 son el angulo de orientacion  el dispositivo lo manda multiplicado por 100 entonces dividimos
  const satelites = buf.readUInt8(32);// El byte 32 es el numero de satelites visibles  se lee directo sin conversion
  const velocidad = buf.readUInt16BE(33);// Los bytes 33 y 34 son la velocidad en km/h se lee directo sin conversion
  const triggerIOID = buf.readUInt16BE(36);// Los bytes 36 y 37 nos dicen que sensor genero este reporte ejemplo: 7 = reporte por tiempo programado
  const ios = parseIOIDs(buf, 38);// A partir del byte 38 vienen todos los sensores  los leemos todos de una vez
  const ignicion = ios[5] === 1 ? 'Encendido' : 'Apagado';// IOID 5 es la linea de ignicion  si vale 1 esta encendida, si vale 0 esta apagada
  const motorCortado = ios[405] === 0 ? 'Aplicado' : 'No aplicado';// IOID 405 es el corte de motor  en Ruptela los valores estan invertidos si vale 0 el corte esta activado, si vale 1 esta desactivado
  const nivelRecepcion = getSignalLevel(ios[27] ?? 0);// IOID 27 es el nivel de señal  lo pasamos a nuestra funcion que lo convierte a palabras
  const voltajeBateria = ios[29] != null ? ios[29] / 1000 : null;// IOID 29 es el voltaje de la fuente de alimentacion en milivolts  dividimos entre 1000 para obtener volts si no viene en la trama guardamos null
  const porcBateriaInterna = ios[30] != null ? getBatteryPercent(ios[30]) : null;// IOID 30 es el voltaje de la bateria interna  lo convertimos a porcentaje con nuestra funcion
  const odometro = ios[65] ?? null;// IOID 65 es el odometro en metros  si no viene en la trama guardamos null
  const carrierRaw = ios[150] != null ? String(ios[150]) : null;// IOID 150 es el operador de telefonia  viene como numero combinado de MCC y MNC ejemplo: 334020
  const carrier = carrierRaw ? (CARRIERS[carrierRaw] || null) : null;// Buscamos el numero en nuestra tabla de carriers para obtener el nombre del operador
  const mcc = carrierRaw ? carrierRaw.slice(0, 3) : null;// Los primeros 3 digitos son el MCC  codigo del pais, ejemplo: 334 = Mexico
  const mnc = carrierRaw ? carrierRaw.slice(3)    : null;// Los digitos restantes son el MNC  codigo del operador, ejemplo: 020 = Telcel

  // Extraemos los sensores Bluetooth — combustible, temperatura y humedad
  // Cada funcion revisa sus IOIDs y filtra los valores nulos (65535)
  const combustible = parseFuel(ios);
  const temperatura = parseTemperature(ios);
  const humedad     = parseHumidity(ios);

  // Extraemos los parametros del Scan (OBD/CAN) del vehiculo
  // Solo se incluyen los que vienen en la trama y no tienen codigo de error
  const scan = parseScan(ios);

  // Construimos y regresamos el documento con el mismo formato que Suntech
  return {
    // Identificacion
    unidadId,

    // Fechas
    fechaHoraUbicacion,
    fechaHoraRecepcion: new Date(),

    // Posicion
    latitud,
    longitud,
    altitud,
    orientacion,
    velocidad,

    // Satelites y Fix
    satelites,
    // Si hay satelites asumimos que el GPS tiene señal y la posicion es valida
    fix: satelites > 0,

    // Conexion
    ip:              remoteInfo.address,
    puerto:          remoteInfo.port,
    protocolo:       'UDP',
    // Si la trama venia en memoria del dispositivo no es tiempo real
    tramaTiempoReal: !inBuffer,
    estadoGPRS:      'Ok',

    // Dispositivo GPS
    gpsMarca:           'Ruptela', 
    // Si el sensor que genero el reporte es el 7 es una ubicacion normal
    // cualquier otro sensor indica que fue una alerta
    tipoReporte:        triggerIOID === 7 ? 'GPS' : 'Alerta',
    evento:             null,
    eventoId:           triggerIOID ? String(triggerIOID) : null,
    numeroSecuencia:    null,
    numeroSecuencias:   null,

    // Motor y bateria
    estadoIgnicion:     ignicion,
    estadoApagadoMotor: motorCortado,
    // Si el Scan tiene horometro lo usamos — si no queda null
    horometro:          scan.horometro ?? null,
    // Si el Scan tiene odometro lo usamos — si no usamos el IOID 65
    odometro:           scan.odometro ?? odometro,
    voltajeBateria,
    porcBateriaInterna,

    // Senal celular
    potencia:         ios[27] ?? null,
    nivelRecepcion,
    idRadioBase:      null,
    estadoEntradas:   null,
    estadoSalidas:    null,
    mcc,
    mnc,
    carrier,

    // Sensores Bluetooth — combustible, temperatura y humedad
    // Solo se guardan los que vienen en la trama y no tienen valor nulo (65535)
    combustible,
    temperatura,
    humedad,

    // Parametros del Scan (OBD/CAN) — solo los que vienen y no tienen codigo de error
    // Se guardan como objeto separado para que el frontend los pueda mostrar
    scan: Object.keys(scan).length > 0 ? scan : null,

    // Trama cruda completa  para el apartado de logs en el frontend
    trama: rawHex.trim(),
  };
}

// Funcion principal — guarda en historypositions y lastpositions
// Mismas colecciones que Suntech, mismo formato de documento
// Nombre cambiado de saveLocationRuptela a saveLocation
// para que todos los parsers expongan la misma interfaz
async function saveLocation(rawHex, remoteInfo) {
  try {
    const doc = buildDocument(rawHex, remoteInfo);

    // Guardamos en paralelo en ambas colecciones
    await Promise.all([

      // Guardamos en el historial  siempre crea un documento nuevo
      HistoryPosition.create(doc),

      // Actualizamos la posicion actual  si no existe la crea, si existe la sobreescribe
      LastPosition.findOneAndUpdate(
        { unidadId: doc.unidadId },
        { $set: doc },
        { upsert: true, returnDocument: 'after' }
      ),
    ]);

    console.log(`  [DB] Saved Ruptela → ${doc.unidadId}`);

  } catch (error) {
    console.error(`  [DB] Ruptela save error: ${error.message}`);
  }
}

//  Export cambiado de saveLocationRuptela a saveLocation
// todos los parsers exportan saveLocation  interfaz uniforme
module.exports = { saveLocation };