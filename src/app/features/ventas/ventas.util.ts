import { escaparHtml } from '../../shared/utils/imprimir.util';
import { Venta, VentaItem, VentaPago } from './venta/venta.model';

/** Mismo formato que producto.util.ts (Inventario) — se repite aquí en vez
 *  de importar entre módulos para no acoplar Ventas a Inventario por un
 *  helper de 3 líneas (mismo criterio ya usado en todo el proyecto). */
export function formatMoneda(valor: number): string {
  const signo = valor < 0 ? '-$' : '$';
  return signo + Math.abs(valor).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Redondea a 2 decimales — evita que el residuo de punto flotante (p.ej.
 *  19.999999999998) haga que "faltan $0.00" se evalúe como si todavía
 *  faltara algo por cobrar (ver cobro.component.ts → faltantePorPagar()). */
export function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}


/** Estilos del ticket (impreso angosto, 80mm) — se usan junto con
 *  construirTicketHtml() en imprimirHtml() (ver shared/utils/imprimir.util.ts). */
export const ESTILO_TICKET = `
  body { width: 78mm; margin: 0 auto; padding: 4mm; font-size: 12px; }
  .ticket-centro { text-align: center; }
  .ticket-titulo { font-size: 15px; font-weight: 700; margin: 0 0 2mm; }
  .ticket-linea-punteada { border-top: 1px dashed #000; margin: 2mm 0; }
  .ticket-renglon { display: flex; justify-content: space-between; gap: 6px; }
  .ticket-item-nombre { flex: 1; }
  .ticket-total-grande { font-size: 14px; font-weight: 700; }
  .ticket-pie { text-align: center; margin-top: 3mm; font-size: 11px; }
  @media print { body { padding: 0; } }
`;

/** Arma el cuerpo HTML del ticket de una venta — usado tanto justo después
 *  de cobrar (CobroComponent) como al reimprimir desde el Historial de
 *  ventas (HistorialVentasComponent), para no duplicar este armado en los
 *  dos lugares. */
export function construirTicketHtml(datos: {
  venta: Pick<Venta, 'folio' | 'fecha' | 'subtotal' | 'descuento' | 'total' | 'estado'>;
  items: Pick<VentaItem, 'cantidad' | 'descripcion' | 'precioUnitario' | 'subtotal'>[];
  pagos: Pick<VentaPago, 'metodoPago' | 'monto' | 'cambio'>[];
  clienteNombre: string;
  cajeroNombre: string;
}): string {
  const { venta, items, pagos, clienteNombre, cajeroNombre } = datos;
  const fecha = new Date(venta.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

  const renglonesItems = items
    .map(
      (i) => `
      <div class="ticket-renglon">
        <span class="ticket-item-nombre">${escaparHtml(i.cantidad + ' x ' + i.descripcion)}</span>
        <span>${escaparHtml(formatMoneda(i.subtotal))}</span>
      </div>`,
    )
    .join('');

  const renglonesPagos = pagos
    .map(
      (p) => `
      <div class="ticket-renglon">
        <span>${escaparHtml(p.metodoPago)}</span>
        <span>${escaparHtml(formatMoneda(p.monto))}</span>
      </div>`,
    )
    .join('');

  return `
    <div class="ticket-centro">
      <p class="ticket-titulo">SAURIX</p>
      <p>Ticket de venta</p>
    </div>
    <div class="ticket-linea-punteada"></div>
    <div class="ticket-renglon"><span>Folio</span><span>${escaparHtml(venta.folio)}</span></div>
    <div class="ticket-renglon"><span>Fecha</span><span>${escaparHtml(fecha)}</span></div>
    <div class="ticket-renglon"><span>Cajero</span><span>${escaparHtml(cajeroNombre)}</span></div>
    <div class="ticket-renglon"><span>Cliente</span><span>${escaparHtml(clienteNombre)}</span></div>
    <div class="ticket-linea-punteada"></div>
    ${renglonesItems}
    <div class="ticket-linea-punteada"></div>
    ${
      venta.descuento > 0
        ? `<div class="ticket-renglon"><span>Subtotal</span><span>${escaparHtml(formatMoneda(venta.subtotal))}</span></div>
           <div class="ticket-renglon"><span>Descuento</span><span>-${escaparHtml(formatMoneda(venta.descuento))}</span></div>`
        : ''
    }
    <div class="ticket-renglon ticket-total-grande"><span>Total</span><span>${escaparHtml(formatMoneda(venta.total))}</span></div>
    <div class="ticket-linea-punteada"></div>
    ${renglonesPagos}
    ${venta.estado === 'Cancelada' ? '<p class="ticket-centro" style="font-weight:700; margin-top:3mm;">*** VENTA CANCELADA ***</p>' : ''}
    <p class="ticket-pie">¡Gracias por su compra!</p>
  `;
}
