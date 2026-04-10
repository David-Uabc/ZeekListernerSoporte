const mongoose = require('mongoose');

const lastPositionSchema = new mongoose.Schema({

  // ── Identificacion
  unidadId:             { type: String, required: true, unique: true },

  // ── Fechas
  fechaHoraUbicacion:   { type: Date },
  fechaHoraRecepcion:   { type: Date },

  // ── Posicion
  latitud:              { type: Number },
  longitud:             { type: Number },
  altitud:              { type: Number },
  orientacion:          { type: Number },
  velocidad:            { type: Number },

  // ── Satelites y Fix
  satelites:            { type: Number },
  fix:                  { type: Boolean },

  // ── Conexion
  ip:                   { type: String },
  puerto:               { type: Number },
  protocolo:            { type: String, enum: ['TCP', 'UDP', 'API'] },
  tramaTiempoReal:      { type: Boolean },
  estadoGPRS:           { type: String, enum: ['Ok', 'Sin conexion'] },

  // ── Dispositivo GPS
  gpsMarca:             { type: String },
  tipoReporte:          { type: String, enum: ['GPS', 'Giro', 'Alerta'] },
  evento:               { type: String },
  eventoId:             { type: String },
  // Unificado con HistoryPosition — mismo nombre en ambos schemas
  numeroSecuencia:      { type: Number },

  // ── Motor y bateria
  estadoIgnicion:       { type: String, enum: ['Encendido', 'Apagado'] },
  estadoApagadoMotor:   { type: String, enum: ['Aplicado', 'No aplicado'] },
  horometro:            { type: Number },
  odometro:             { type: Number },
  voltajeBateria:       { type: Number },
  porcBateriaInterna:   { type: Number },

  // ── Senal celular
  potencia:             { type: Number },
  nivelRecepcion:       { type: String, enum: ['Excelente', 'Muy bueno', 'Regular', 'Malo', 'Deficiente', 'Desconocido'] },
  idRadioBase:          { type: String },
  estadoEntradas:       { type: String },
  estadoSalidas:        { type: String },
  mcc:                  { type: String },
  mnc:                  { type: String },
  carrier:              { type: String },

  trama:                { type: String },

  // ── Scan OBD/CAN — Mixed para flexibilidad en lastpositions
  scan: { type: mongoose.Schema.Types.Mixed },

  // ── Sensores Bluetooth
  combustible: [{
    tanque: { type: String, enum: ['Tanque 1', 'Tanque 2', 'Tanque 3', 'Tanque 4'] },
    valor:  { type: Number }
  }],

  temperatura: [{
    sensor: { type: String, enum: ['Temp 1', 'Temp 2', 'Temp 3', 'Temp 4'] },
    valor:  { type: Number }
  }],

  humedad: [{
    sensor: { type: String, enum: ['Hum 1', 'Hum 2', 'Hum 3', 'Hum 4'] },
    valor:  { type: Number }
  }],

}, { timestamps: true });

module.exports = mongoose.model('LastPosition', lastPositionSchema);