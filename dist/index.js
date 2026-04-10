"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// index.ts — punto de entrada
require("dotenv/config");
const database_1 = require("./config/database");
const UDPListener_1 = __importDefault(require("./listener/UDPListener"));
const HOST = process.env.UDP_HOST ?? '0.0.0.0';
const PORT = parseInt(process.env.UDP_PORT ?? '5001');
async function main() {
    console.log('\n  ListenerSoporte — IoT GPS');
    console.log('  ─────────────────────────────────────────');
    await (0, database_1.connectDB)();
    const listener = new UDPListener_1.default(HOST, PORT);
    listener.start();
    process.on('SIGINT', () => {
        console.log('\n  [Server] Stopping...');
        listener.stop();
        process.exit(0);
    });
}
main().catch(err => {
    console.error('\n[FATAL]', err instanceof Error ? err.message : err);
    process.exit(1);
});
