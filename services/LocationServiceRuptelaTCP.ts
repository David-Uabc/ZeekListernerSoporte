// services/LocationServiceRuptelaTCP.ts
// Parser Ruptela para conexiones TCP directas con dispositivos en campo
// Maneja 3 tipos de trama según byte[10] (Command Id):
//   0x0F (15)        → Login
//   0x03, 0x07, 0x25 → RespuestaComando
//   cualquier otro   → Ubicacion

import { HistoryPosition } from '../models/HistoryPosition';
import { LastPosition }    from '../models/LastPosition';
import type {
  DocumentoGps, InfoRemota, MapaIOs,
  LecturaCombustible, LecturaTemperatura, LecturaHumedad,
  DatosEscaneo, DefSensorBT, DefIoidEscaneo,
} from '../types';

// --- Tipos

type TipoTrama = 'Login' | 'Ubicacion' | 'RespuestaComando';

export interface ResultadoTrama {
  tipo:              TipoTrama;
  imei?:             string;    // Se devuelve en Login Y Ubicacion para mantener el Map actualizado
  respuestaComando?: string;    // Se devuelve en RespuestaComando (ASCII)
  ack?:              Buffer;    // Respuesta que hay que enviar al dispositivo
}

// --- ACK de Login
// Respuesta fija documentada por el equipo: 00027301CB25
const ACK_LOGIN = Buffer.from('00027301CB25', 'hex');

// --- Lookup

const OPERADORES: Record<string, string> = {
  '334020': 'Telcel',
  '334030': 'Movistar',
  '334050': 'AT&T',
};

const PATRON_HEX = /^[0-9A-Fa-f]+$/;
const PROTOCOLOS_REPORTE_RUPTELA = new Set([0x01, 0x44]);
const ID_COMANDO_LOGIN_RUPTELA = 0x0F;
const IDS_RESPUESTA_COMANDO_RUPTELA = new Set([0x03, 0x07, 0x25]);

function tieneLongitudRuptelaValida(bufer: Buffer): boolean {
  if (bufer.length < 14) return false;
  const longitudDeclarada = bufer.readUInt16BE(0);
  return longitudDeclarada > 0
    && (longitudDeclarada === bufer.length - 4 || longitudDeclarada === bufer.length - 5);
}

function tieneImeiRuptelaValido(bufer: Buffer): boolean {
  if (bufer.length < 10) return false;
  const imei = BigInt('0x' + bufer.slice(2, 10).toString('hex')).toString();
  return imei.length >= 14 && imei.length <= 16;
}

function esPayloadAsciiLegible(bufer: Buffer, inicio: number, fin: number): boolean {
  if (fin <= inicio) return false;
  for (let i = inicio; i < fin; i++) {
    const byte = bufer.readUInt8(i);
    const esImprimible    = byte >= 0x20 && byte <= 0x7E;
    const esControlValido = byte === 0x00 || byte === 0x09 || byte === 0x0A || byte === 0x0D;
    if (!esImprimible && !esControlValido) return false;
  }
  return true;
}

function tienePrefijoAsciiLegible(bufer: Buffer, inicio: number, longitudMinima: number): boolean {
  if (bufer.length - 2 < inicio + longitudMinima) return false;
  for (let i = inicio; i < inicio + longitudMinima; i++) {
    const byte = bufer.readUInt8(i);
    if (byte < 0x20 || byte > 0x7E) return false;
  }
  return true;
}

function puedeLeerIOIDsRuptela(bufer: Buffer, posicion: number): boolean {
  const tamanosValor = [1, 2, 4, 8];
  let cursor = posicion;

  for (const tamanoValor of tamanosValor) {
    if (cursor + 1 > bufer.length - 2) return false;
    const cantidad = bufer.readUInt8(cursor++);

    for (let i = 0; i < cantidad; i++) {
      if (cursor + 2 + tamanoValor > bufer.length - 2) return false;
      cursor += 2 + tamanoValor;
    }
  }

  return cursor <= bufer.length - 2;
}

function esTramaComandoRuptelaValida(bufer: Buffer): boolean {
  const idComando = bufer.readUInt8(10);

  if (idComando === ID_COMANDO_LOGIN_RUPTELA) {
    return bufer.length >= 18 && tienePrefijoAsciiLegible(bufer, 11, 6);
  }

  if (IDS_RESPUESTA_COMANDO_RUPTELA.has(idComando)) {
    return esPayloadAsciiLegible(bufer, 11, bufer.length - 2);
  }

  return false;
}

