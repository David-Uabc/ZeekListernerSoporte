// services/LocationServiceRuptela.ts — parser Ruptela (trama hex binaria)
import { HistoryPosition } from '../models/HistoryPosition';
import { LastPosition }    from '../models/LastPosition';
import type {
  DocumentoGps, InfoRemota, MapaIOs,
  LecturaCombustible, LecturaTemperatura, LecturaHumedad,
  DatosEscaneo, DefSensorBT, DefIoidEscaneo,
} from '../types';

// --- Lookup ------------------------------------------------------------------

const OPERADORES: Record<string, string> = {
  '334020': 'Telcel',
  '334030': 'Movistar',
  '334050': 'AT&T',
};

// --- Señal -------------------------------------------------------------------

function obtenerNivelSenal(valor: number): DocumentoGps['nivelRecepcion'] {
  if (valor === 31)                return 'Excelente';
  if (valor >= 20 && valor <= 30)  return 'Muy bueno';
  if (valor >= 10 && valor <= 19)  return 'Regular';
  if (valor >= 2  && valor <= 9)   return 'Malo';
  if (valor === 1)                 return 'Deficiente';
  return 'Desconocido';
}

// --- Batería -----------------------------------------------------------------

function obtenerPorcentajeBateria(milivolts: number): number {
  return Math.min(100, Math.max(0, Math.round(((milivolts - 3300) / 1000) * 100)));
}

// --- Coordenadas -------------------------------------------------------------

function hexACoordenada(hex: string): number {
  const sinSigno = parseInt(hex, 16);
  const conSigno = sinSigno > 0x7fffffff ? sinSigno - 4294967296 : sinSigno;
  return parseFloat((conSigno / 10000000).toFixed(6));
}

// --- IOIDs -------------------------------------------------------------------

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
      const ioid  = bufer.readUInt16BE(posicion); posicion += 2;
      ios[ioid]   = leer(bufer, posicion);         posicion += tamano;
    }
  }

  return { ios, posicion };
}

// --- Sensores Bluetooth ------------------------------------------------------

function parsearSensoresBT<E extends object>(
  ios:            MapaIOs,
  sensores:       DefSensorBT<E>[],
  esValido:       (crudo: number) => boolean,
  convertirValor: (crudo: number) => number,
): Array<E & { valor: number }> {
  return sensores
    .filter(s => {
      const v = ios[s.ioid];
      return v != null && typeof v === 'number' && esValido(v);
    })
    .map(s => ({ ...s.label, valor: convertirValor(ios[s.ioid] as number) }));
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

// --- SCAN OBD/CAN ------------------------------------------------------------

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

// --- construirDocumento ------------------------------------------------------

function construirDocumento(hexCrudo: string, infoRemota: InfoRemota): DocumentoGps {
  const bufer = Buffer.from(hexCrudo.trim(), 'hex');

  const imeiHex    = bufer.slice(2, 10).toString('hex').toUpperCase();
  const unidadId   = `${BigInt('0x' + imeiHex).toString()}ru`;
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

  // IOIDs — combinamos todas las sub-tramas
  // Sub-trama 0: IOIDs en posicion 38 (header ya leído arriba)
  // Sub-tramas adicionales (t > 0): 25 bytes de header propio antes de sus IOIDs
  let ios:      MapaIOs = {};
  let posicion: number  = 38;

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

  return {
    unidadId,

    fechaHoraUbicacion,
    fechaHoraRecepcion: new Date(),

    latitud,
    longitud,
    altitud,
    orientacion,
    velocidad,

    satelites,
    fix:             satelites > 0,

    ip:              infoRemota.address,
    puerto:          infoRemota.port,
    protocolo:       'UDP',
    tramaTiempoReal: !enBuffer,
    estadoGPRS:      'Ok',

    gpsMarca:           'Ruptela',
    tipoReporte:        ioidDisparo === 7 ? 'GPS' : 'Alerta',
    evento:             null,
    eventoId:           ioidDisparo ? String(ioidDisparo) : null,
    numeroSecuencia:    null,

    estadoIgnicion:     ios[5]   === 1 ? 'Encendido' : 'Apagado',
    estadoApagadoMotor: ios[405] === 0 ? 'Aplicado'  : 'No aplicado',
    horometro:          escaneo.horometro ?? null,
    odometro:           escaneo.odometro  ?? (typeof ios[65] === 'number' ? ios[65] : null),
    voltajeBateria,
    porcBateriaInterna,

    potencia:       typeof ios[27] === 'number' ? ios[27] : null,
    nivelRecepcion: obtenerNivelSenal(typeof ios[27] === 'number' ? ios[27] : 0),
    idRadioBase:    null,
    estadoEntradas: null,
    estadoSalidas:  null,
    mcc:            operadorCrudo ? operadorCrudo.slice(0, 3) : null,
    mnc:            operadorCrudo ? operadorCrudo.slice(3)    : null,
    carrier:        operadorCrudo ? (OPERADORES[operadorCrudo] ?? null) : null,

    combustible,
    temperatura,
    humedad,

    scan: Object.keys(escaneo).length > 0 ? escaneo : null,

    trama: hexCrudo.trim(),
  };
}

// --- guardarUbicacion --------------------------------------------------------

export async function guardarUbicacion(hexCrudo: string, infoRemota: InfoRemota): Promise<void> {
  try {
    const documento = construirDocumento(hexCrudo, infoRemota);
    await Promise.all([
      HistoryPosition.create(documento),
      LastPosition.findOneAndUpdate(
        { unidadId: documento.unidadId },
        { $set: documento },
        { upsert: true, returnDocument: 'after' },
      ),
    ]);
    console.log(`  [BD] Ruptela guardado → ${documento.unidadId}`);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    console.error(`  [BD] Error al guardar Ruptela: ${mensaje}`);
  }
}