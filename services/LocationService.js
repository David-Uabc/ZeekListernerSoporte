// Importamos los modelos que definen las colecciones en MongoDB
const HistoryPosition = require('../models/HistoryPosition');
const LastPosition    = require('../models/LastPosition');

// Tablas de busqueda para traducir valores de la trama al formato de la BD
const CARRIERS = { '20': 'Telcel', '30': 'Movistar', '50': 'AT&T' };

// Calcula el nivel de recepcion en español a partir del RSSI
function getNivelRecepcion(rssi) {
  if (rssi >= 20) return 'Excelente';
  if (rssi >= 15) return 'Muy bueno';
  if (rssi >= 10) return 'Regular';
  if (rssi >= 5)  return 'Malo';
  if (rssi >= 1)  return 'Deficiente';
  return 'Desconocido';
}

// Parsea los campos extra de sensores que vienen despues del campo [27]
// Los sensores vienen en grupos de 3: TIPO;NUMERO;VALOR — ejemplo: FUEL;1;80
function parseSensors(sensorFields) {
  const combustible = [];
  const temperatura = [];
  const humedad     = [];

  for (let i = 0; i + 2 < sensorFields.length; i += 3) {
    const type   = sensorFields[i]?.trim().toUpperCase();
    const number = sensorFields[i + 1]?.trim();
    const value  = parseFloat(sensorFields[i + 2]?.trim());

    // Saltamos el grupo si le falta algun dato o el valor no es numero
    if (!type || !number || isNaN(value)) continue;

    if (type === 'FUEL') {
      combustible.push({ tanque: `Tanque ${number}`, valor: value });
    } else if (type === 'TEMP') {
      temperatura.push({ sensor: `Temp ${number}`, valor: value });
    } else if (type === 'HUM') {
      humedad.push({ sensor: `Hum ${number}`, valor: value });
    }
  }

  return { combustible, temperatura, humedad };
}

// Construye el documento a guardar a partir de la trama parseada y el remoteInfo
// remoteInfo contiene la IP y puerto de donde llego la trama
function buildDocument(fields, remoteInfo) {

  // Los primeros 28 son campos fijos de la trama Suntech Universal
  const f = fields;

  // Construimos la fecha y hora de ubicacion a partir de date y time de la trama
  // La trama manda la fecha como YYYYMMDD y la hora como HH:MM:SS en UTC
  const dateStr = f[6]?.trim(); // YYYYMMDD
  const timeStr = f[7]?.trim(); // HH:MM:SS
  const fechaHoraUbicacion = dateStr && timeStr
    ? new Date(`${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}T${timeStr}Z`)
    : null;

  // El bit0 de inputStatus indica si la ignicion esta encendida
  // parseInt con base 2 convierte el binario "00000001" a numero entero
  const inputBits  = parseInt(f[19]?.trim() || '0', 2);
  const outputBits = parseInt(f[20]?.trim() || '0', 2);

  // Parseamos los sensores que vienen despues del campo [27]
  const sensorFields            = fields.slice(28);
  const { combustible, temperatura, humedad } = parseSensors(sensorFields);

  // Construimos y regresamos el documento completo
  return {
    // Identificacion — agregamos "st" al final del deviceId para Suntech
    unidadId:           `${f[1]?.trim()}st`,

    // Fechas
    fechaHoraUbicacion,
    fechaHoraRecepcion: new Date(),

    // Posicion
    latitud:            parseFloat(f[13]?.trim()) || null,
    longitud:           parseFloat(f[14]?.trim()) || null,
    altitud:            null,
    orientacion:        parseFloat(f[16]?.trim()) || null,
    velocidad:          parseFloat(f[15]?.trim()) || null,

    // Satelites y Fix
    satelites:          parseInt(f[17]?.trim())   || null,
    fix:                f[18]?.trim() === '1',

    // Conexion — la IP y puerto vienen del socket UDP
    ip:                 remoteInfo.address,
    puerto:             remoteInfo.port,
    protocolo:          'UDP',
    tramaTiempoReal:    f[5]?.trim() === '1',
    estadoGPRS:         f[5]?.trim() === '1' ? 'Ok' : 'Sin conexion',

    // Dispositivo GPS
    gpsMarca:           'Suntech',
    tipoReporte:        f[0]?.trim() === 'STT' ? 'GPS' : 'Alerta',
    evento:             null,
    eventoId:           null,
    numeroSecuencia:    parseInt(f[23]?.trim())   || null,
    numeroSecuencias:   parseInt(f[23]?.trim())   || null,

    // Motor y bateria
    estadoIgnicion:     (inputBits  & 1) === 1 ? 'Encendido'   : 'Apagado',
    estadoApagadoMotor: (outputBits & 1) === 1 ? 'Aplicado'    : 'No aplicado',
    horometro:          parseInt(f[27]?.trim())   || null,
    odometro:           parseInt(f[26]?.trim())   || null,
    voltajeBateria:     parseFloat(f[24]?.trim()) || null,
    porcBateriaInterna: null,

    // Senal celular
    potencia:           parseInt(f[12]?.trim())   || null,
    nivelRecepcion:     getNivelRecepcion(parseInt(f[12]?.trim()) || 0),
    idRadioBase:        f[8]?.trim()  || null,
    estadoEntradas:     f[19]?.trim() || null,
    estadoSalidas:      f[20]?.trim() || null,
    mcc:                f[9]?.trim()  || null,
    mnc:                f[10]?.trim() || null,
    carrier:            CARRIERS[f[10]?.trim()] || null,

    // Sensores embebidos
    combustible,
    temperatura,
    humedad,

    // Trama cruda completa — para el apartado de logs en el frontend
    trama: fields.join(';'),
  };
}

// Funcion principal que guarda en las dos colecciones
// HistoryPosition — INSERT siempre, un documento nuevo por cada senal
// LastPosition    — UPSERT por unidadId, sobreescribe la ultima posicion
async function saveLocation(fields, remoteInfo) {
  try {
    // Construimos el documento a guardar
    const doc = buildDocument(fields, remoteInfo);

    // Guardamos en paralelo en ambas colecciones para ser mas rapidos
    await Promise.all([

      // INSERT en historial — siempre crea un documento nuevo
      HistoryPosition.create(doc),

      // UPSERT en ultima posicion — crea si no existe, actualiza si existe
      LastPosition.findOneAndUpdate(
        { unidadId: doc.unidadId },
        { $set: doc },
        { upsert: true, returnDocument: 'after' }
      ),
    ]);

    console.log(`  [DB] Saved → ${doc.unidadId}`);

  } catch (error) {
    console.error(`  [DB] Save error: ${error.message}`);
  }
}

module.exports = { saveLocation };