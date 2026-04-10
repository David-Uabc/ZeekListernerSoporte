"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveLocation = saveLocation;
// services/LocationServiceRuptela.ts — parser Ruptela (trama hex binaria)
const HistoryPosition_1 = require("../models/HistoryPosition");
const LastPosition_1 = require("../models/LastPosition");
// ─── Lookup ──────────────────────────────────────────────────────────────────
const CARRIERS = {
    '334020': 'Telcel',
    '334030': 'Movistar',
    '334050': 'AT&T',
};
// ─── Señal ───────────────────────────────────────────────────────────────────
function getSignalLevel(value) {
    if (value === 31)
        return 'Excelente';
    if (value >= 20 && value <= 30)
        return 'Muy bueno';
    if (value >= 10 && value <= 19)
        return 'Regular';
    if (value >= 2 && value <= 9)
        return 'Malo';
    if (value === 1)
        return 'Deficiente';
    return 'Desconocido';
}
// ─── Batería ─────────────────────────────────────────────────────────────────
function getBatteryPercent(mv) {
    return Math.min(100, Math.max(0, Math.round(((mv - 3300) / 1000) * 100)));
}
// ─── Coordenadas ─────────────────────────────────────────────────────────────
function hexToCoordinate(hex) {
    const unsigned = parseInt(hex, 16);
    const signed = unsigned > 0x7fffffff ? unsigned - 4294967296 : unsigned;
    return parseFloat((signed / 10000000).toFixed(6));
}
// ─── IOIDs ───────────────────────────────────────────────────────────────────
function parseIOIDs(buf, offset) {
    const ios = {};
    const groups = [
        { size: 1, read: (b, o) => b.readUInt8(o) },
        { size: 2, read: (b, o) => b.readUInt16BE(o) },
        { size: 4, read: (b, o) => b.readUInt32BE(o) },
        { size: 8, read: (b, o) => (BigInt(b.readUInt32BE(o)) << 32n | BigInt(b.readUInt32BE(o + 4))).toString() },
    ];
    for (const { size, read } of groups) {
        const count = buf.readUInt8(offset++);
        for (let i = 0; i < count; i++) {
            const ioid = buf.readUInt16BE(offset);
            offset += 2;
            ios[ioid] = read(buf, offset);
            offset += size;
        }
    }
    return { ios, offset };
}
// ─── Sensores Bluetooth ──────────────────────────────────────────────────────
function parseBTSensors(ios, sensors, isValidFn, convertFn) {
    return sensors
        .filter(s => {
        const v = ios[s.ioid];
        return v != null && typeof v === 'number' && isValidFn(v);
    })
        .map(s => ({ ...s.label, valor: convertFn(ios[s.ioid]) }));
}
const BT_SENSORS = {
    fuel: [
        { ioid: 779, label: { tanque: 'Tanque 1' } },
        { ioid: 780, label: { tanque: 'Tanque 2' } },
        { ioid: 781, label: { tanque: 'Tanque 3' } },
        { ioid: 782, label: { tanque: 'Tanque 4' } },
    ],
    temp: [
        { ioid: 600, label: { sensor: 'Temp 1' } },
        { ioid: 601, label: { sensor: 'Temp 2' } },
        { ioid: 602, label: { sensor: 'Temp 3' } },
        { ioid: 603, label: { sensor: 'Temp 4' } },
    ],
    hum: [
        { ioid: 605, label: { sensor: 'Hum 1' } },
        { ioid: 606, label: { sensor: 'Hum 2' } },
        { ioid: 607, label: { sensor: 'Hum 3' } },
        { ioid: 608, label: { sensor: 'Hum 4' } },
    ],
};
const isValidTemp = (r) => r !== 65535 && ((r >= 0 && r <= 850) || (r >= 64736 && r <= 65534));
const convertTemp = (r) => parseFloat(((r > 32767 ? r - 65536 : r) / 10).toFixed(1));
const isValidHum = (r) => r !== 65535 && r >= 0 && r <= 1000;
const convertHum = (r) => parseFloat((r / 10).toFixed(1));
const isValidFuel = (r) => r !== 65535;
const convertFuel = (r) => r;
// ─── SCAN OBD/CAN ────────────────────────────────────────────────────────────
const SCAN_IOIDS = [
    { ioid: 89, campo: 'temperaturaAmbiente', isError: v => v >= 65024 && v <= 65279, factor: v => parseFloat(((v * 0.03125) - 273).toFixed(2)) },
    { ioid: 90, campo: 'rendimientoCombustible', isError: v => v >= 65024 && v <= 65279, factor: v => parseFloat((v / 512).toFixed(3)) },
    { ioid: 92, campo: 'presionAceite', isError: v => v >= 65024 && v <= 65279, factor: v => parseFloat((v * 0.5).toFixed(1)) },
    { ioid: 114, campo: 'odometro', isError: v => v >= 4261412864 && v <= 4278190079, factor: v => v * 5 },
    { ioid: 115, campo: 'temperaturaAnticongelante', isError: v => v === 254, factor: v => v },
    { ioid: 197, campo: 'rpm', isError: v => v >= 65024 && v <= 65279, factor: v => parseFloat((v * 0.125).toFixed(1)) },
    { ioid: 203, campo: 'horometro', isError: v => v >= 4261412864 && v <= 4278190079, factor: v => parseFloat(((v * 0.05) * 3600).toFixed(2)) },
    { ioid: 206, campo: 'posicionAcelerador', isError: v => v === 254, factor: v => parseFloat((v * 0.4).toFixed(1)) },
    { ioid: 207, campo: 'nivelCombustible', isError: v => v === 254, factor: v => parseFloat((v * 0.4).toFixed(1)) },
    { ioid: 208, campo: 'cargaMotor', isError: v => v > 250, factor: v => parseFloat((v * 0.4).toFixed(1)) },
    { ioid: 210, campo: 'velocidadCAN', isError: v => v >= 65024 && v <= 65279, factor: v => parseFloat((v / 256).toFixed(2)) },
];
function parseScan(ios) {
    const scan = {};
    for (const { ioid, campo, isError, factor } of SCAN_IOIDS) {
        const raw = ios[ioid];
        if (raw != null && typeof raw === 'number' && !isError(raw)) {
            scan[campo] = factor(raw);
        }
    }
    return scan;
}
// ─── buildDocument ───────────────────────────────────────────────────────────
function buildDocument(rawHex, remoteInfo) {
    const buf = Buffer.from(rawHex.trim(), 'hex');
    const imeiHex = buf.slice(2, 10).toString('hex').toUpperCase();
    const unidadId = `${BigInt('0x' + imeiHex).toString()}ru`;
    const inBuffer = buf.readUInt8(11) === 1;
    const cantTramas = buf.readUInt8(12);
    const fechaHoraUbicacion = new Date(buf.readUInt32BE(13) * 1000);
    const longitud = hexToCoordinate(buf.slice(20, 24).toString('hex'));
    const latitud = hexToCoordinate(buf.slice(24, 28).toString('hex'));
    const altitud = buf.readUInt16BE(28) / 10;
    const orientacion = buf.readUInt16BE(30) / 100;
    const satelites = buf.readUInt8(32);
    const velocidad = buf.readUInt16BE(33);
    const triggerIOID = buf.readUInt16BE(36);
    // IOIDs — combinamos todas las sub-tramas
    // Sub-trama 0: IOIDs en offset 38 (header ya leído arriba)
    // Sub-tramas adicionales (t > 0): 25 bytes de header propio antes de sus IOIDs
    //   timestamp(4) + unused(3) + lon(4) + lat(4) + alt(2) + angle(2) + sats(1) + speed(2) + hdop(1) + triggerIOID(2)
    let ios = {};
    let offset = 38;
    for (let t = 0; t < cantTramas; t++) {
        if (offset >= buf.length - 2)
            break;
        if (t > 0)
            offset += 25;
        if (offset >= buf.length - 2)
            break;
        try {
            const result = parseIOIDs(buf, offset);
            ios = { ...ios, ...result.ios };
            offset = result.offset;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`  [WARN] Sub-trama ${t + 1}/${cantTramas}: ${msg}`);
            break;
        }
    }
    const voltajeBateria = typeof ios[29] === 'number' ? parseFloat((ios[29] / 1000).toFixed(3)) : null;
    const porcBateriaInterna = typeof ios[30] === 'number' ? getBatteryPercent(ios[30]) : null;
    const carrierRaw = ios[150] != null ? String(ios[150]) : null;
    const scan = parseScan(ios);
    const combustible = parseBTSensors(ios, BT_SENSORS.fuel, isValidFuel, convertFuel);
    const temperatura = parseBTSensors(ios, BT_SENSORS.temp, isValidTemp, convertTemp);
    const humedad = parseBTSensors(ios, BT_SENSORS.hum, isValidHum, convertHum);
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
        fix: satelites > 0,
        ip: remoteInfo.address,
        puerto: remoteInfo.port,
        protocolo: 'UDP',
        tramaTiempoReal: !inBuffer,
        estadoGPRS: 'Ok',
        gpsMarca: 'Ruptela',
        tipoReporte: triggerIOID === 7 ? 'GPS' : 'Alerta',
        evento: null,
        eventoId: triggerIOID ? String(triggerIOID) : null,
        numeroSecuencia: null,
        estadoIgnicion: ios[5] === 1 ? 'Encendido' : 'Apagado',
        estadoApagadoMotor: ios[405] === 0 ? 'Aplicado' : 'No aplicado',
        horometro: scan.horometro ?? null,
        odometro: scan.odometro ?? (typeof ios[65] === 'number' ? ios[65] : null),
        voltajeBateria,
        porcBateriaInterna,
        potencia: typeof ios[27] === 'number' ? ios[27] : null,
        nivelRecepcion: getSignalLevel(typeof ios[27] === 'number' ? ios[27] : 0),
        idRadioBase: null,
        estadoEntradas: null,
        estadoSalidas: null,
        mcc: carrierRaw ? carrierRaw.slice(0, 3) : null,
        mnc: carrierRaw ? carrierRaw.slice(3) : null,
        carrier: carrierRaw ? (CARRIERS[carrierRaw] ?? null) : null,
        combustible,
        temperatura,
        humedad,
        scan: Object.keys(scan).length > 0 ? scan : null,
        trama: rawHex.trim(),
    };
}
// ─── saveLocation ────────────────────────────────────────────────────────────
async function saveLocation(rawHex, remoteInfo) {
    try {
        const doc = buildDocument(rawHex, remoteInfo);
        await Promise.all([
            HistoryPosition_1.HistoryPosition.create(doc),
            LastPosition_1.LastPosition.findOneAndUpdate({ unidadId: doc.unidadId }, { $set: doc }, { upsert: true, returnDocument: 'after' }),
        ]);
        console.log(`  [DB] Saved Ruptela → ${doc.unidadId}`);
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  [DB] Ruptela save error: ${msg}`);
    }
}
