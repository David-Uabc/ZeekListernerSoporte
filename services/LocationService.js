const HistoryPosition = require('../models/HistoryPosition');
const LastPosition    = require('../models/LastPosition');

const CARRIERS = { '20': 'Telcel', '30': 'Movistar', '50': 'AT&T' };

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

// Estructura Suntech Universal — 28 campos fijos separados por ";"
// Índices:
//  0  tipo reporte   (STT/ALT)
//  1  deviceId
//  2  config props
//  3  modelo
//  4  fw version
//  5  tiempo real    (1=si, 0=no)
//  6  fecha          YYYYMMDD
//  7  hora           HH:MM:SS UTC
//  8  cell id
//  9  mcc
// 10  mnc
// 11  lac
// 12  rssi
// 13  latitud
// 14  longitud
// 15  velocidad
// 16  orientacion
// 17  satelites
// 18  fix            (1=si, 0=no)
// 19  input status   binario — bit0 = ignicion
// 20  output status  binario — bit0 = corte motor
// 21  perfil operacion
// 22  tipo reporte num
// 23  num secuencia
// 24  voltaje externo
// 25  voltaje interno
// 26  odometro
// 27  horometro
// 28+ sensores opcionales (FUEL/TEMP/HUM en grupos de 3)

function buildDocument(fields, remoteInfo) {
  const f = fields;

  const dateStr = f[6]?.trim();
  const timeStr = f[7]?.trim();
  const fechaHoraUbicacion = dateStr && timeStr
    ? new Date(`${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}T${timeStr}Z`)
    : null;

  const inputBits  = parseInt(f[19]?.trim() || '0', 2);
  const outputBits = parseInt(f[20]?.trim() || '0', 2);

  const sensorFields = fields.slice(28);
  const { combustible, temperatura, humedad } = parseSensors(sensorFields);

  return {
    // Identificacion — sufijo "st" identifica dispositivos Suntech
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

    // Conexion
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
    // FIX: campo unificado — HistoryPosition usa numeroSecuencias, LastPosition usa numeroSecuencia
    // guardamos en numeroSecuencia (sin s) y el schema de History también se corrigió
    numeroSecuencia:    parseInt(f[23]?.trim())   || null,

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

    // Sin datos SCAN en Suntech
    scan: null,

    // Trama cruda para logs
    trama: fields.join(';'),
  };
}

async function saveLocation(fields, remoteInfo) {
  try {
    const doc = buildDocument(fields, remoteInfo);

    await Promise.all([
      HistoryPosition.create(doc),
      LastPosition.findOneAndUpdate(
        { unidadId: doc.unidadId },
        { $set: doc },
        { upsert: true, returnDocument: 'after' }
      ),
    ]);

    console.log(`  [DB] Saved Suntech → ${doc.unidadId}`);

  } catch (error) {
    console.error(`  [DB] Suntech save error: ${error.message}`);
  }
}

module.exports = { saveLocation };