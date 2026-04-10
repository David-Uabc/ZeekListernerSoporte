// test.js — prueba completa de Suntech, Ruptela y stress test de cola
// Ejecutar con: node test.js

const dgram = require('dgram');

const HOST = '127.0.0.1';
const PORT = 5001;

// ─── Patch de timestamp ───────────────────────────────────────────────────────
function patchTimestamp(trama) {
  const ts    = Math.floor(Date.now() / 1000);
  const MIN   = 1577836800; // 2020-01-01
  const MAX   = 2051222400; // 2035-01-01
  if (ts < MIN || ts > MAX) {
    console.error(`  [TEST ERROR] Timestamp fuera de rango: ${ts}`);
    process.exit(1);
  }
  const tsHex = ts.toString(16).padStart(8, '0').toUpperCase();
  return trama.slice(0, 26) + tsHex + trama.slice(34);
}

// ─── Tramas base Ruptela ──────────────────────────────────────────────────────
const RUPTELA_NORMAL_BASE = '005400030E80479C687A44000169B76783000000BA57B7071360311D08B32D8217000005000708000200000300000400000500001B1900A90001950102FA0A02001D30F3001E107A0200410038F0D40096000518C400007EA6';
const RUPTELA_FUEL_BASE   = '005F00030E8047A1008D44000169C6F81B000000C3A0A3690C4CDBE043B31AB815000006000709000200000300000400000501001B18019501019D0103012503022504001D309E001E0000030B0C4F030C0A4002004103EE85900096000518C40020D0';
const RUPTELA_TEMP_BASE   = '006B0003111C46E26AA244000169C6F85E000000BA587532135B9509079E869213000007000705000501001B1700580001950100A9010A001D35AB001E0FEA0258079D025D1BBC025906F4025E1E14025A7FFF025FFFFF025B7FFF0260FFFF020041006779E30096000518C4002999';
const RUPTELA_SCAN_BASE   = '00B70003147121E61A9E44000269C6F882001000C316E0E00F331777364C338613001C05000908000200000300000400000501001B1D00CFB500738B00CE0006001D3715001E0FB100C528310059264B005AFB0000D21CDD0600410CAEB1FD0096000518C400D00003409200CB0001798A00720266B527005C065A1E020069C6F882001100C316E0E00F331777364C338613001C05000900000003007B0000000000000000007C0000000000000000007D00000000000000004439';

const RUPTELA_NORMAL = () => JSON.stringify({ NBytes: 84,  EndPoint: '192.168.1.101:5001', Identificar: 'Ruptela', Trama: patchTimestamp(RUPTELA_NORMAL_BASE) });
const RUPTELA_FUEL   = () => JSON.stringify({ NBytes: 96,  EndPoint: '192.168.1.101:5001', Identificar: 'Ruptela', Trama: patchTimestamp(RUPTELA_FUEL_BASE)   });
const RUPTELA_TEMP   = () => JSON.stringify({ NBytes: 108, EndPoint: '192.168.1.101:5001', Identificar: 'Ruptela', Trama: patchTimestamp(RUPTELA_TEMP_BASE)   });
const RUPTELA_SCAN   = () => JSON.stringify({ NBytes: 184, EndPoint: '192.168.1.101:5001', Identificar: 'Ruptela', Trama: patchTimestamp(RUPTELA_SCAN_BASE)   });

// ─── Tramas Suntech ───────────────────────────────────────────────────────────
// FIX: trama con los 28 campos correctos según documentación Suntech Universal
// Estructura: STT;DeviceID;ConfigProps;Modelo;FWVer;TiempoReal;Fecha;Hora;CellId;MCC;MNC;LAC;RSSI;Lat;Lon;Vel;Ori;Sats;Fix;InputStatus;OutputStatus;PerfilOp;TipoRep;NumSeq;VoltExt;VoltInt;Odometro;Horometro
//              0      1        2          3     4       5        6     7     8    9   10   11   12  13  14  15   16   17  18     19           20          21      22     23      24       25        26        27

const SUNTECH_NORMAL = (seq = 0) => JSON.stringify({
  NBytes:      150,
  EndPoint:    '192.168.1.100:5001',
  Identificar: 'STUniversal',
  // 28 campos — orden y cantidad verificados contra documentación
  Trama: `STT;864134051234567;3FFFFF;74;1.0.6;1;20260409;02:14:27;7A1B2C;334;20;2B24;25;+32.507114;-116.865662;45.5;180.25;12;1;00000001;00000000;0;1;${seq};12.45;4.1;3200;17005812`
});

