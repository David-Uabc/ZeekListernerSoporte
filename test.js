// TEST 3 — Anti-colapso
// Manda 1000 tramas al mismo tiempo para demostrar que la cola funciona
// Si el servidor no colapsa y MongoDB guarda todos los documentos = exito
// Resultado esperado:
//   historypositions → ~1000 documentos
//   lastpositions    → 5 documentos (uno por vehiculo)

const dgram = require('dgram');
const client = dgram.createSocket('udp4');

const HOST  = '127.0.0.1';
const PORT  = 5001;
const TOTAL = 1000;

// Simulamos 5 vehiculos en diferentes ciudades de Baja California
const VEHICULOS = [
  { id: '0740005757', lat: 32.5137, lon: -116.8736, ciudad: 'Tijuana'  },
  { id: '0740005758', lat: 32.3300, lon: -117.0600, ciudad: 'Rosarito' },
  { id: '0740005759', lat: 31.8600, lon: -116.6000, ciudad: 'Ensenada' },
  { id: '0740005760', lat: 32.6638, lon: -115.4680, ciudad: 'Mexicali' },
  { id: '0740005761', lat: 32.5735, lon: -116.6270, ciudad: 'Tecate'   },
];

// Genera una trama con datos unicos por indice
// Cada trama tiene hora diferente para que no sea detectada como duplicado
function generarTrama(vehiculo, indice) {
  const lat     = (vehiculo.lat + (Math.random() * 0.01 - 0.005)).toFixed(6);
  const lon     = (vehiculo.lon + (Math.random() * 0.01 - 0.005)).toFixed(6);
  const speed   = (Math.random() * 120).toFixed(2);
  const heading = (Math.random() * 359).toFixed(2);
  const ignicion = Math.random() > 0.3 ? '00000001' : '00000000';
  const fuel1   = Math.floor(Math.random() * 90 + 10);
  const fuel2   = Math.floor(Math.random() * 90 + 10);
  const temp1   = (Math.random() * 25 + 15).toFixed(1);
  const hum1    = Math.floor(Math.random() * 50 + 40);
  const seq     = 2000 + indice;

  // Generamos hora unica por indice — HH:MM:SS
  // indice 0 = 00:00:00, indice 1 = 00:00:01, etc.
  const horas   = String(Math.floor(indice / 3600) % 24).padStart(2, '0');
  const minutos = String(Math.floor(indice / 60) % 60).padStart(2, '0');
  const segundos = String(indice % 60).padStart(2, '0');
  const hora    = `${horas}:${minutos}:${segundos}`;

  return `STT;${vehiculo.id};3FFFFF;74;1.0.6;1;20260309;${hora};052CC722;334;20;2B24;55;+${lat};${lon};${speed};${heading};14;1;${ignicion};00000000;0;1;${seq};12.36;4.1;17005812;48463;FUEL;1;${fuel1};FUEL;2;${fuel2};TEMP;1;${temp1};HUM;1;${hum1}`;
}

let enviadas = 0;
let errores  = 0;
const inicio = Date.now();

console.log('\n  TEST 3 — Anti-colapso');
console.log(`  Enviando ${TOTAL} tramas con 10ms de diferencia`);
console.log('  Cada trama tiene hora unica para evitar filtro de duplicados\n');

for (let i = 0; i < TOTAL; i++) {
  setTimeout(() => {
    const vehiculo = VEHICULOS[i % VEHICULOS.length];
    const trama    = generarTrama(vehiculo, i);
    const msg      = Buffer.from(trama);

    client.send(msg, PORT, HOST, (err) => {
      if (err) {
        errores++;
        console.error(`  [ERROR] Trama ${i + 1}: ${err.message}`);
      } else {
        enviadas++;
        if (enviadas % 200 === 0) {
          const tiempo = ((Date.now() - inicio) / 1000).toFixed(1);
          console.log(`  [SENT]  ${enviadas}/${TOTAL} tramas — ${tiempo}s`);
        }
      }

      if (enviadas + errores === TOTAL) {
        const tiempoTotal = ((Date.now() - inicio) / 1000).toFixed(1);
        console.log('  RESULTADO');
        console.log(`  Enviadas  : ${enviadas}`);
        console.log(`  Errores   : ${errores}`);
        console.log(`  Tiempo    : ${tiempoTotal}s`);
        console.log(`  Velocidad : ${(enviadas / tiempoTotal).toFixed(0)} tramas/seg`);
        console.log('  Verifica en MongoDB Compass:');
        console.log(`  historypositions → ~${TOTAL} documentos`);
        console.log('  lastpositions    → 5 documentos');
         client.close();
      }
    });
  }, i * 10);
}