function esTramaUbicacionRuptelaValida(bufer: Buffer): boolean {
  if (bufer.length < 40) return false;
  if (!PROTOCOLOS_REPORTE_RUPTELA.has(bufer.readUInt8(10))) return false;
  if (![0, 1].includes(bufer.readUInt8(11))) return false;

  const cantidadReportes = bufer.readUInt8(12);
  if (cantidadReportes < 1 || cantidadReportes > 20) return false;

  const fechaUnix = bufer.readUInt32BE(13);
  if (fechaUnix < 1577836800 || fechaUnix > 2051222400) return false;

  const longitudValidacion = hexACoordenada(bufer.slice(20, 24).toString('hex'));
  const latitudValidacion  = hexACoordenada(bufer.slice(24, 28).toString('hex'));
  if (longitudValidacion < -180 || longitudValidacion > 180) return false;
  if (latitudValidacion  < -90  || latitudValidacion  > 90)  return false;

  let posicion = 38;
  for (let i = 0; i < cantidadReportes; i++) {
    if (i > 0) posicion += 25;
    if (!puedeLeerIOIDsRuptela(bufer, posicion)) return false;

    const analizado = parsearIOIDs(bufer, posicion);
    posicion = analizado.posicion;
  }

  return true;
}

export function esTramaTcpRuptela(hexCrudo: string): boolean {
  const hex = hexCrudo.trim();
  if (!hex || hex.length % 2 !== 0 || !PATRON_HEX.test(hex)) return false;

  try {
    const bufer = Buffer.from(hex, 'hex');
    if (!tieneLongitudRuptelaValida(bufer)) return false;
    if (!tieneImeiRuptelaValido(bufer))     return false;

    return esTramaComandoRuptelaValida(bufer) || esTramaUbicacionRuptelaValida(bufer);
  } catch {
    return false;
  }
}

// --- validarTipoTrama
// El byte[10] es el Command Id que determina el tipo de trama

function validarTipoTrama(bufer: Buffer): TipoTrama {
  const idComando = bufer[10];
  switch (idComando) {
    case 0x03:
    case 0x07:
    case 0x25:
      return 'RespuestaComando';
    case 0x0F:
      return 'Login';
    default:
      return 'Ubicacion';
  }
}

// --- Extraer IMEI
// El IMEI siempre está en los bytes 2-9 de la trama Ruptela

function extraerImei(bufer: Buffer): string {
  const imeiHex = bufer.slice(2, 10).toString('hex').toUpperCase();
  return BigInt('0x' + imeiHex).toString();
}

// --- Utilidades

function obtenerNivelSenal(valor: number): DocumentoGps['nivelRecepcion'] {
  if (valor === 31)                return 'Excelente';
  if (valor >= 20 && valor <= 30)  return 'Muy bueno';
  if (valor >= 10 && valor <= 19)  return 'Regular';
  if (valor >= 2  && valor <= 9)   return 'Malo';
  if (valor === 1)                 return 'Deficiente';
  return 'Desconocido';
}

function obtenerPorcentajeBateria(milivolts: number): number {
  return Math.min(100, Math.max(0, Math.round(((milivolts - 3300) / 1000) * 100)));
}

function hexACoordenada(hex: string): number {
  const sinSigno = parseInt(hex, 16);
  const conSigno = sinSigno > 0x7fffffff ? sinSigno - 4294967296 : sinSigno;
  return parseFloat((conSigno / 10000000).toFixed(6));
}

// --- IOIDs

function parsearIOIDs(bufer: Buffer, posicion: number): { ios: MapaIOs; posicion: number } {
  const ios: MapaIOs = {};
  const grupos: Array<{ tamano: number; leer: (b: Buffer, p: number) => number | string }> = [
    { tamano: 1, leer: (b, p) => b.readUInt8(p) },
    { tamano: 2, leer: (b, p) => b.readUInt16BE(p) },
    { tamano: 4, leer: (b, p) => b.readUInt32BE(p) },
    { tamano: 8, leer: (b, p) => (BigInt(b.readUInt32BE(p)) << 32n | BigInt(b.readUInt32BE(p + 4))).toString() },
  ];
  for (const { tamano, leer } of grupos) {
    const cantidad = bufer.readUInt8(posicion++);
    for (let i = 0; i < cantidad; i++) {
      const ioid   = bufer.readUInt16BE(posicion); posicion += 2;
      ios[ioid]    = leer(bufer, posicion);         posicion += tamano;
    }
  }
  return { ios, posicion };
}

