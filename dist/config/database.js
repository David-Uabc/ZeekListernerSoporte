"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
// config/database.ts
const mongoose_1 = __importDefault(require("mongoose"));
async function connectDB() {
    const uri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/zeek';
    try {
        await mongoose_1.default.connect(uri);
        console.log(`  [DB] Connected → ${uri}`);
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  [DB] Connection failed: ${msg}`);
        process.exit(1);
    }
}
