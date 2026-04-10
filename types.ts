// types.ts — interfaces compartidas entre todos los módulos

export interface RemoteInfo {
  address: string;
  port:    number;
}

export interface GpsDocument {
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

  combustible:        FuelReading[];
  temperatura:        TempReading[];
  humedad:            HumReading[];
  scan:               ScanData | null;

  trama:              string;
}

export interface FuelReading { tanque: string; valor: number; }
export interface TempReading { sensor: string; valor: number; }
export interface HumReading  { sensor: string; valor: number; }

export interface ScanData {
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

export type IOsMap = Record<number, number | string>;

export interface BTSensorDef<L extends object> {
  ioid:  number;
  label: L;
}

export interface ScanIoidDef {
  ioid:    number;
  campo:   keyof ScanData;
  isError: (v: number) => boolean;
  factor:  (v: number) => number;
}