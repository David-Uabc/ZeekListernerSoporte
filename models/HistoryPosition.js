// Importamos mongoose para definir el schema de la coleccion
const mongoose = require('mongoose');

/*
Collection: historypositions
Un documento nuevo por cada senal recibida.
Nunca se modifica ni se elimina.
Los sensores van embebidos como arreglos dentro del documento.
 */
const historyPositionSchema = new mongoose.Schema({

  // ── Identificacion 
  unidadId:             { type: String,  required: true },

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
  // fix como booleano — true = Fix OK, false = No fix
  fix:                  { type: Boolean },

  // ── Conexion 
  ip:                   { type: String },
  puerto:               { type: Number },
  protocolo:            { type: String, enum: ['TCP', 'UDP', 'API'] },
  // tramaTiempoReal como booleano — true = tiempo real, false = historico
  tramaTiempoReal:      { type: Boolean },
  estadoGPRS:           { type: String, enum: ['Ok', 'Sin conexion'] },

  // ── Dispositivo GPS 
  gpsMarca:             { type: String },
  tipoReporte:          { type: String, enum: ['GPS', 'Giro', 'Alerta'] },
  evento:               { type: String },
  eventoId:             { type: String },
  numeroSecuencias:     { type: Number },

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

  // ── Sensores embebidos 
  // Arreglo de tanques de combustible — solo los que vienen en la trama
  combustible: [{
    tanque: { type: String, enum: ['Tanque 1', 'Tanque 2', 'Tanque 3', 'Tanque 4'] },
    valor:  { type: Number }
  }],

  // Arreglo de sensores de temperatura — solo los que vienen en la trama
  temperatura: [{
    sensor: { type: String, enum: ['Temp 1', 'Temp 2', 'Temp 3', 'Temp 4'] },
    valor:  { type: Number }
  }],

  // Arreglo de sensores de humedad — solo los que vienen en la trama
  humedad: [{
    sensor: { type: String, enum: ['Hum 1', 'Hum 2', 'Hum 3', 'Hum 4'] },
    valor:  { type: Number }
  }]

}, { timestamps: true });

// Indice compuesto para acelerar busquedas por unidad y fecha IMPORTANTE
historyPositionSchema.index({ unidadId: 1, fechaHoraUbicacion: -1 });


module.exports = mongoose.model('HistoryPosition', historyPositionSchema);