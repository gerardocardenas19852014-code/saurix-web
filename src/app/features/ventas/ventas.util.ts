import { jsPDF } from 'jspdf';
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


/** Formato de papel del ticket — Cambio 8 del prompt maestro
 *  Ventas→Cobro (2026-11). '80mm' es el default de SIEMPRE (térmica
 *  ancha); '58mm' es para térmicas angostas; 'carta' centra el mismo
 *  ticket en una hoja carta completa, para una impresora de oficina
 *  normal (ver @page más abajo). */
export type FormatoTicket = '58mm' | '80mm' | 'carta';

/** Estilos del ticket según el formato de papel — se usan junto con
 *  construirTicketHtml() en imprimirHtml() (ver shared/utils/imprimir.util.ts).
 *  Las mismas clases (.ticket-centro, .ticket-renglon, etc.) sirven para
 *  los 3 formatos — el contenido/HTML que arma construirTicketHtml() NUNCA
 *  cambia, solo el tamaño de papel/fuente. El caso '80mm' es el mismo CSS
 *  exacto que tenía antes la constante ESTILO_TICKET. */
export function estiloTicket(formato: FormatoTicket): string {
  const comun = `
    .ticket-centro { text-align: center; }
    .ticket-linea-punteada { border-top: 1px dashed #000; margin: 2mm 0; }
    .ticket-renglon { display: flex; justify-content: space-between; gap: 6px; }
    .ticket-item-nombre { flex: 1; }
    .ticket-pie { text-align: center; margin-top: 3mm; }
    @media print { body { padding: 0; } }
  `;
  if (formato === '58mm') {
    return `
      body { width: 54mm; margin: 0 auto; padding: 2mm; font-size: 10px; }
      .ticket-titulo { font-size: 13px; font-weight: 700; margin: 0 0 2mm; }
      .ticket-total-grande { font-size: 12px; font-weight: 700; }
      .ticket-pie { font-size: 9px; }
      ${comun}
    `;
  }
  if (formato === 'carta') {
    return `
      @page { size: letter; margin: 15mm; }
      body { width: 100mm; margin: 0 auto; padding: 0; font-size: 13px; }
      .ticket-titulo { font-size: 18px; font-weight: 700; margin: 0 0 3mm; }
      .ticket-total-grande { font-size: 16px; font-weight: 700; }
      .ticket-pie { font-size: 12px; }
      ${comun}
    `;
  }
  return `
    body { width: 78mm; margin: 0 auto; padding: 4mm; font-size: 12px; }
    .ticket-titulo { font-size: 15px; font-weight: 700; margin: 0 0 2mm; }
    .ticket-total-grande { font-size: 14px; font-weight: 700; }
    .ticket-pie { font-size: 11px; }
    ${comun}
  `;
}

/** Ancho (px) del iframe oculto de impresión — ver imprimirHtml() en
 *  shared/utils/imprimir.util.ts. No es el ancho real del papel, solo
 *  necesita ser razonable para que el navegador calcule el layout antes
 *  de imprimir (el default de imprimirHtml, 420px, era implícitamente
 *  "el ancho para 80mm" — aquí se hace explícito por formato). */
export function anchoPxTicket(formato: FormatoTicket): number {
  if (formato === '58mm') return 260;
  if (formato === 'carta') return 820;
  return 420;
}

/** Arma el cuerpo HTML del ticket de una venta — usado tanto justo después
 *  de cobrar (CobroComponent) como al reimprimir desde el Historial de
 *  ventas (HistorialVentasComponent), para no duplicar este armado en los
 *  dos lugares. */
export interface DatosTicket {
  venta: Pick<Venta, 'folio' | 'fecha' | 'subtotal' | 'descuento' | 'total' | 'estado'>;
  items: Pick<VentaItem, 'cantidad' | 'descripcion' | 'precioUnitario' | 'subtotal'>[];
  pagos: Pick<VentaPago, 'metodoPago' | 'monto' | 'cambio'>[];
  clienteNombre: string;
  cajeroNombre: string;
}

