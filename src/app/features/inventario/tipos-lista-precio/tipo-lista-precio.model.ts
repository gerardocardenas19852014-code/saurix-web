/**
 * Catálogo de tipos/segmentos de lista de precios (ej. "Lista general",
 * "Mayoreo", "Distribuidor", "Promocional"). El botón "Ver precios" de
 * cada renglón (ver tipos-lista-precio.component.ts) lleva a la pantalla
 * donde se le asigna el precio especial de esa lista a cada producto (ver
 * precio-lista.model.ts / lista-precio-detalle.component.ts). Asignar una
 * lista a un cliente queda pendiente: no existe todavía un catálogo de
 * clientes en el sistema (el módulo Comercio anterior se eliminó por
 * completo — ver historial de git, no revivido aquí).
 */
export interface TipoListaPrecio {
  id: number;
  nombre: string;
  clave: string;
  descripcion: string | null;
  activo: boolean;
}
