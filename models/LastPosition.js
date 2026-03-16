// Importamos mongoose para definir el schema de la coleccion
const mongoose = require('mongoose');

/**
  Collection: lastpositions
 
 Un unico documento por vehiculo.
 Se sobreescribe completo cada vez que llega una senal nueva.
 Upsert por unidadId — si no existe lo crea, si existe lo actualiza.
 */
const lastPositionSchema = new mongoose.Schema({

  //  Identificacion 
  unidadId:             { type: String,  required: true, unique: true },

  //  Fechas 
  fechaHoraUbicacion:   { type: Date },
  fechaHoraRecepcion:   { type: Date },

  //  Posicion 
  latitud:              { type: Number },
  longitud:             { type: Number },
  altitud:              { type: Number },
  orientacion:          { type: Number },
  velocidad:            { type: Number },

  //  Satelites y Fix 
  satelites:            { type: Number },
  fix:                  { type: Boolean },

  //  Conexion 
  ip:                   { type: String },
  puerto:               { type: Number },
  protocolo:            { type: String, enum: ['TCP', 'UDP', 'API'] },
  tramaTiempoReal:      { type: Boolean },
  estadoGPRS:           { type: String, enum: ['Ok', 'Sin conexion'] },

  //  Dispositivo GPS 
  gpsMarca:             { type: String },
  tipoReporte:          { type: String, enum: ['GPS', 'Giro', 'Alerta'] },
  evento:               { type: String },
  eventoId:             { type: String },
  numeroSecuencia:      { type: Number },

  //  Motor y bateria 
  estadoIgnicion:       { type: String, enum: ['Encendido', 'Apagado'] },
  estadoApagadoMotor:   { type: String, enum: ['Aplicado', 'No aplicado'] },
  horometro:            { type: Number },
  odometro:             { type: Number },
  voltajeBateria:       { type: Number },
  porcBateriaInterna:   { type: Number },

  //  Senal celular
  potencia:             { type: Number },
  nivelRecepcion:       { type: String, enum: ['Excelente', 'Muy bueno', 'Regular', 'Malo', 'Deficiente', 'Desconocido'] },
  idRadioBase:          { type: String },
  estadoEntradas:       { type: String },
  estadoSalidas:        { type: String },
  mcc:                  { type: String },
  mnc:                  { type: String },
  carrier:              { type: String },

  //  Sensores embebidos (ultima lectura) 
  // Solo se guardan los tanques que vienen en la trama
  combustible: [{
    tanque: { type: String, enum: ['Tanque 1', 'Tanque 2', 'Tanque 3', 'Tanque 4'] },
    valor:  { type: Number }
  }],

  // Solo se guardan los sensores de temperatura que vienen en la trama
  temperatura: [{
    sensor: { type: String, enum: ['Temp 1', 'Temp 2', 'Temp 3', 'Temp 4'] },
    valor:  { type: Number }
  }],

  // Solo se guardan los sensores de humedad que vienen en la trama
  humedad: [{
    sensor: { type: String, enum: ['Hum 1', 'Hum 2', 'Hum 3', 'Hum 4'] },
    valor:  { type: Number }
  }]

}, { timestamps: true });

module.exports = mongoose.model('LastPosition', lastPositionSchema);