export function construirTicketHtml(datos: DatosTicket): string {
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

/** Mismo contenido del ticket que construirTicketHtml(), como texto plano
 *  -- para compartir por WhatsApp (Web Share API / enlace wa.me) o como
 *  cuerpo de un correo (Cambio 10, prompt maestro Ventas→Cobro 2026-11).
 *  Se arma en el mismo orden exacto, nunca se reinventa el contenido. */
export function mensajeTicketTexto(datos: DatosTicket): string {
  const { venta, items, pagos, clienteNombre, cajeroNombre } = datos;
  const fecha = new Date(venta.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

  const lineas: string[] = [
    'SAURIX — Ticket de venta',
    `Folio: ${venta.folio}`,
    `Fecha: ${fecha}`,
    `Cajero: ${cajeroNombre}`,
    `Cliente: ${clienteNombre}`,
    '',
    ...items.map((i) => `${i.cantidad} x ${i.descripcion} — ${formatMoneda(i.subtotal)}`),
    '',
  ];
  if (venta.descuento > 0) {
    lineas.push(`Subtotal: ${formatMoneda(venta.subtotal)}`);
    lineas.push(`Descuento: -${formatMoneda(venta.descuento)}`);
  }
  lineas.push(`Total: ${formatMoneda(venta.total)}`);
  lineas.push('');
  lineas.push(...pagos.map((p) => `${p.metodoPago}: ${formatMoneda(p.monto)}`));
  if (venta.estado === 'Cancelada') lineas.push('', '*** VENTA CANCELADA ***');
  lineas.push('', '¡Gracias por su compra!');
  return lineas.join('\n');
}

/** Validación simple de correo (Fase 6, 2026-11 -- optimización de
 *  Tickets): mismo criterio general que Validators.email de Angular,
 *  usado al capturar el correo del cliente (ver
 *  cliente-form-modal.component.ts) -- aquí se revalida en el punto de
 *  uso, para no precompletar "Enviar por correo" con un destinatario
 *  claramente inválido (dato viejo, importado, o capturado antes de que
 *  existiera esa validación). Si no pasa, se trata igual que "sin
 *  correo" -- se abre el cliente de correo sin destinatario, nunca se
 *  bloquea la acción completa por esto. */
export function correoEsValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim());
}

/** Validación simple de teléfono (Fase 6, 2026-11): exige entre 10 y 15
 *  dígitos (10 = formato nacional mexicano típico, hasta 15 = E.164
 *  internacional completo) -- para no armar un enlace wa.me con un
 *  número claramente incompleto o basura. Recibe el teléfono YA
 *  limpiado a solo dígitos (ver compartirTicketWhatsapp() en
 *  cobro.component.ts, que quita todo lo demás incluido el signo '+' --
 *  wa.me espera el número SIN '+'). */
export function telefonoEsValido(telefonoSoloDigitos: string): boolean {
  return /^\d{10,15}$/.test(telefonoSoloDigitos);
}

/** Mensaje BREVE para el enlace directo de WhatsApp (wa.me) -- Fase 6,
 *  2026-11: a propósito mucho más corto que mensajeTicketTexto() (el
 *  detalle completo línea por línea, que sigue usándose como cuerpo del
 *  correo) -- un ticket completo como mensaje de chat es largo e
 *  incómodo de leer. Folio y total son los únicos datos que de verdad
 *  hacen falta ahí; el ticket/PDF completo se comparte por una acción
 *  SEPARADA (ver "Compartir PDF" -- independiente de este mensaje,
 *  nunca prometido como adjunto automático de WhatsApp). */
export function mensajeWhatsappBreve(datos: DatosTicket): string {
  return [
    'Hola, te compartimos el comprobante de tu compra.',
    '',
    `Folio: ${datos.venta.folio}`,
    `Total: ${formatMoneda(datos.venta.total)}`,
    '',
    'Gracias por tu preferencia.',
  ].join('\n');
}

/** Ancho de página (mm) y margen por formato — usados solo por
 *  generarTicketPdfBlob(). 'carta' es una hoja carta letter completa (para
 *  una impresora de oficina normal); 58mm/80mm son el ancho real del
 *  rollo térmico, con el alto calculado a partir del número de renglones
 *  reales (igual que exportarTablaPdf() en pdf-tabla.util.ts: nada de
 *  medio metro de papel en blanco al final de un recibo angosto). */