// --- Sensores Bluetooth

function parsearSensoresBT<E extends object>(
  ios:            MapaIOs,
  sensores:       DefSensorBT<E>[],
  esValido:       (crudo: number) => boolean,
  convertirValor: (crudo: number) => number,
): Array<E & { valor: number }> {
  return sensores
    .filter(s => { const v = ios[s.ioid]; return v != null && typeof v === 'number' && esValido(v); })
    .map(s   => ({ ...s.label, valor: convertirValor(ios[s.ioid] as number) }));
}

const SENSORES_BT = {
  fuel: [
    { ioid: 779, label: { tanque: 'Tanque 1' } },
    { ioid: 780, label: { tanque: 'Tanque 2' } },
    { ioid: 781, label: { tanque: 'Tanque 3' } },
    { ioid: 782, label: { tanque: 'Tanque 4' } },
  ] satisfies DefSensorBT<{ tanque: string }>[],
  temp: [
    { ioid: 600, label: { sensor: 'Temp 1' } },
    { ioid: 601, label: { sensor: 'Temp 2' } },
    { ioid: 602, label: { sensor: 'Temp 3' } },
    { ioid: 603, label: { sensor: 'Temp 4' } },
  ] satisfies DefSensorBT<{ sensor: string }>[],
  hum: [
    { ioid: 605, label: { sensor: 'Hum 1' } },
    { ioid: 606, label: { sensor: 'Hum 2' } },
    { ioid: 607, label: { sensor: 'Hum 3' } },
    { ioid: 608, label: { sensor: 'Hum 4' } },
  ] satisfies DefSensorBT<{ sensor: string }>[],
};

const esTempValida         = (crudo: number): boolean => crudo !== 65535 && ((crudo >= 0 && crudo <= 850) || (crudo >= 64736 && crudo <= 65534));
const convertirTemp        = (crudo: number): number  => parseFloat(((crudo > 32767 ? crudo - 65536 : crudo) / 10).toFixed(1));
const esHumedadValida      = (crudo: number): boolean => crudo !== 65535 && crudo >= 0 && crudo <= 1000;
const convertirHumedad     = (crudo: number): number  => parseFloat((crudo / 10).toFixed(1));
const esCombustibleValido  = (crudo: number): boolean => crudo !== 65535;
const convertirCombustible = (crudo: number): number  => crudo;

// --- SCAN OBD/CAN

