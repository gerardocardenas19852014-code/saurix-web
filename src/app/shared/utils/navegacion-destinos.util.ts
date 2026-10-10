export interface DestinoPaleta {
  label: string;
  grupo: string;
  ruta: string;
  icono: string;
}

/** Lista plana de todos los destinos "de primer nivel" de cada módulo (los
 *  mismos que ya se listan, agrupados, en la barra lateral de
 *  ShellComponent) — a propósito NO incluye registros individuales (un
 *  ticket puntual, un movimiento puntual, etc.): es un atajo de
 *  NAVEGACIÓN entre pantallas, no un buscador global de datos (eso quedó
 *  fuera de alcance, ver tarea #91/#117 en la lista de mejoras). Si se
 *  agrega una pantalla nueva a algún módulo, hay que sumarla aquí también. */
export const DESTINOS: DestinoPaleta[] = [
  { label: 'Selector de módulos', grupo: 'Saurix', ruta: '/modulos', icono: '🏠' },

  { label: 'Inicio', grupo: 'Seguridad', ruta: '/seguridad', icono: '⌂' },
  { label: 'Usuarios', grupo: 'Seguridad', ruta: '/seguridad/usuarios', icono: '👥' },
  { label: 'Empresas', grupo: 'Seguridad', ruta: '/seguridad/empresas', icono: '🏢' },


  { label: 'Inicio', grupo: 'WikiDocs', ruta: '/wikidocs', icono: '⌂' },
  { label: 'Documentos', grupo: 'WikiDocs', ruta: '/wikidocs/documentos', icono: '📚' },
  { label: 'Tipo de sistema', grupo: 'WikiDocs', ruta: '/wikidocs/tipos-sistema', icono: '🗂️' },
  { label: 'Categoría', grupo: 'WikiDocs', ruta: '/wikidocs/categorias', icono: '📖' },
  { label: 'Secciones', grupo: 'WikiDocs', ruta: '/wikidocs/secciones', icono: '📑' },

  { label: 'Inicio', grupo: 'Presupuesto Personal', ruta: '/presupuesto', icono: '⌂' },
  { label: 'Dashboard', grupo: 'Presupuesto Personal', ruta: '/presupuesto/dashboard', icono: '📊' },
  { label: 'Proyección', grupo: 'Presupuesto Personal', ruta: '/presupuesto/proyeccion', icono: '📈' },
  { label: 'Movimientos', grupo: 'Presupuesto Personal', ruta: '/presupuesto/movimientos', icono: '💸' },
  { label: 'Fijos y Proyección', grupo: 'Presupuesto Personal', ruta: '/presupuesto/recurrentes', icono: '🔁' },
  { label: 'Deudas', grupo: 'Presupuesto Personal', ruta: '/presupuesto/deudas', icono: '🏦' },
  { label: 'Metas de ahorro', grupo: 'Presupuesto Personal', ruta: '/presupuesto/metas', icono: '🏆' },
  { label: 'Límites de gasto', grupo: 'Presupuesto Personal', ruta: '/presupuesto/limites', icono: '🎯' },
  { label: 'Reportes', grupo: 'Presupuesto Personal', ruta: '/presupuesto/reportes', icono: '📊' },
  { label: 'Calendario de pagos', grupo: 'Presupuesto Personal', ruta: '/presupuesto/calendario', icono: '📅' },
  { label: 'Categorías de presupuesto', grupo: 'Presupuesto Personal', ruta: '/presupuesto/categorias-presupuesto', icono: '🏷️' },
  { label: 'Cuentas de presupuesto', grupo: 'Presupuesto Personal', ruta: '/presupuesto/cuentas-presupuesto', icono: '🏦' },
  { label: 'Tipo de cuenta', grupo: 'Presupuesto Personal', ruta: '/presupuesto/tipo-cuenta-presupuesto', icono: '💳' },
  { label: 'Tipo de movimiento', grupo: 'Presupuesto Personal', ruta: '/presupuesto/tipo-movimiento-presupuesto', icono: '↔️' },
  { label: 'Frecuencia de fijos', grupo: 'Presupuesto Personal', ruta: '/presupuesto/frecuencia-fijos-presupuesto', icono: '🔁' },
  { label: 'Presupuesto por año', grupo: 'Presupuesto Personal', ruta: '/presupuesto/presupuesto-anual', icono: '🗓️' },
  { label: 'Estatus de presupuesto anual', grupo: 'Presupuesto Personal', ruta: '/presupuesto/estatus-presupuesto-anual', icono: '🚦' },

  { label: 'Inicio', grupo: 'Gestión de Proyectos', ruta: '/proyectos', icono: '⌂' },
  { label: 'Ticket', grupo: 'Gestión de Proyectos', ruta: '/proyectos/tablero', icono: '🗂️' },
  { label: 'Backlog', grupo: 'Gestión de Proyectos', ruta: '/proyectos/backlog', icono: '📋' },
  { label: 'Gestor de Estados', grupo: 'Gestión de Proyectos', ruta: '/proyectos/gestor-estados', icono: '🧭' },
  { label: 'Proyectos', grupo: 'Gestión de Proyectos', ruta: '/proyectos/proyectos', icono: '📁' },
  { label: 'Tipos de Ticket', grupo: 'Gestión de Proyectos', ruta: '/proyectos/tipos-ticket', icono: '🏳️' },
  { label: 'Prioridades', grupo: 'Gestión de Proyectos', ruta: '/proyectos/prioridades', icono: '🚦' },
  { label: 'Módulos', grupo: 'Gestión de Proyectos', ruta: '/proyectos/modulos', icono: '🧭' },
  { label: 'Mi Dashboard', grupo: 'Gestión de Proyectos', ruta: '/proyectos/dashboard', icono: '📊' },
  { label: 'Reportes de horas', grupo: 'Gestión de Proyectos', ruta: '/proyectos/reportes-horas', icono: '⏱️' },
  { label: 'Gantt', grupo: 'Gestión de Proyectos', ruta: '/proyectos/gantt', icono: '📅' },
  { label: 'Resumen ejecutivo', grupo: 'Gestión de Proyectos', ruta: '/proyectos/resumen-ejecutivo', icono: '📈' },
  { label: 'Balanceo', grupo: 'Gestión de Proyectos', ruta: '/proyectos/balanceo', icono: '⚖️' },
  { label: 'Reportes ejecutivos', grupo: 'Gestión de Proyectos', ruta: '/proyectos/reportes-ejecutivos', icono: '📊' },

  { label: 'Inicio', grupo: 'Panel de Control', ruta: '/panel-control', icono: '⌂' },
  { label: 'Apariencia', grupo: 'Panel de Control', ruta: '/panel-control/apariencia', icono: '🎨' },
  { label: 'Respaldo y restauración', grupo: 'Panel de Control', ruta: '/panel-control/respaldo', icono: '💾' },

  // Faltaba el módulo Familia completo (hallado 2026-10-10 al agregar
  // Directorio familiar) — sin esto, WikiDocs no podía referenciar ninguna
  // pantalla de Familia como "módulo" (ver DocumentoReferenciaModulo) y
  // Familia tampoco tenía breadcrumb, porque ShellComponent arma el
  // breadcrumb con esta misma lista.
  { label: 'Inicio', grupo: 'Familia', ruta: '/familia', icono: '⌂' },
  { label: 'Miembros de familia', grupo: 'Familia', ruta: '/familia/miembros', icono: '👪' },
  { label: 'Árbol genealógico', grupo: 'Familia', ruta: '/familia/arbol', icono: '🌳' },
  { label: 'Calendario familiar', grupo: 'Familia', ruta: '/familia/calendario', icono: '📅' },
  { label: 'Resumen', grupo: 'Familia', ruta: '/familia/resumen', icono: '🔔' },
  { label: 'Trámites familiares', grupo: 'Familia', ruta: '/familia/tramites', icono: '🗒️' },
  { label: 'Tareas del hogar', grupo: 'Familia', ruta: '/familia/tareas', icono: '🧹' },
  { label: 'Directorio familiar', grupo: 'Familia', ruta: '/familia/directorio', icono: '📇' },
  { label: 'Parentesco', grupo: 'Familia', ruta: '/familia/parentesco', icono: '👤' },
  { label: 'Tipo de documento', grupo: 'Familia', ruta: '/familia/tipo-documento', icono: '🗂️' },
  { label: 'Sexo', grupo: 'Familia', ruta: '/familia/sexo', icono: '🚻' },
  { label: 'Entidad de nacimiento', grupo: 'Familia', ruta: '/familia/entidad-nacimiento', icono: '🗺️' },
  { label: 'Tipo de sangre', grupo: 'Familia', ruta: '/familia/tipo-sangre', icono: '🩸' },
  { label: 'Proveedores de salud', grupo: 'Familia', ruta: '/familia/proveedor-salud', icono: '🏥' },
  { label: 'Categoría de contacto', grupo: 'Familia', ruta: '/familia/categoria-contacto', icono: '📇' },
];