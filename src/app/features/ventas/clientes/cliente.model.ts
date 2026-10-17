/**
 * Contacto/cliente para Ventas, con los datos fiscales mínimos para poder
 * facturar (CFDI) más adelante — RFC, régimen fiscal y domicilio fiscal.
 * Ningún campo fiscal es obligatorio a nivel de formulario salvo nombre y
 * RFC: una venta "Público en General" usa el contacto genérico de abajo
 * (RFC_GENERICO) en vez de capturar datos reales cada vez.
 *
 * `esGenerico` marca ESE contacto especial — ver ClienteService.obtenerOCrearGenerico().
 * Se protege en la pantalla de catálogo (Clientes) para que no se pueda
 * editar su RFC ni darlo de baja por accidente, mismo criterio de
 * protección que `clavesProtegidas` usa en los catálogos de Familia, pero
 * implementado aquí con esta bandera propia porque Cliente es una entidad
 * completa (no un simple ValorList de clave/etiqueta).
 */
export interface Cliente {
  id: number;
  nombre: string;
  rfc: string;
  /** true = contacto extranjero sin RFC mexicano válido — en ese caso se
   *  sigue guardando el RFC genérico de extranjero 'XEXX010101000' (otra
   *  convención del SAT, distinta de la de "Público en General"). */
  esExtranjero: boolean;
  /** Clave de catálogo (ver RegimenFiscal en regimen-fiscal.model.ts, Ventas /
   *  Administración / Regímenes fiscales) — texto libre por compatibilidad,
   *  ya no un arreglo fijo en este archivo. */
  regimenFiscalClave: string | null;
  /** 'México' por default (y fijo mientras esExtranjero sea false) — libre
   *  solo cuando esExtranjero es true, ver cliente-form-modal.component.ts. */
  pais: string;
  codigoPostal: string | null;
  colonia: string | null;
  calle: string | null;
  numeroExterior: string | null;
  numeroInterior: string | null;
  estado: string | null;
  municipio: string | null;
  localidad: string | null;
  correo: string | null;
  telefono: string | null;
  /** "Información de venta": lista de precio que se preselecciona en Cobro
   *  en cuanto se elige este cliente (ver CobroComponent.elegirCliente()) —
   *  un valor por default que se puede cambiar al vender, nunca una regla
   *  fija. null = sin lista predeterminada (usa el precio general). */
  listaPrecioPredeterminadaId: number | null;
  /** true solo para el contacto sembrado "Público en General" — ver
   *  ClienteService.obtenerOCrearGenerico(). Nunca se marca a mano desde el
   *  formulario (el checkbox no existe en la pantalla). */
  esGenerico: boolean;
  /** Puntos acumulados del programa de lealtad (ver lealtad.model.ts) —
   *  opcional por compatibilidad con clientes creados antes de que existiera
   *  el programa; tratar como 0 si falta (ver puntosCliente() en
   *  lealtad.service.ts). Nunca se edita a mano desde el formulario de
   *  Cliente — solo lo mueve ProgramaLealtadService, ganado al vender y
   *  descontado al canjear. */
  puntosAcumulados?: number;
  activo: boolean;
}

/** RFC genérico para ventas sin datos fiscales reales del cliente —
 *  convención del SAT para "Público en General" (ventas al público sin
 *  factura nominativa). */
export const RFC_GENERICO = 'XAXX010101000';
/** RFC genérico para extranjeros sin RFC mexicano — misma convención del
 *  SAT, lista para cuando Cliente.esExtranjero se use en un formulario de
 *  facturación real. */
export const RFC_GENERICO_EXTRANJERO = 'XEXX010101000';
export const NOMBRE_CLIENTE_GENERICO = 'Público en General';

