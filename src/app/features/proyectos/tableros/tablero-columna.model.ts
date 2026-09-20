export interface TableroColumna {
  id: number;
  proyectoId: number;
  clave: string;
  nombre: string;
  orden: number;
  permiteActividades: boolean;
  permiteAnexos: boolean;
  permiteAsociados: boolean;
  /**
   * JSON con reglas editable/obligatorio por campo del ticket ("Gestor de
   * Estados" del prototipo). No se expone un editor de este JSON todavía
   * (los 13 campos configurables son fijos en el prototipo) — se guarda
   * como null desde esta ventana.
   */
  configuracionCamposJson: string | null;
  activo: boolean;
}

export interface ProyectoOpcion {
  id: number;
  nombre: string;
  clave: string;
}
