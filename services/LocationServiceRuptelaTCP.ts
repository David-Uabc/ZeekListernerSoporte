// services/LocationServiceRuptelaTCP.ts
// Parser Ruptela para conexiones TCP directas con dispositivos en campo
// Maneja 3 tipos de trama según byte[10] (Command Id):
//   0x0F (15)        → Login
//   0x03, 0x07, 0x25 → RespuestaComando
//   cualquier otro   → Ubicacion

import { HistoryPosition } from '../models/HistoryPosition';
import { LastPosition }    from '../models/LastPosition';
import type {
  GpsDocument, RemoteInfo, IOsMap,
  FuelReading, TempReading, HumReading,
  ScanData, BTSensorDef, ScanIoidDef,
} from '../types';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type TipoTrama = 'Login' | 'Ubicacion' | 'RespuestaComando';

export interface TramaResult {
  tipo:              TipoTrama;
  imei?:             string;    // Se devuelve en Login Y Ubicacion para mantener el Map actualizado
  respuestaComando?: string;    // Se devuelve en RespuestaComando (ASCII)
  ack?:              Buffer;    // Respuesta que hay que enviar al dispositivo
}

// ─── ACK de Login ─────────────────────────────────────────────────────────────
// Respuesta fija documentada por el equipo: 00027301CB25
const LOGIN_ACK = Buffer.from('00027301CB25', 'hex');

// ─── Lookup ───────────────────────────────────────────────────────────────────

const CARRIERS: Record<string, string> = {
  '334020': 'Telcel',
  '334030': 'Movistar',
  '334050': 'AT&T',
};

// ─── validarTipoTrama ─────────────────────────────────────────────────────────
// Replica exactamente el método Java validarTipoTramaRuptela()
// El byte[10] es el Command Id que determina el tipo de trama

function validarTipoTrama(buf: Buffer): TipoTrama {
  const commandId = buf[10];
  switch (commandId) {
    case 0x03:
    case 0x07:
    case 0x25:
      return 'RespuestaComando';
    case 0x0F: // 15 decimal = Login
      return 'Login';
    default:
      return 'Ubicacion';
  }
}

// ─── Extraer IMEI ─────────────────────────────────────────────────────────────
// El IMEI siempre está en los bytes 2-9 de la trama Ruptela
// Se convierte de hex a decimal con BigInt para no perder precisión
// El IMEI es la clave del Map — tanto en Login como en cada Ubicacion

