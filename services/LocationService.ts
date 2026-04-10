// services/LocationService.ts — parser Suntech Universal
import { HistoryPosition } from '../models/HistoryPosition';
import { LastPosition }    from '../models/LastPosition';
import type { GpsDocument, RemoteInfo, FuelReading, TempReading, HumReading } from '../types';

const CARRIERS: Record<string, string> = {
  '20': 'Telcel',
  '30': 'Movistar',
  '50': 'AT&T',
};

function getSignalLevel(rssi: number): GpsDocument['nivelRecepcion'] {
  if (rssi >= 20) return 'Excelente';
  if (rssi >= 15) return 'Muy bueno';
  if (rssi >= 10) return 'Regular';
  if (rssi >= 5)  return 'Malo';
  if (rssi >= 1)  return 'Deficiente';
  return 'Desconocido';
}

function parseSensors(fields: string[]): {
  combustible: FuelReading[];
  temperatura: TempReading[];
  humedad:     HumReading[];
} {
  const combustible: FuelReading[] = [];
  const temperatura: TempReading[] = [];
  const humedad:     HumReading[]  = [];

  for (let i = 0; i + 2 < fields.length; i += 3) {
    const type   = fields[i]?.trim().toUpperCase();
    const number = fields[i + 1]?.trim();
    const value  = parseFloat(fields[i + 2]?.trim());

    if (!type || !number || isNaN(value)) continue;

    if      (type === 'FUEL') combustible.push({ tanque: `Tanque ${number}`, valor: value });
    else if (type === 'TEMP') temperatura.push({ sensor: `Temp ${number}`,   valor: value });
    else if (type === 'HUM')  humedad.push(    { sensor: `Hum ${number}`,    valor: value });
  }

  return { combustible, temperatura, humedad };
}

// Estructura trama Suntech Universal — 28 campos fijos separados por ";"
//  0 tipo reporte   1 deviceId       2 config props   3 modelo
//  4 fw version     5 tiempo real    6 fecha YYYYMMDD  7 hora HH:MM:SS UTC
//  8 cell id        9 mcc           10 mnc            11 lac
// 12 rssi          13 latitud       14 longitud       15 velocidad
// 16 orientacion   17 satelites     18 fix            19 input status
// 20 output status 21 perfil op     22 tipo rep num   23 num secuencia
// 24 voltaje ext   25 voltaje int   26 odometro       27 horometro
// 28+ sensores FUEL/TEMP/HUM opcionales

function buildDocument(fields: string[], remoteInfo: RemoteInfo): GpsDocument {
  const f = fields;

  const dateStr = f[6]?.trim();
  const timeStr = f[7]?.trim();
  const fechaHoraUbicacion = dateStr && timeStr
    ? new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T${timeStr}Z`)
    : null;

  const inputBits  = parseInt(f[19]?.trim() ?? '0', 2);
  const outputBits = parseInt(f[20]?.trim() ?? '0', 2);
  const rssi       = parseInt(f[12]?.trim() ?? '0');

  const { combustible, temperatura, humedad } = parseSensors(fields.slice(28));

  return {
    unidadId:           `${f[1]?.trim()}st`,

    fechaHoraUbicacion,
    fechaHoraRecepcion: new Date(),

    latitud:            parseFloat(f[13]?.trim()) || null,
    longitud:           parseFloat(f[14]?.trim()) || null,
    altitud:            null,
    orientacion:        parseFloat(f[16]?.trim()) || null,
    velocidad:          parseFloat(f[15]?.trim()) || null,

    satelites:          parseInt(f[17]?.trim()) || null,
    fix:                f[18]?.trim() === '1',

    ip:                 remoteInfo.address,
    puerto:             remoteInfo.port,
    protocolo:          'UDP',
    tramaTiempoReal:    f[5]?.trim() === '1',
    estadoGPRS:         f[5]?.trim() === '1' ? 'Ok' : 'Sin conexion',

    gpsMarca:           'Suntech',
    tipoReporte:        f[0]?.trim() === 'STT' ? 'GPS' : 'Alerta',
    evento:             null,
    eventoId:           null,
    numeroSecuencia:    parseInt(f[23]?.trim()) || null,

    estadoIgnicion:     (inputBits  & 1) === 1 ? 'Encendido' : 'Apagado',
    estadoApagadoMotor: (outputBits & 1) === 1 ? 'Aplicado'  : 'No aplicado',
    horometro:          parseInt(f[27]?.trim()) || null,
    odometro:           parseInt(f[26]?.trim()) || null,
    voltajeBateria:     parseFloat(f[24]?.trim()) || null,
    porcBateriaInterna: null,

    potencia:           isNaN(rssi) ? null : rssi,
    nivelRecepcion:     getSignalLevel(rssi || 0),
    idRadioBase:        f[8]?.trim()  || null,
    estadoEntradas:     f[19]?.trim() || null,
    estadoSalidas:      f[20]?.trim() || null,
    mcc:                f[9]?.trim()  || null,
    mnc:                f[10]?.trim() || null,
    carrier:            CARRIERS[f[10]?.trim() ?? ''] ?? null,

    combustible,
    temperatura,
    humedad,
    scan: null,

    trama: fields.join(';'),
  };
}

export async function saveLocation(fields: string[], remoteInfo: RemoteInfo): Promise<void> {
  try {
    const doc = buildDocument(fields, remoteInfo);
    await Promise.all([
      HistoryPosition.create(doc),
      LastPosition.findOneAndUpdate(
        { unidadId: doc.unidadId },
        { $set: doc },
        { upsert: true, returnDocument: 'after' },
      ),
    ]);
    console.log(`  [DB] Saved Suntech → ${doc.unidadId}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  [DB] Suntech save error: ${msg}`);
  }
}