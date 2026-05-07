// types.ts — interfaces compartidas entre todos los módulos

export interface InfoRemota {
  address: string;  // propiedad de la API de Node.js — no se traduce
  port:    number;  // propiedad de la API de Node.js — no se traduce
}

export interface DocumentoGps {
  unidadId:           string;

  fechaHoraUbicacion: Date | null;
  fechaHoraRecepcion: Date;

  latitud:            number | null;
  longitud:           number | null;
  altitud:            number | null;
  orientacion:        number | null;
  velocidad:          number | null;

  satelites:          number | null;
  fix:                boolean;

  ip:                 string;
  puerto:             number;
  protocolo:          'TCP' | 'UDP' | 'API';
  tramaTiempoReal:    boolean;
  estadoGPRS:         'Ok' | 'Sin conexion';

  gpsMarca:           string;
  tipoReporte:        'GPS' | 'Giro' | 'Alerta';
  evento:             string | null;
  eventoId:           string | null;
  numeroSecuencia:    number | null;

  estadoIgnicion:     'Encendido' | 'Apagado';
  estadoApagadoMotor: 'Aplicado' | 'No aplicado';
  horometro:          number | null;
  odometro:           number | null;
  voltajeBateria:     number | null;
  porcBateriaInterna: number | null;

  potencia:           number | null;
  nivelRecepcion:     'Excelente' | 'Muy bueno' | 'Regular' | 'Malo' | 'Deficiente' | 'Desconocido';
  idRadioBase:        string | null;
  estadoEntradas:     string | null;
  estadoSalidas:      string | null;
  mcc:                string | null;
  mnc:                string | null;
  carrier:            string | null;

  combustible:        LecturaCombustible[];
  temperatura:        LecturaTemperatura[];
  humedad:            LecturaHumedad[];
  scan:               DatosEscaneo | null;

  trama:              string;
}

export interface LecturaCombustible { tanque: string; valor: number; }
export interface LecturaTemperatura { sensor: string; valor: number; }
export interface LecturaHumedad     { sensor: string; valor: number; }

export interface DatosEscaneo {
  temperaturaAmbiente?:       number;
  rendimientoCombustible?:    number;
  presionAceite?:             number;
  odometro?:                  number;
  temperaturaAnticongelante?: number;
  rpm?:                       number;
  horometro?:                 number;
  posicionAcelerador?:        number;
  cargaMotor?:                number;
  nivelCombustible?:          number;
  velocidadCAN?:              number;
}

export type MapaIOs = Record<number, number | string>;

export interface DefSensorBT<E extends object> {
  ioid:  number;
  label: E;      // nombre del campo del protocolo Ruptela — no se traduce
}

export interface DefIoidEscaneo {
  ioid:    number;
  campo:   keyof DatosEscaneo;
  isError: (v: number) => boolean;  // nombre del campo del protocolo — no se traduce
  factor:  (v: number) => number;   // nombre del campo del protocolo — no se traduce
}