function extractImei(buf: Buffer): string {
  const imeiHex = buf.slice(2, 10).toString('hex').toUpperCase();
  return BigInt('0x' + imeiHex).toString();
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

function getSignalLevel(value: number): GpsDocument['nivelRecepcion'] {
  if (value === 31)               return 'Excelente';
  if (value >= 20 && value <= 30) return 'Muy bueno';
  if (value >= 10 && value <= 19) return 'Regular';
  if (value >= 2  && value <= 9)  return 'Malo';
  if (value === 1)                return 'Deficiente';
  return 'Desconocido';
}

function getBatteryPercent(mv: number): number {
  return Math.min(100, Math.max(0, Math.round(((mv - 3300) / 1000) * 100)));
}

function hexToCoordinate(hex: string): number {
  const unsigned = parseInt(hex, 16);
  const signed   = unsigned > 0x7fffffff ? unsigned - 4294967296 : unsigned;
  return parseFloat((signed / 10000000).toFixed(6));
}

// ─── IOIDs ────────────────────────────────────────────────────────────────────

function parseIOIDs(buf: Buffer, offset: number): { ios: IOsMap; offset: number } {
  const ios: IOsMap = {};
  const groups: Array<{ size: number; read: (b: Buffer, o: number) => number | string }> = [
    { size: 1, read: (b, o) => b.readUInt8(o) },
    { size: 2, read: (b, o) => b.readUInt16BE(o) },
    { size: 4, read: (b, o) => b.readUInt32BE(o) },
    { size: 8, read: (b, o) => (BigInt(b.readUInt32BE(o)) << 32n | BigInt(b.readUInt32BE(o + 4))).toString() },
  ];
  for (const { size, read } of groups) {
    const count = buf.readUInt8(offset++);
    for (let i = 0; i < count; i++) {
      const ioid = buf.readUInt16BE(offset); offset += 2;
      ios[ioid]  = read(buf, offset);        offset += size;
    }
  }
  return { ios, offset };
}

// ─── Sensores Bluetooth ───────────────────────────────────────────────────────

function parseBTSensors<L extends object>(
  ios: IOsMap, sensors: BTSensorDef<L>[],
  isValidFn: (raw: number) => boolean,
  convertFn:  (raw: number) => number,
): Array<L & { valor: number }> {
  return sensors
    .filter(s => { const v = ios[s.ioid]; return v != null && typeof v === 'number' && isValidFn(v); })
    .map(s   => ({ ...s.label, valor: convertFn(ios[s.ioid] as number) }));
}

const BT_SENSORS = {
  fuel: [
    { ioid: 779, label: { tanque: 'Tanque 1' } },
    { ioid: 780, label: { tanque: 'Tanque 2' } },
    { ioid: 781, label: { tanque: 'Tanque 3' } },
    { ioid: 782, label: { tanque: 'Tanque 4' } },
  ] satisfies BTSensorDef<{ tanque: string }>[],
  temp: [
    { ioid: 600, label: { sensor: 'Temp 1' } },
    { ioid: 601, label: { sensor: 'Temp 2' } },
    { ioid: 602, label: { sensor: 'Temp 3' } },
    { ioid: 603, label: { sensor: 'Temp 4' } },
  ] satisfies BTSensorDef<{ sensor: string }>[],
  hum: [
    { ioid: 605, label: { sensor: 'Hum 1' } },
    { ioid: 606, label: { sensor: 'Hum 2' } },
    { ioid: 607, label: { sensor: 'Hum 3' } },
    { ioid: 608, label: { sensor: 'Hum 4' } },
  ] satisfies BTSensorDef<{ sensor: string }>[],
};

const isValidTemp = (r: number): boolean => r !== 65535 && ((r >= 0 && r <= 850) || (r >= 64736 && r <= 65534));
const convertTemp = (r: number): number  => parseFloat(((r > 32767 ? r - 65536 : r) / 10).toFixed(1));
const isValidHum  = (r: number): boolean => r !== 65535 && r >= 0 && r <= 1000;
const convertHum  = (r: number): number  => parseFloat((r / 10).toFixed(1));
const isValidFuel = (r: number): boolean => r !== 65535;
const convertFuel = (r: number): number  => r;

// ─── SCAN OBD/CAN ─────────────────────────────────────────────────────────────

const SCAN_IOIDS: ScanIoidDef[] = [
  { ioid: 89,  campo: 'temperaturaAmbiente',       isError: v => v >= 65024 && v <= 65279,           factor: v => parseFloat(((v * 0.03125) - 273).toFixed(2)) },
  { ioid: 90,  campo: 'rendimientoCombustible',    isError: v => v >= 65024 && v <= 65279,           factor: v => parseFloat((v / 512).toFixed(3)) },
  { ioid: 92,  campo: 'presionAceite',             isError: v => v >= 65024 && v <= 65279,           factor: v => parseFloat((v * 0.5).toFixed(1)) },
  { ioid: 114, campo: 'odometro',                  isError: v => v >= 4261412864 && v <= 4278190079, factor: v => v * 5 },
  { ioid: 115, campo: 'temperaturaAnticongelante', isError: v => v === 254,                          factor: v => v },
  { ioid: 197, campo: 'rpm',                       isError: v => v >= 65024 && v <= 65279,           factor: v => parseFloat((v * 0.125).toFixed(1)) },
  { ioid: 203, campo: 'horometro',                 isError: v => v >= 4261412864 && v <= 4278190079, factor: v => parseFloat(((v * 0.05) * 3600).toFixed(2)) },
  { ioid: 206, campo: 'posicionAcelerador',        isError: v => v === 254,                          factor: v => parseFloat((v * 0.4).toFixed(1)) },
  { ioid: 207, campo: 'nivelCombustible',          isError: v => v === 254,                          factor: v => parseFloat((v * 0.4).toFixed(1)) },
  { ioid: 208, campo: 'cargaMotor',                isError: v => v > 250,                            factor: v => parseFloat((v * 0.4).toFixed(1)) },
  { ioid: 210, campo: 'velocidadCAN',              isError: v => v >= 65024 && v <= 65279,           factor: v => parseFloat((v / 256).toFixed(2)) },
];

function parseScan(ios: IOsMap): ScanData {
  const scan: ScanData = {};
  for (const { ioid, campo, isError, factor } of SCAN_IOIDS) {
    const raw = ios[ioid];
    if (raw != null && typeof raw === 'number' && !isError(raw)) {
      scan[campo] = factor(raw);
    }
  }
  return scan;
}

// ─── Handler: Login ───────────────────────────────────────────────────────────
// Extrae el IMEI, devuelve el ACK y el IMEI para que el TCPListener
// use el IMEI como clave del Map desde este momento

async function handleLogin(buf: Buffer): Promise<TramaResult> {
  const imei = extractImei(buf);

  console.log(`  [TCP][Login] IMEI detectado → ${imei}ru`);
  console.log(`  [TCP][Login] Enviando ACK al dispositivo...`);

  return {
    tipo: 'Login',
    imei,       // El TCPListener mueve la entrada del Map a esta clave
    ack: LOGIN_ACK,
  };
}

// ─── Handler: Ubicacion ───────────────────────────────────────────────────────
// Parsea la trama, guarda en MongoDB y devuelve el IMEI
// El IMEI se devuelve para que el TCPListener mantenga el Map actualizado
// en cada reporte — no solo en el Login

async function handleUbicacion(
  buf: Buffer, rawHex: string, remoteInfo: RemoteInfo,
): Promise<TramaResult> {
  const imeiHex    = buf.slice(2, 10).toString('hex').toUpperCase();
  const imei       = BigInt('0x' + imeiHex).toString();
  const unidadId   = `${imei}ru`;
  const inBuffer   = buf.readUInt8(11) === 1;
  const cantTramas = buf.readUInt8(12);

  const fechaHoraUbicacion = new Date(buf.readUInt32BE(13) * 1000);
  const longitud    = hexToCoordinate(buf.slice(20, 24).toString('hex'));
  const latitud     = hexToCoordinate(buf.slice(24, 28).toString('hex'));
  const altitud     = buf.readUInt16BE(28) / 10;
  const orientacion = buf.readUInt16BE(30) / 100;
  const satelites   = buf.readUInt8(32);
  const velocidad   = buf.readUInt16BE(33);
  const triggerIOID = buf.readUInt16BE(36);

  let ios: IOsMap = {};
  let offset      = 38;

  for (let t = 0; t < cantTramas; t++) {
    if (offset >= buf.length - 2) break;
    if (t > 0) offset += 25;
    if (offset >= buf.length - 2) break;
    try {
      const result = parseIOIDs(buf, offset);
      ios    = { ...ios, ...result.ios };
      offset = result.offset;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  [WARN] Sub-trama ${t + 1}/${cantTramas}: ${msg}`);
      break;
    }
  }

  const voltajeBateria     = typeof ios[29] === 'number' ? parseFloat((ios[29] / 1000).toFixed(3)) : null;
  const porcBateriaInterna = typeof ios[30] === 'number' ? getBatteryPercent(ios[30]) : null;
  const carrierRaw         = ios[150] != null ? String(ios[150]) : null;
  const scan               = parseScan(ios);

  const combustible: FuelReading[] = parseBTSensors(ios, BT_SENSORS.fuel, isValidFuel, convertFuel);
  const temperatura: TempReading[] = parseBTSensors(ios, BT_SENSORS.temp, isValidTemp, convertTemp);
  const humedad:     HumReading[]  = parseBTSensors(ios, BT_SENSORS.hum,  isValidHum,  convertHum);

  const doc: GpsDocument = {
    unidadId,
    fechaHoraUbicacion,
    fechaHoraRecepcion: new Date(),
    latitud, longitud, altitud, orientacion, velocidad,
    satelites,
    fix:             satelites > 0,
    ip:              remoteInfo.address,
    puerto:          remoteInfo.port,
    protocolo:       'TCP',
    tramaTiempoReal: !inBuffer,
    estadoGPRS:      'Ok',
    gpsMarca:        'Ruptela',
    tipoReporte:     triggerIOID === 7 ? 'GPS' : 'Alerta',
    evento:          null,
    eventoId:        triggerIOID ? String(triggerIOID) : null,
    numeroSecuencia: null,
    estadoIgnicion:     ios[5]   === 1 ? 'Encendido' : 'Apagado',
    estadoApagadoMotor: ios[405] === 0 ? 'Aplicado'  : 'No aplicado',
    horometro:          scan.horometro ?? null,
    odometro:           scan.odometro  ?? (typeof ios[65] === 'number' ? ios[65] : null),
    voltajeBateria, porcBateriaInterna,
    potencia:       typeof ios[27] === 'number' ? ios[27] : null,
    nivelRecepcion: getSignalLevel(typeof ios[27] === 'number' ? ios[27] : 0),
    idRadioBase: null, estadoEntradas: null, estadoSalidas: null,
    mcc:     carrierRaw ? carrierRaw.slice(0, 3) : null,
    mnc:     carrierRaw ? carrierRaw.slice(3)    : null,
    carrier: carrierRaw ? (CARRIERS[carrierRaw] ?? null) : null,
    combustible, temperatura, humedad,
    scan: Object.keys(scan).length > 0 ? scan : null,
    trama: rawHex.trim(),
  };

  await Promise.all([
    HistoryPosition.create(doc),
    LastPosition.findOneAndUpdate(
      { unidadId: doc.unidadId },
      { $set: doc },
      { upsert: true, returnDocument: 'after' },
    ),
  ]);

  console.log(`  [TCP][Ubicacion] Saved → ${unidadId}`);

  // Devolvemos el IMEI para que el TCPListener mantenga el Map actualizado
  // en cada reporte — el inge confirmó que los siguientes reportes también
  // deben mantener actualizado el diccionario con el socket más reciente
  return { tipo: 'Ubicacion', imei };
}

// ─── Handler: RespuestaComando ────────────────────────────────────────────────
// Convierte el payload de hex a ASCII y lo devuelve para guardarlo en el Map
// Documentación: payload en bytes 11 hasta buf.length-2, convertir a ASCII

async function handleRespuestaComando(buf: Buffer): Promise<TramaResult> {
  const imei = extractImei(buf);

  // Payload: desde byte 11 hasta antes del CRC (últimos 2 bytes)
  const respuestaComando = buf
    .slice(11, buf.length - 2)
    .toString('ascii')
    .trim();

  console.log(`  [TCP][RespuestaComando] IMEI     : ${imei}ru`);
  console.log(`  [TCP][RespuestaComando] Respuesta: ${respuestaComando}`);

  return {
    tipo: 'RespuestaComando',
    imei,
    respuestaComando,
  };
}

// ─── Función principal ────────────────────────────────────────────────────────

export async function procesarTramaRuptela(
  rawHex:     string,
  remoteInfo: RemoteInfo,
): Promise<TramaResult> {
  try {
    const buf  = Buffer.from(rawHex.trim(), 'hex');
    const tipo = validarTipoTrama(buf);

    console.log(`  [TCP][Ruptela] Tipo: ${tipo}`);

    switch (tipo) {
      case 'Login':
        return await handleLogin(buf);
      case 'Ubicacion':
        return await handleUbicacion(buf, rawHex, remoteInfo);
      case 'RespuestaComando':
        return await handleRespuestaComando(buf);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  [TCP][Ruptela] Error: ${msg}`);
  }
  return { tipo: 'Ubicacion' };
}