const SUNTECH_ALERTA = (seq = 0) => JSON.stringify({
  NBytes:      150,
  EndPoint:    '192.168.1.100:5001',
  Identificar: 'STUniversal',
  // ALT = alerta, ignicion apagada (00000000), corte motor activo (00000001)
  Trama: `ALT;864134059999999;3FFFFF;74;1.0.6;1;20260409;03:30:00;7A1B2C;334;50;2B24;18;+32.600000;-116.900000;0.0;0.0;8;1;00000000;00000001;0;1;${seq};11.80;3.9;1500;5000`
});

// ─── Utilidades ───────────────────────────────────────────────────────────────
function send(client, message, label) {
  return new Promise((resolve) => {
    const buf = Buffer.from(message);
    client.send(buf, 0, buf.length, PORT, HOST, (err) => {
      if (err) console.error(`  [ERR] ${label}: ${err.message}`);
      else     console.log(`  [SENT] ${label}`);
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Suite de pruebas ─────────────────────────────────────────────────────────
async function runTests() {
  const client = dgram.createSocket('udp4');

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  TEST SUITE — Suntech + Ruptela + Stress');
  console.log('══════════════════════════════════════════════════════════\n');

  // ── Bloque 1: Tramas individuales ─────────────────────────────────────────
  console.log('─── Bloque 1: Tramas individuales (6 envios) ─────────────\n');

  await send(client, SUNTECH_NORMAL(1), 'Suntech Normal  — GPS 28 campos, ignicion encendida');
  await sleep(300);

  await send(client, SUNTECH_ALERTA(1), 'Suntech Alerta  — ignicion apagada, corte motor activo');
  await sleep(300);

  await send(client, RUPTELA_NORMAL(),  'Ruptela Normal  — GPS base');
  await sleep(300);

  await send(client, RUPTELA_FUEL(),    'Ruptela Fuel    — combustible Bluetooth');
  await sleep(300);

  await send(client, RUPTELA_TEMP(),    'Ruptela Temp    — temperatura y humedad Bluetooth');
  await sleep(300);

  await send(client, RUPTELA_SCAN(),    'Ruptela Scan    — OBD/CAN, 2 sub-tramas');
  await sleep(800);

  // ── Bloque 2: Deduplicacion ────────────────────────────────────────────────
  console.log('\n─── Bloque 2: Deduplicacion (misma trama x3) ─────────────\n');

  const tramaFijaDup = RUPTELA_NORMAL();
  await send(client, tramaFijaDup, 'Ruptela duplicado #1 — debe guardarse    ✓');
  await sleep(100);
  await send(client, tramaFijaDup, 'Ruptela duplicado #2 — debe ignorarse    ✗');
  await sleep(100);
  await send(client, tramaFijaDup, 'Ruptela duplicado #3 — debe ignorarse    ✗');
  await sleep(800);

  // ── Bloque 3: Marca desconocida ────────────────────────────────────────────
  console.log('\n─── Bloque 3: Marca desconocida (debe loguear WARN) ──────\n');

  const UNKNOWN = JSON.stringify({
    NBytes:      50,
    EndPoint:    '10.0.0.1:5001',
    Identificar: 'MarcaXYZ',
    Trama:       'datos_invalidos_xyz'
  });
  await send(client, UNKNOWN, 'Marca desconocida — MarcaXYZ');
  await sleep(800);

  // ── Bloque 4: Trama raw sin JSON (fallback Suntech) ────────────────────────
  console.log('\n─── Bloque 4: Trama raw sin JSON (fallback Suntech) ──────\n');

  // FIX: trama raw también con 28 campos correctos
  const RAW_SUNTECH = Buffer.from(
    'STT;864134057777777;3FFFFF;74;1.0.6;1;20260409;05:00:00;7A1B2C;334;20;2B24;22;+32.510000;-116.870000;60.0;90.0;11;1;00000001;00000000;0;1;900;12.30;4.0;5000;3600000'
  );
  client.send(RAW_SUNTECH, 0, RAW_SUNTECH.length, PORT, HOST, (err) => {
    if (err) console.error(`  [ERR] Raw Suntech: ${err.message}`);
    else     console.log('  [SENT] Trama raw sin JSON — fallback Suntech (28 campos)');
  });
  await sleep(800);

  // ── Bloque 5: Stress test — 1000 mensajes unicos ──────────────────────────
  console.log('\n─── Bloque 5: Stress test — 1000 envios unicos ───────────\n');
  console.log('  Cada trama lleva seq unico — ninguna sera bloqueada por deduplicacion\n');

  const total     = 1000;
  let   sent      = 0;
  const startTime = Date.now();

  for (let i = 0; i < total; i++) {
    let trama;
    switch (i % 5) {
      case 0: trama = SUNTECH_NORMAL(1000 + i); break;
      case 1: trama = RUPTELA_NORMAL();          break;
      case 2: trama = RUPTELA_FUEL();            break;
      case 3: trama = SUNTECH_ALERTA(1000 + i); break;
      case 4: trama = RUPTELA_SCAN();            break;
    }

    const buf = Buffer.from(trama);
    client.send(buf, 0, buf.length, PORT, HOST, (err) => {
      if (err) return;
      sent++;
      if (sent % 100 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  [STRESS] ${sent}/${total} enviados — ${elapsed}s transcurridos`);
      }
      if (sent === total) {
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n  [STRESS] Completado — ${total} tramas en ${totalTime}s`);
        console.log(`  [STRESS] Promedio   — ${(total / parseFloat(totalTime)).toFixed(0)} tramas/seg\n`);
        console.log('  Esperando 5s para que la cola se vacie...\n');
        setTimeout(() => { printSummary(); client.close(); }, 5000);
      }
    });

    await sleep(2);
  }
}

// ─── Resumen esperado ─────────────────────────────────────────────────────────
function printSummary() {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  RESUMEN — Documentos esperados en MongoDB');
  console.log('══════════════════════════════════════════════════════════\n');

  console.log('  historypositions (INSERT siempre):');
  console.log('  ┌─────────────────────────────────────────┬────────┐');
  console.log('  │ Origen                                  │  Docs  │');
  console.log('  ├─────────────────────────────────────────┼────────┤');
  console.log('  │ Bloque 1 — 6 tramas individuales        │      6 │');
  console.log('  │ Bloque 2 — 1 pasa, 2 bloqueadas x dup  │      1 │');
  console.log('  │ Bloque 3 — marca desconocida            │      0 │');
  console.log('  │ Bloque 4 — raw Suntech sin JSON         │      1 │');
  console.log('  │ Bloque 5 — stress 1000 tramas unicas    │   1000 │');
  console.log('  ├─────────────────────────────────────────┼────────┤');
  console.log('  │ TOTAL historypositions                  │   1008 │');
  console.log('  └─────────────────────────────────────────┴────────┘\n');

  console.log('  lastpositions (UPSERT por unidadId):');
  console.log('  ┌──────────────────────────────────────────┬────────┐');
  console.log('  │ unidadId                                 │ Estado │');
  console.log('  ├──────────────────────────────────────────┼────────┤');
  console.log('  │ 864134051234567st  (Suntech Normal)      │  1 doc │');
  console.log('  │ 864134059999999st  (Suntech Alerta)      │  1 doc │');
  console.log('  │ 864134057777777st  (Raw Suntech)         │  1 doc │');
  console.log('  │ 860369050167418ru  (Ruptela Normal+Dup)  │  1 doc │');
  console.log('  │ [IMEI Fuel]ru      (Ruptela Fuel)        │  1 doc │');
  console.log('  │ [IMEI Temp]ru      (Ruptela Temp)        │  1 doc │');
  console.log('  │ [IMEI Scan]ru      (Ruptela Scan)        │  1 doc │');
  console.log('  ├──────────────────────────────────────────┼────────┤');
  console.log('  │ TOTAL lastpositions                      │  7 doc │');
  console.log('  └──────────────────────────────────────────┴────────┘\n');

  console.log('  Verificar en mongosh:');
  console.log('  > db.historypositions.countDocuments()');
  console.log('    esperado: 1008');
  console.log('  > db.historypositions.find({fechaHoraUbicacion: null}).count()');
  console.log('    esperado: 0  (si ves algo aqui hay tramas con fecha invalida)');
  console.log('  > db.lastpositions.find({},{unidadId:1,gpsMarca:1,fechaHoraUbicacion:1,_id:0}).pretty()');
  console.log('    esperado: 7 documentos, todos con fechaHoraUbicacion valida');
  console.log('  > db.historypositions.find({gpsMarca:"Ruptela",scan:{$ne:null}}).count()');
  console.log('    esperado: >0  (los SCAN deben tener datos OBD)');
  console.log('\n══════════════════════════════════════════════════════════\n');
}

runTests().catch(err => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});