const ANCHO_MM_TICKET: Record<FormatoTicket, number> = { '58mm': 58, '80mm': 80, carta: 215.9 };
const MARGEN_MM_TICKET: Record<FormatoTicket, number> = { '58mm': 3, '80mm': 4, carta: 50 };
const FUENTE_PT_TICKET: Record<FormatoTicket, number> = { '58mm': 7.5, '80mm': 9, carta: 10.5 };
const TITULO_PT_TICKET: Record<FormatoTicket, number> = { '58mm': 10, '80mm': 11.5, carta: 15 };

/** Genera el PDF del ticket — Cambio 8 ("PDF generator reuse/extension",
 *  jsPDF ya está instalado para esto, ver pdf-tabla.util.ts). Se usa para
 *  "Descargar PDF" y como adjunto al compartir por WhatsApp (Cambio 10)
 *  cuando el navegador lo permite (ver compartirTicketWhatsapp() en
 *  cobro.component.ts). Mismo contenido/orden que construirTicketHtml() --
 *  se dibuja a mano con jsPDF (texto plano, sin plugin de "recibo": mismo
 *  criterio que exportarTablaPdf()). */
export function generarTicketPdfBlob(datos: DatosTicket, formato: FormatoTicket): Blob {
  const { venta, items, pagos, clienteNombre, cajeroNombre } = datos;
  const fecha = new Date(venta.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

  const anchoPagina = ANCHO_MM_TICKET[formato];
  const margenX = MARGEN_MM_TICKET[formato];
  const anchoUtil = anchoPagina - margenX * 2;
  const fuente = FUENTE_PT_TICKET[formato];
  const fuenteTitulo = TITULO_PT_TICKET[formato];
  const lineH = fuente * 0.45 + 1.1; // mm aproximados por renglón a este tamaño de fuente

  // Cuenta de renglones reales (mismo orden que construirTicketHtml) --
  // determina el alto de página para 58mm/80mm (en 'carta' el alto ya es
  // fijo, el de la hoja completa).
  let renglones = 8; // título + subtítulo + línea + folio + fecha + cajero + cliente + línea
  renglones += items.length;
  renglones += 1; // línea antes del total
  if (venta.descuento > 0) renglones += 2;
  renglones += 1; // total
  renglones += 1; // línea antes de pagos
  renglones += pagos.length;
  if (venta.estado === 'Cancelada') renglones += 1;
  renglones += 2; // pie

  const altoContenido = renglones * lineH + 12;
  const altoPagina = formato === 'carta' ? 279.4 : Math.max(altoContenido, 40);

  const doc = new jsPDF({ unit: 'mm', format: formato === 'carta' ? 'letter' : [anchoPagina, altoPagina] });
  const xCentro = anchoPagina / 2;
  let y = formato === 'carta' ? 25 : 8;

  const centrado = (texto: string, tam: number, bold = false): void => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(tam);
    doc.text(texto, xCentro, y, { align: 'center' });
    y += lineH;
  };

  const renglon = (izq: string, der: string, bold = false): void => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? fuente + 1 : fuente);
    doc.text(izq, xCentro - anchoUtil / 2, y);
    doc.text(der, xCentro + anchoUtil / 2, y, { align: 'right' });
    y += lineH;
  };

  const lineaPunteada = (): void => {
    doc.setLineDashPattern([0.8, 0.8], 0);
    doc.line(xCentro - anchoUtil / 2, y, xCentro + anchoUtil / 2, y);
    doc.setLineDashPattern([], 0);
    y += lineH;
  };

  centrado('SAURIX', fuenteTitulo, true);
  centrado('Ticket de venta', fuente);
  lineaPunteada();
  renglon('Folio', venta.folio);
  renglon('Fecha', fecha);
  renglon('Cajero', cajeroNombre);
  renglon('Cliente', clienteNombre);
  lineaPunteada();
  for (const i of items) renglon(`${i.cantidad} x ${i.descripcion}`, formatMoneda(i.subtotal));
  lineaPunteada();
  if (venta.descuento > 0) {
    renglon('Subtotal', formatMoneda(venta.subtotal));
    renglon('Descuento', `-${formatMoneda(venta.descuento)}`);
  }
  renglon('Total', formatMoneda(venta.total), true);
  lineaPunteada();
  for (const p of pagos) renglon(p.metodoPago, formatMoneda(p.monto));
  if (venta.estado === 'Cancelada') centrado('*** VENTA CANCELADA ***', fuente, true);
  centrado('¡Gracias por su compra!', fuente);

  return doc.output('blob');
}
