/**
 * Mapa entidad (nombre lógico que usan las pantallas, p.ej. 'MovimientoPresupuesto')
 * → [esquema, tabla, columnas] en Supabase.
 * Columnas: 'nombre_snake:tipo' — t=texto, u=uuid, n=número, f=fecha (date),
 * h=fecha-hora (timestamptz), b=booleano, j=json.
 *
 * GENERADO desde information_schema del proyecto Supabase "Saurix".
 * Si agregas una tabla o columna en supabase/migrations, agrégala aquí también.
 */
export type TipoColumna = 't' | 'u' | 'n' | 'f' | 'h' | 'b' | 'j';

const MAPA: Record<string, [string, string, string]> = {
  Empresa: ['seguridad', 'empresa', 'id:n,clave:t,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  CitaMedicaMiembro: ['familia', 'cita_medica_miembro', 'id:n,miembro_familia_id:n,motivo:t,especialidad:t,fecha:f,lugar:t,notas:t,completada:b,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  CitaMedicaMiembroAdjunto: ['familia', 'cita_medica_miembro_adjunto', 'id:n,cita_medica_miembro_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ContactoEmergenciaMiembro: ['familia', 'contacto_emergencia_miembro', 'id:n,miembro_familia_id:n,nombre:t,relacion:t,telefono:t,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoFamilia: ['familia', 'documento_familia', 'id:n,miembro_familia_id:n,tipo_documento_clave:t,fecha_vencimiento:f,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoFamiliaAdjunto: ['familia', 'documento_familia_adjunto', 'id:n,documento_familia_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  EventoFamiliar: ['familia', 'evento_familiar', 'id:n,miembro_familia_id:n,titulo:t,fecha:f,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MedicionCrecimiento: ['familia', 'medicion_crecimiento', 'id:n,miembro_familia_id:n,fecha:f,peso_kg:n,estatura_cm:n,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MiembroFamilia: ['familia', 'miembro_familia', 'id:n,nombre:t,apellido_paterno:t,apellido_materno:t,parentesco_clave:t,fecha_nacimiento:f,sexo:t,entidad_nacimiento:t,tipo_sangre:t,telefono:t,foto:t,rfc:t,curp:t,alergias:t,condiciones_cronicas:t,medicamentos:t,numero_seguro_social:t,contacto_emergencia_nombre:t,contacto_emergencia_telefono:t,aseguradora:t,numero_poliza:t,padre_id:n,madre_id:n,conyuge_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  PolizaSeguroMiembro: ['familia', 'poliza_seguro_miembro', 'id:n,miembro_familia_id:n,tipo:t,aseguradora:t,numero_poliza:t,fecha_vigencia_inicio:f,fecha_vigencia_fin:f,notas:t,suma_asegurada:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TareaHogar: ['familia', 'tarea_hogar', 'id:n,titulo:t,miembro_familia_id:n,frecuencia:t,completada:b,fecha_limite:f,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TramiteEstado: ['familia', 'tramite_estado', 'id:n,nombre:t,orden:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TramiteFamiliar: ['familia', 'tramite_familiar', 'id:n,titulo:t,miembro_familia_id:n,tramite_estado_id:n,fecha_limite:f,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  VacunaMiembro: ['familia', 'vacuna_miembro', 'id:n,miembro_familia_id:n,nombre:t,fecha_aplicacion:f,dosis:t,notas:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  VacunaMiembroAdjunto: ['familia', 'vacuna_miembro_adjunto', 'id:n,vacuna_miembro_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ConfiguracionApariencia: ['panel_control', 'configuracion_apariencia', 'id:n,usuario_id:n,tema:t,asistente_ia_activo:b,tamano_pagina_grid:n,vista_proyectos_preferida:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ValorLista: ['panel_control', 'valor_lista', 'id:n,grupo:t,clave:t,etiqueta:t,orden:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  AvisoTarjetaCiclo: ['presupuesto', 'aviso_tarjeta_ciclo', 'id:n,cuenta_presupuesto_id:n,usuario_id:n,tipo_aviso:t,ciclo:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  CategoriaPresupuesto: ['presupuesto', 'categoria_presupuesto', 'id:n,nombre:t,tipo:t,categoria_presupuesto_padre_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  CuentaPresupuesto: ['presupuesto', 'cuenta_presupuesto', 'id:n,nombre:t,tipo:t,limite_credito:n,dia_corte:n,dia_pago:n,pago_minimo:n,pago_sin_intereses:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DeudaPresupuesto: ['presupuesto', 'deuda_presupuesto', 'id:n,descripcion:t,monto_original:n,saldo_actual:n,fecha_inicio:f,fecha_vencimiento:f,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DeudaPresupuestoAbono: ['presupuesto', 'deuda_presupuesto_abono', 'id:n,deuda_presupuesto_id:n,fecha:f,monto:n,nota:t,cuenta_presupuesto_id:n,movimiento_presupuesto_id:n,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  LimitePresupuesto: ['presupuesto', 'limite_presupuesto', 'id:n,categoria_presupuesto_id:n,monto_limite:n,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MetaPresupuesto: ['presupuesto', 'meta_presupuesto', 'id:n,nombre:t,monto_objetivo:n,monto_actual:n,fecha_limite:f,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MetaPresupuestoAporte: ['presupuesto', 'meta_presupuesto_aporte', 'id:n,meta_presupuesto_id:n,fecha:f,monto:n,nota:t,cuenta_presupuesto_id:n,movimiento_presupuesto_id:n,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MovimientoPresupuesto: ['presupuesto', 'movimiento_presupuesto', 'id:n,fecha:f,tipo:t,cuenta_presupuesto_id:n,categoria_presupuesto_id:n,monto:n,descripcion:t,transferencia_id:u,origen_recurrente_id:n,proyectado:b,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MovimientoPresupuestoAdjunto: ['presupuesto', 'movimiento_presupuesto_adjunto', 'id:n,movimiento_presupuesto_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MovimientoRecurrentePresupuesto: ['presupuesto', 'movimiento_recurrente_presupuesto', 'id:n,descripcion:t,tipo:t,cuenta_presupuesto_id:n,categoria_presupuesto_id:n,monto:n,frecuencia:t,dia_del_mes:n,aviso_faltante_ciclo:t,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  MovimientoRecurrentePresupuestoAdjunto: ['presupuesto', 'movimiento_recurrente_presupuesto_adjunto', 'id:n,movimiento_recurrente_presupuesto_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  PresupuestoAnual: ['presupuesto', 'presupuesto_anual', 'id:n,anio:n,fecha_alta:f,descripcion:t,estatus_clave:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  ProyeccionAjuste: ['presupuesto', 'proyeccion_ajuste', 'id:n,quincena:t,clave:t,monto:n,creado_por_usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Proyecto: ['proyectos', 'proyecto', 'id:n,nombre:t,clave:t,codigo_hex:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Sprint: ['proyectos', 'sprint', 'id:n,proyecto_id:n,nombre:t,objetivo:t,fecha_inicio:f,fecha_fin:f,estado:t,orden:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TableroColumna: ['proyectos', 'tablero_columna', 'id:n,proyecto_id:n,clave:t,nombre:t,orden:n,permite_actividades:b,permite_anexos:b,permite_asociados:b,configuracion_campos_json:t,transiciones_permitidas_json:t,posicion_diagrama_json:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Ticket: ['proyectos', 'ticket', 'id:n,proyecto_id:n,tablero_columna_id:n,ticket_tipo_id:n,ticket_prioridad_id:n,ticket_modulo_id:n,asignado_usuario_id:n,reportado_por_usuario_id:n,numero_ticket:t,folio_interno:t,titulo:t,descripcion:t,planeado:b,tiempo_estimado_min:n,fecha_fin_analisis:f,fecha_fin_desarrollo:f,fecha_fin_cliente:f,fecha_inicio:f,fecha_fin:f,solucion:t,sla_aviso_nivel:t,ticket_padre_id:n,sprint_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketActividad: ['proyectos', 'ticket_actividad', 'id:n,ticket_id:n,texto:t,tiempo_min:n,creado_por:n,fecha_creacion:h,fecha_modificacion:h,modificado_por:n,activo:b'],
  TicketAdjunto: ['proyectos', 'ticket_adjunto', 'id:n,ticket_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketComentario: ['proyectos', 'ticket_comentario', 'id:n,ticket_id:n,texto:t,creado_por:n,fecha_creacion:h,fecha_modificacion:h,modificado_por:n,activo:b'],
  TicketDependencia: ['proyectos', 'ticket_dependencia', 'id:n,ticket_id:n,ticket_relacionado_id:n,tipo:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketEtiqueta: ['proyectos', 'ticket_etiqueta', 'id:n,ticket_id:n,texto:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketHistorialEstado: ['proyectos', 'ticket_historial_estado', 'id:n,ticket_id:n,tablero_columna_anterior_id:n,tablero_columna_nueva_id:n,usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketModulo: ['proyectos', 'ticket_modulo', 'id:n,nombre:t,clave:t,icono:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketPrioridad: ['proyectos', 'ticket_prioridad', 'id:n,nombre:t,clave:t,codigo_hex:t,vigencia_horas:n,aviso_horas:n,critica:b,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketPrioridadNotificar: ['proyectos', 'ticket_prioridad_notificar', 'id:n,ticket_prioridad_id:n,usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketSeguidor: ['proyectos', 'ticket_seguidor', 'id:n,ticket_id:n,usuario_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TicketTipo: ['proyectos', 'ticket_tipo', 'id:n,nombre:t,clave:t,icono:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Bitacora: ['seguridad', 'bitacora', 'id:n,modulo:t,entidad:t,accion:t,registro_id:n,usuario:t,fecha:h,cambios:j,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Notificacion: ['seguridad', 'notificacion', 'id:n,usuario_id:n,titulo:t,link:t,leida:b,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Permiso: ['seguridad', 'permiso', 'id:n,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Rol: ['seguridad', 'rol', 'id:n,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  RolPermiso: ['seguridad', 'rol_permiso', 'id:n,rol_id:n,permiso_id:n,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Usuario: ['seguridad', 'usuario', 'id:n,auth_user_id:u,nombre_usuario:t,nombre:t,apellido_paterno:t,apellido_materno:t,email:t,role:t,fecha_inicio_vigencia:f,fecha_fin_vigencia:f,ultimo_acceso:h,debe_cambiar_password:b,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Categoria: ['wikidocs', 'categoria', 'id:n,tipo_sistema_id:n,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Documento: ['wikidocs', 'documento', 'id:n,seccion_id:n,titulo:t,contenido:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoAdjunto: ['wikidocs', 'documento_adjunto', 'id:n,documento_id:n,nombre_archivo:t,tipo_contenido:t,ruta_storage:t,tamano_bytes:n,comentario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoFavorito: ['wikidocs', 'documento_favorito', 'id:n,documento_id:n,usuario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  DocumentoVersion: ['wikidocs', 'documento_version', 'id:n,documento_id:n,titulo:t,contenido:t,usuario:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  PlantillaDocumento: ['wikidocs', 'plantilla_documento', 'id:n,nombre:t,contenido:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  Seccion: ['wikidocs', 'seccion', 'id:n,categoria_id:n,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
  TipoSistema: ['wikidocs', 'tipo_sistema', 'id:n,nombre:t,fecha_creacion:h,fecha_modificacion:h,creado_por:n,modificado_por:n,activo:b'],
};

export interface DefinicionTabla {
  esquema: string;
  tabla: string;
  /** columna en camelCase → { columna snake_case, tipo } */
  columnas: Map<string, { snake: string; tipo: TipoColumna }>;
}

const snakeACamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

const CACHE = new Map<string, DefinicionTabla>();

/** true si la entidad ya está mapeada a una tabla real de Supabase. Para
 *  features construidas primero en el frontend (IndexedDB) y pendientes de
 *  migrar — ver esquema-tablas-saurix.md del proyecto Claude — permite que
 *  list() se degrade a "sin datos" en vez de un error, sin tener que tocar
 *  cada pantalla una por una. */
export function entidadExiste(entidad: string): boolean {
  return Object.prototype.hasOwnProperty.call(MAPA, entidad);
}

export function definicionTabla(entidad: string): DefinicionTabla {
  const enCache = CACHE.get(entidad);
  if (enCache) return enCache;
  const fila = MAPA[entidad];
  if (!fila) throw new Error(`La entidad '${entidad}' no existe en Supabase (ver supabase-esquema.ts).`);
  const [esquema, tabla, cols] = fila;
  const columnas = new Map<string, { snake: string; tipo: TipoColumna }>();
  for (const par of cols.split(',')) {
    const [snake, tipo] = par.split(':');
    columnas.set(snakeACamel(snake), { snake, tipo: tipo as TipoColumna });
  }
  const def = { esquema, tabla, columnas };
  CACHE.set(entidad, def);
  return def;
}
