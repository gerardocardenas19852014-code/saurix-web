/**
 * Catálogo "Régimen fiscal" (Ventas) — mismo patrón de catálogo simple
 * clave/nombre que TipoListaPrecio (ver tipo-lista-precio.model.ts), para
 * que se pueda dar de alta/editar/desactivar un régimen sin tocar código.
 * Antes era un arreglo fijo en cliente.model.ts (REGIMENES_FISCALES); ese
 * mismo catálogo del SAT se usa ahora para sembrar los primeros registros
 * (ver RegimenesFiscalesComponent.ngOnInit — alta automática si la tabla
 * está vacía) pero ya es editable desde Ventas / Administración.
 */
export interface RegimenFiscal {
  id: number;
  clave: string;
  nombre: string;
  activo: boolean;
}

/** Semilla inicial: catálogo corto de regímenes de personas físicas/morales
 *  más comunes — se usa solo para poblar la tabla la primera vez que se
 *  entra a la pantalla (si ya tiene registros, no se vuelve a sembrar). */
export const REGIMENES_FISCALES_SEMILLA: { clave: string; nombre: string }[] = [
  { clave: '605', nombre: 'Sueldos y Salarios e Ingresos Asimilados a Salarios' },
  { clave: '606', nombre: 'Arrendamiento' },
  { clave: '608', nombre: 'Demás ingresos' },
  { clave: '611', nombre: 'Ingresos por Dividendos (socios y accionistas)' },
  { clave: '612', nombre: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { clave: '614', nombre: 'Ingresos por intereses' },
  { clave: '616', nombre: 'Sin obligaciones fiscales' },
  { clave: '621', nombre: 'Incorporación Fiscal' },
  { clave: '625', nombre: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas' },
  { clave: '626', nombre: 'Régimen Simplificado de Confianza' },
  { clave: '601', nombre: 'General de Ley Personas Morales' },
  { clave: '603', nombre: 'Personas Morales con Fines no Lucrativos' },
];
