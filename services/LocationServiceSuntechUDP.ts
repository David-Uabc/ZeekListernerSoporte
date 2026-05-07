// services/LocationService.ts — parser Suntech Universal
import { HistoryPosition } from '../models/HistoryPosition';
import { LastPosition }    from '../models/LastPosition';
import type {
  DocumentoGps, InfoRemota,
  LecturaCombustible, LecturaTemperatura, LecturaHumedad,
} from '../types';

const OPERADORES: Record<string, string> = {
  '20': 'Telcel',
  '30': 'Movistar',
  '50': 'AT&T',
};

function obtenerNivelSenal(rssi: number): DocumentoGps['nivelRecepcion'] {
  if (rssi >= 20) return 'Excelente';
  if (rssi >= 15) return 'Muy bueno';
  if (rssi >= 10) return 'Regular';
  if (rssi >= 5)  return 'Malo';
  if (rssi >= 1)  return 'Deficiente';
  return 'Desconocido';
}

function parsearSensores(campos: string[]): {
  combustible: LecturaCombustible[];
  temperatura: LecturaTemperatura[];
  humedad:     LecturaHumedad[];
} {
  const combustible: LecturaCombustible[] = [];
  const temperatura: LecturaTemperatura[] = [];
  const humedad:     LecturaHumedad[]     = [];

  for (let i = 0; i + 2 < campos.length; i += 3) {
    const tipo   = campos[i]?.trim().toUpperCase();
    const numero = campos[i + 1]?.trim();
    const valor  = parseFloat(campos[i + 2]?.trim());

    if (!tipo || !numero || isNaN(valor)) continue;

    if      (tipo === 'FUEL') combustible.push({ tanque: `Tanque ${numero}`, valor });
    else if (tipo === 'TEMP') temperatura.push({ sensor: `Temp ${numero}`,   valor });
    else if (tipo === 'HUM')  humedad.push(    { sensor: `Hum ${numero}`,    valor });
  }

  return { combustible, temperatura, humedad };
}

// Estructura trama Suntech Universal — 28 campos fijos separados por ";"
//  0 tipo reporte   1 deviceId       2 config props   3 modelo
//  4 fw version     5 tiempo real    6 fecha YYYYMMDD  7 hora HH:MM:SS UTC
//  8 cell id        9 mcc           10 mnc            11 lac
// 12 rssi          13 latitud       14 longitud       15 velocidad
// 16 orientacion   17 satelites     18 fix            19 estado entradas
// 20 estado salidas 21 perfil op    22 tipo rep num   23 num secuencia
// 24 voltaje ext   25 voltaje int   26 odometro       27 horometro
// 28+ sensores FUEL/TEMP/HUM opcionales

function construirDocumento(campos: string[], infoRemota: InfoRemota): DocumentoGps {
  const c = campos;

  const fechaStr = c[6]?.trim();
  const horaStr  = c[7]?.trim();
  const fechaHoraUbicacion = fechaStr && horaStr
    ? new Date(`${fechaStr.slice(0, 4)}-${fechaStr.slice(4, 6)}-${fechaStr.slice(6, 8)}T${horaStr}Z`)
    : null;

  const bitsEntrada = parseInt(c[19]?.trim() ?? '0', 2);
  const bitsSalida  = parseInt(c[20]?.trim() ?? '0', 2);
  const rssi        = parseInt(c[12]?.trim() ?? '0');

  const { combustible, temperatura, humedad } = parsearSensores(campos.slice(28));

  return {
    unidadId:           `${c[1]?.trim()}st`,

    fechaHoraUbicacion,
    fechaHoraRecepcion: new Date(),

    latitud:            parseFloat(c[13]?.trim()) || null,
    longitud:           parseFloat(c[14]?.trim()) || null,
    altitud:            null,
    orientacion:        parseFloat(c[16]?.trim()) || null,
    velocidad:          parseFloat(c[15]?.trim()) || null,

    satelites:          parseInt(c[17]?.trim()) || null,
    fix:                c[18]?.trim() === '1',

    ip:                 infoRemota.address,
    puerto:             infoRemota.port,
    protocolo:          'UDP',
    tramaTiempoReal:    c[5]?.trim() === '1',
    estadoGPRS:         c[5]?.trim() === '1' ? 'Ok' : 'Sin conexion',

    gpsMarca:           'Suntech',
    tipoReporte:        c[0]?.trim() === 'STT' ? 'GPS' : 'Alerta',
    evento:             null,
    eventoId:           null,
    numeroSecuencia:    parseInt(c[23]?.trim()) || null,

    estadoIgnicion:     (bitsEntrada & 1) === 1 ? 'Encendido' : 'Apagado',
    estadoApagadoMotor: (bitsSalida  & 1) === 1 ? 'Aplicado'  : 'No aplicado',
    horometro:          parseInt(c[27]?.trim()) || null,
    odometro:           parseInt(c[26]?.trim()) || null,
    voltajeBateria:     parseFloat(c[24]?.trim()) || null,
    porcBateriaInterna: null,

    potencia:           isNaN(rssi) ? null : rssi,
    nivelRecepcion:     obtenerNivelSenal(rssi || 0),
    idRadioBase:        c[8]?.trim()  || null,
    estadoEntradas:     c[19]?.trim() || null,
    estadoSalidas:      c[20]?.trim() || null,
    mcc:                c[9]?.trim()  || null,
    mnc:                c[10]?.trim() || null,
    carrier:            OPERADORES[c[10]?.trim() ?? ''] ?? null,

    combustible,
    temperatura,
    humedad,
    scan: null,

    trama: campos.join(';'),
  };
}

export async function guardarUbicacion(campos: string[], infoRemota: InfoRemota): Promise<void> {
  try {
    const documento = construirDocumento(campos, infoRemota);
    await Promise.all([
      HistoryPosition.create(documento),
      LastPosition.findOneAndUpdate(
        { unidadId: documento.unidadId },
        { $set: documento },
        { upsert: true, returnDocument: 'after' },
      ),
    ]);
    console.log(`  [BD] Suntech guardado → ${documento.unidadId}`);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    console.error(`  [BD] Error al guardar Suntech: ${mensaje}`);
  }
}