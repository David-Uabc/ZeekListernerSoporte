// models/LastPosition.ts
import mongoose, { Schema, Document } from 'mongoose';
import type { GpsDocument } from '../types';

export type LastPositionDoc = GpsDocument & Document;

const lastPositionSchema = new Schema<LastPositionDoc>(
  {
    unidadId:           { type: String, required: true, unique: true },

    fechaHoraUbicacion: { type: Date },
    fechaHoraRecepcion: { type: Date },

    latitud:            { type: Number },
    longitud:           { type: Number },
    altitud:            { type: Number },
    orientacion:        { type: Number },
    velocidad:          { type: Number },

    satelites:          { type: Number },
    fix:                { type: Boolean },

    ip:                 { type: String },
    puerto:             { type: Number },
    protocolo:          { type: String, enum: ['TCP', 'UDP', 'API'] },
    tramaTiempoReal:    { type: Boolean },
    estadoGPRS:         { type: String, enum: ['Ok', 'Sin conexion'] },

    gpsMarca:           { type: String },
    tipoReporte:        { type: String, enum: ['GPS', 'Giro', 'Alerta'] },
    evento:             { type: String },
    eventoId:           { type: String },
    numeroSecuencia:    { type: Number },

    estadoIgnicion:     { type: String, enum: ['Encendido', 'Apagado'] },
    estadoApagadoMotor: { type: String, enum: ['Aplicado', 'No aplicado'] },
    horometro:          { type: Number },
    odometro:           { type: Number },
    voltajeBateria:     { type: Number },
    porcBateriaInterna: { type: Number },

    potencia:           { type: Number },
    nivelRecepcion:     { type: String, enum: ['Excelente', 'Muy bueno', 'Regular', 'Malo', 'Deficiente', 'Desconocido'] },
    idRadioBase:        { type: String },
    estadoEntradas:     { type: String },
    estadoSalidas:      { type: String },
    mcc:                { type: String },
    mnc:                { type: String },
    carrier:            { type: String },

    trama:              { type: String },

    scan: { type: Schema.Types.Mixed },

    combustible: [{ tanque: { type: String, enum: ['Tanque 1', 'Tanque 2', 'Tanque 3', 'Tanque 4'] }, valor: { type: Number } }],
    temperatura: [{ sensor: { type: String, enum: ['Temp 1',   'Temp 2',   'Temp 3',   'Temp 4']   }, valor: { type: Number } }],
    humedad:     [{ sensor: { type: String, enum: ['Hum 1',    'Hum 2',    'Hum 3',    'Hum 4']    }, valor: { type: Number } }],
  },
  { timestamps: true },
);

export const LastPosition = mongoose.model<LastPositionDoc>('LastPosition', lastPositionSchema);