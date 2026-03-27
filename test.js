// TEST 7 — Tramas como JSON real
// Simula exactamente como llegan los paquetes reales del servidor
// Cada trama viene envuelta en un JSON con el campo Identificar
// que le dice al listener de que marca es el dispositivo
// Resultado esperado:
//   historypositions → 10 documentos (5 Suntech + 5 Ruptela)
//   lastpositions    → 10 documentos (5 Suntech + 5 Ruptela)

const dgram = require('dgram');
const client = dgram.createSocket('udp4');

const HOST = '127.0.0.1';
const PORT = 5001;

const paquetes = [

  // ── SUNTECH — Identificar: "STUniversal" ──────────────────
  {
    NBytes: 207,
    EndPoint: '200.68.158.109:8718',
    Trama: 'STT;0740005757;3FFFFF;74;1.0.6;1;20260309;10:00:00;052CC722;334;20;2B24;55;+32.513706;-116.873611;85.50;45.00;14;1;00000001;00000000;0;1;2462;12.36;4.1;17005812;48463;FUEL;1;80;FUEL;2;65;TEMP;1;23.5;HUM;1;65',
    Identificar: 'STUniversal',
    UnidadID: '',
  },
  {
    NBytes: 197,
    EndPoint: '200.68.158.109:8718',
    Trama: 'STT;0740005758;3FFFFF;74;1.0.6;1;20260309;10:01:00;052CC722;334;20;2B24;48;+32.330000;-117.060000;60.00;270.00;12;1;00000001;00000000;0;1;1001;11.90;3.9;5000000;20000;FUEL;1;90;TEMP;1;22.0;HUM;1;60',
    Identificar: 'STUniversal',
    UnidadID: '',
  },
  {
    NBytes: 194,
    EndPoint: '200.68.158.109:8718',
    Trama: 'STT;0740005759;3FFFFF;74;1.0.6;1;20260309;10:02:00;052CC722;334;30;2B24;20;+31.860000;-116.600000;0.00;0.00;14;1;00000000;00000001;0;1;3001;12.50;4.1;8000000;30000;FUEL;1;45;TEMP;1;20.5;HUM;1;70',
    Identificar: 'STUniversal',
    UnidadID: '',
  },
  {
    NBytes: 208,
    EndPoint: '200.68.158.109:8718',
    Trama: 'STT;0740005760;3FFFFF;74;1.0.6;1;20260309;10:03:00;052CC722;334;50;2B24;55;+32.663800;-115.468000;100.00;90.00;14;1;00000001;00000000;0;1;4001;12.36;4.1;12000000;45000;FUEL;1;60;FUEL;2;55;TEMP;1;35.0;HUM;1;30',
    Identificar: 'STUniversal',
    UnidadID: '',
  },
  {
    NBytes: 197,
    EndPoint: '200.68.158.109:8718',
    Trama: 'STT;0740005761;3FFFFF;74;1.0.6;1;20260309;10:04:00;052CC722;334;20;2B24;15;+32.573500;-116.627000;30.00;180.00;10;1;00000001;00000000;0;1;5001;11.50;3.8;3000000;10000;FUEL;1;70;TEMP;1;24.0;HUM;1;55',
    Identificar: 'STUniversal',
    UnidadID: '',
  },

  // ── RUPTELA — Identificar: "Ruptela" ──────────────────────
  {
    NBytes: 84,
    EndPoint: '200.68.158.110:5001',
    Trama: '005400030E80479C687A44000169B76783000000BA57B7071360311D08B32D8217000005000708000200000300000400000500001B1900A90001950102FA0A02001D30F3001E107A0200410038F0D40096000518C4007EA6',
    Identificar: 'Ruptela',
    UnidadID: '',
  },
  {
    NBytes: 84,
    EndPoint: '200.68.158.110:5001',
    Trama: '005400030E80479C687B44000169B76783000000BA57B7071360311D08B32D8217000005000708000200000300000400000500001B1900A90001950102FA0A02001D30F3001E107A0200410038F0D40096000518C4007EA6',
    Identificar: 'Ruptela',
    UnidadID: '',
  },
  {
    NBytes: 84,
    EndPoint: '200.68.158.110:5001',
    Trama: '005400030E80479C687C44000169B76783000000BA57B7071360311D08B32D8217000005000708000200000300000400000500001B1900A90001950102FA0A02001D30F3001E107A0200410038F0D40096000518C4007EA6',
    Identificar: 'Ruptela',
    UnidadID: '',
  },
  {
    NBytes: 84,
    EndPoint: '200.68.158.110:5001',
    Trama: '005400030E80479C687D44000169B76783000000BA57B7071360311D08B32D8217000005000708000200000300000400000500001B1900A90001950102FA0A02001D30F3001E107A0200410038F0D40096000518C4007EA6',
    Identificar: 'Ruptela',
    UnidadID: '',
  },
  {
    NBytes: 84,
    EndPoint: '200.68.158.110:5001',
    Trama: '005400030E80479C687E44000169B76783000000BA57B7071360311D08B32D8217000005000708000200000300000400000500001B1900A90001950102FA0A02001D30F3001E107A0200410038F0D40096000518C4007EA6',
    Identificar: 'Ruptela',
    UnidadID: '',
  },
];

console.log('\n  TEST 7 — Tramas como JSON real');
console.log('  5 Suntech (Identificar: STUniversal)');
console.log('  5 Ruptela (Identificar: Ruptela)');
console.log('  El listener lee el campo Identificar y usa el parser correcto\n');

paquetes.forEach((paquete, index) => {
  setTimeout(() => {

    // Convertimos el objeto a JSON igual que lo mandaria el servidor real
    const msg = Buffer.from(JSON.stringify(paquete));

    client.send(msg, PORT, HOST, (err) => {
      if (err) {
        console.error(`  [ERROR] Paquete ${index + 1}: ${err.message}`);
      } else {
        console.log(`  [SENT]  Paquete ${index + 1}/10 — ${paquete.Identificar}`);
      }

      if (index === paquetes.length - 1) {
        console.log('\n  Listo. Verifica en MongoDB Compass:');
        console.log('  historypositions → 10 documentos');
        console.log('  lastpositions    → 10 documentos');
        console.log('  gpsMarca         → mezcla de "Suntech" y "Ruptela"');
        client.close();
      }
    });
  }, index * 500);
});