const SCAN_IOIDS: DefIoidEscaneo[] = [
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

function parsearEscaneo(ios: MapaIOs): DatosEscaneo {
  const escaneo: DatosEscaneo = {};
  for (const { ioid, campo, isError, factor } of SCAN_IOIDS) {
    const crudo = ios[ioid];
    if (crudo != null && typeof crudo === 'number' && !isError(crudo)) {
      escaneo[campo] = factor(crudo);
    }
  }
  return escaneo;
}

// --- Handler: Login

async function manejarLogin(bufer: Buffer): Promise<ResultadoTrama> {
  const imei = extraerImei(bufer);

  console.log(`  [TCP][Login] IMEI detectado → ${imei}ru`);
  console.log(`  [TCP][Login] Enviando ACK al dispositivo...`);

  return {
    tipo: 'Login',
    imei,
    ack: ACK_LOGIN,
  };
}

// --- Handler: Ubicacion

async function manejarUbicacion(
  bufer: Buffer, hexCrudo: string, infoRemota: InfoRemota,
): Promise<ResultadoTrama> {
  const imeiHex    = bufer.slice(2, 10).toString('hex').toUpperCase();
  const imei       = BigInt('0x' + imeiHex).toString();
  const unidadId   = `${imei}ru`;
  const enBuffer   = bufer.readUInt8(11) === 1;
  const cantTramas = bufer.readUInt8(12);

  const fechaHoraUbicacion = new Date(bufer.readUInt32BE(13) * 1000);
  const longitud    = hexACoordenada(bufer.slice(20, 24).toString('hex'));
  const latitud     = hexACoordenada(bufer.slice(24, 28).toString('hex'));
  const altitud     = bufer.readUInt16BE(28) / 10;
  const orientacion = bufer.readUInt16BE(30) / 100;
  const satelites   = bufer.readUInt8(32);
  const velocidad   = bufer.readUInt16BE(33);
  const ioidDisparo = bufer.readUInt16BE(36);

  let ios:     MapaIOs = {};
  let posicion: number = 38;

  for (let t = 0; t < cantTramas; t++) {
    if (posicion >= bufer.length - 2) break;
    if (t > 0) posicion += 25;
    if (posicion >= bufer.length - 2) break;
    try {
      const resultado = parsearIOIDs(bufer, posicion);
      ios      = { ...ios, ...resultado.ios };
      posicion = resultado.posicion;
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      console.warn(`  [WARN] Sub-trama ${t + 1}/${cantTramas}: ${mensaje}`);
      break;
    }
  }

  const voltajeBateria     = typeof ios[29] === 'number' ? parseFloat((ios[29] / 1000).toFixed(3)) : null;
  const porcBateriaInterna = typeof ios[30] === 'number' ? obtenerPorcentajeBateria(ios[30]) : null;
  const operadorCrudo      = ios[150] != null ? String(ios[150]) : null;
  const escaneo            = parsearEscaneo(ios);

  const combustible: LecturaCombustible[] = parsearSensoresBT(ios, SENSORES_BT.fuel, esCombustibleValido, convertirCombustible);
  const temperatura: LecturaTemperatura[] = parsearSensoresBT(ios, SENSORES_BT.temp, esTempValida,        convertirTemp);
  const humedad:     LecturaHumedad[]     = parsearSensoresBT(ios, SENSORES_BT.hum,  esHumedadValida,     convertirHumedad);

  const documento: DocumentoGps = {
    unidadId,
    fechaHoraUbicacion,
    fechaHoraRecepcion: new Date(),
    latitud, longitud, altitud, orientacion, velocidad,
    satelites,
    fix:             satelites > 0,
    ip:              infoRemota.address,
    puerto:          infoRemota.port,
    protocolo:       'TCP',
    tramaTiempoReal: !enBuffer,
    estadoGPRS:      'Ok',
    gpsMarca:        'Ruptela',
    tipoReporte:     ioidDisparo === 7 ? 'GPS' : 'Alerta',
    evento:          null,
    eventoId:        ioidDisparo ? String(ioidDisparo) : null,
    numeroSecuencia: null,
    estadoIgnicion:     ios[5]   === 1 ? 'Encendido' : 'Apagado',
    estadoApagadoMotor: ios[405] === 0 ? 'Aplicado'  : 'No aplicado',
    horometro:          escaneo.horometro ?? null,
    odometro:           escaneo.odometro  ?? (typeof ios[65] === 'number' ? ios[65] : null),
    voltajeBateria, porcBateriaInterna,
    potencia:       typeof ios[27] === 'number' ? ios[27] : null,
    nivelRecepcion: obtenerNivelSenal(typeof ios[27] === 'number' ? ios[27] : 0),
    idRadioBase: null, estadoEntradas: null, estadoSalidas: null,
    mcc:     operadorCrudo ? operadorCrudo.slice(0, 3) : null,
    mnc:     operadorCrudo ? operadorCrudo.slice(3)    : null,
    carrier: operadorCrudo ? (OPERADORES[operadorCrudo] ?? null) : null,
    combustible, temperatura, humedad,
    scan: Object.keys(escaneo).length > 0 ? escaneo : null,
    trama: hexCrudo.trim(),
  };

  await Promise.all([
    HistoryPosition.create(documento),
    LastPosition.findOneAndUpdate(
      { unidadId: documento.unidadId },
      { $set: documento },
      { upsert: true, returnDocument: 'after' },
    ),
  ]);

  console.log(`  [TCP][Ubicacion] Guardado → ${unidadId}`);

  return { tipo: 'Ubicacion', imei };
}

// --- Handler: RespuestaComando

async function manejarRespuestaComando(bufer: Buffer): Promise<ResultadoTrama> {
  const imei = extraerImei(bufer);

  const respuestaComando = bufer
    .slice(11, bufer.length - 2)
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

// --- Función principal

export async function procesarTramaRuptela(
  hexCrudo:   string,
  infoRemota: InfoRemota,
): Promise<ResultadoTrama> {
  try {
    const bufer = Buffer.from(hexCrudo.trim(), 'hex');
    const tipo  = validarTipoTrama(bufer);

    console.log(`  [TCP][Ruptela] Tipo: ${tipo}`);

    switch (tipo) {
      case 'Login':
        return await manejarLogin(bufer);
      case 'Ubicacion':
        return await manejarUbicacion(bufer, hexCrudo, infoRemota);
      case 'RespuestaComando':
        return await manejarRespuestaComando(bufer);
    }
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    console.error(`  [TCP][Ruptela] Error: ${mensaje}`);
  }
  return { tipo: 'Ubicacion' };
}