import {
  calcularSubtotalDevolucion,
  cantidadDisponibleParaDevolver,
  folioSugeridoDevolucion,
  LineaDevolucionEntrada,
  lineaDevolucionEnCeros,
} from './devolucion.service';
import { Devolucion, DevolucionItem } from './devolucion.model';
import { VentaItem } from '../venta/venta.model';

/** Fixture mínimo de VentaItem — solo los campos que de verdad usan las
 *  funciones puras bajo prueba (cantidad/subtotal). */
function ventaItem(parcial: Partial<VentaItem> = {}): VentaItem {
  return {
    id: 1,
    ventaId: 1,
    productoId: 10,
    descripcion: 'Producto de prueba',
    cantidad: 2,
    precioUnitario: 10,
    descuentoPct: 0,
    subtotal: 20,
    bodegaId: 5,
    activo: true,
    ...parcial,
  };
}

function devolucionItem(parcial: Partial<DevolucionItem> = {}): DevolucionItem {
  return {
    id: 1,
    devolucionId: 1,
    ventaItemId: 1,
    productoId: 10,
    descripcion: 'Producto de prueba',
    cantidad: 1,
    precioUnitario: 10,
    subtotal: 10,
    bodegaId: 5,
    activo: true,
    ...parcial,
  };
}

function linea(parcial: Partial<LineaDevolucionEntrada> = {}): LineaDevolucionEntrada {
  return {
    ventaItemId: 1,
    productoId: 10,
    descripcion: 'Producto de prueba',
    cantidad: 1,
    precioUnitario: 10,
    subtotal: 10,
    bodegaId: 5,
    ...parcial,
  };
}

describe('calcularSubtotalDevolucion — hallazgo QA "Devolución parcial: total a reembolsar en $0"', () => {
  it('calcula cantidad × precio neto (venta de 2 unidades a $10, sin descuento)', () => {
    // Repro exacto del hallazgo: producto a $10, venta de 2 unidades por
    // $20 (sin descuento), se devuelve 1 unidad → esperado $10.00.
    const item = ventaItem({ cantidad: 2, subtotal: 20 });
    expect(calcularSubtotalDevolucion(item, 1)).toBe(10);
  });

  it('respeta el descuento ya aplicado al renglón de venta', () => {
    // Venta de 4 unidades a $10 con 25% de descuento → subtotal real $30
    // (precio neto $7.50/unidad). Devolver 2 debe dar $15.00, no $20.00.
    const item = ventaItem({ cantidad: 4, subtotal: 30 });
    expect(calcularSubtotalDevolucion(item, 2)).toBe(15);
  });

  it('da $0 cuando la cantidad a devolver es 0 o negativa', () => {
    const item = ventaItem({ cantidad: 2, subtotal: 20 });
    expect(calcularSubtotalDevolucion(item, 0)).toBe(0);
    expect(calcularSubtotalDevolucion(item, -1)).toBe(0);
  });

  it('da $0 sin dividir entre cero cuando el renglón de venta no tiene cantidad', () => {
    const item = ventaItem({ cantidad: 0, subtotal: 0 });
    expect(calcularSubtotalDevolucion(item, 1)).toBe(0);
  });

  it('redondea a centavos igual que el resto de montos monetarios del sistema', () => {
    // 3 unidades por $10 con 10% de descuento → subtotal real $27,
    // precio neto $9.00/unidad exacto — pero con descuentos que no caen
    // exacto (p.ej. $27.333...) el resultado no debe arrastrar más de 2
    // decimales.
    const item = ventaItem({ cantidad: 3, subtotal: 27.3333 });
    const resultado = calcularSubtotalDevolucion(item, 1);
    expect(resultado).toBeCloseTo(9.11, 2);
  });
});

describe('lineaDevolucionEnCeros — nunca procesar una devolución en ceros', () => {
  it('detecta la línea con cantidad positiva pero importe en $0', () => {
    const lineas = [linea({ cantidad: 2, subtotal: 20 }), linea({ ventaItemId: 2, cantidad: 1, subtotal: 0 })];
    const invalida = lineaDevolucionEnCeros(lineas);
    expect(invalida).toBeDefined();
    expect(invalida?.ventaItemId).toBe(2);
  });

  it('detecta también un importe negativo', () => {
    const lineas = [linea({ cantidad: 1, subtotal: -5 })];
    expect(lineaDevolucionEnCeros(lineas)).toBeDefined();
  });

  it('no marca nada cuando todas las líneas con cantidad > 0 tienen importe > 0', () => {
    const lineas = [linea({ cantidad: 2, subtotal: 20 }), linea({ ventaItemId: 2, cantidad: 1, subtotal: 10 })];
    expect(lineaDevolucionEnCeros(lineas)).toBeUndefined();
  });

  it('ignora una línea en $0 si su cantidad también es 0 (no se va a enviar)', () => {
    const lineas = [linea({ cantidad: 0, subtotal: 0 })];
    expect(lineaDevolucionEnCeros(lineas)).toBeUndefined();
  });
});

describe('cantidadDisponibleParaDevolver — límite de la devolución', () => {
  it('permite devolver hasta lo vendido cuando no hay devoluciones previas', () => {
    const item = ventaItem({ cantidad: 5 });
    expect(cantidadDisponibleParaDevolver(item, [])).toBe(5);
  });

  it('resta lo ya devuelto en devoluciones anteriores del mismo renglón', () => {
    const item = ventaItem({ id: 1, cantidad: 5 });
    const previos = [devolucionItem({ ventaItemId: 1, cantidad: 2 })];
    expect(cantidadDisponibleParaDevolver(item, previos)).toBe(3);
  });

  it('nunca da un disponible negativo aunque ya se haya devuelto todo (o más, por inconsistencia histórica)', () => {
    const item = ventaItem({ id: 1, cantidad: 5 });
    const previos = [devolucionItem({ ventaItemId: 1, cantidad: 7 })];
    expect(cantidadDisponibleParaDevolver(item, previos)).toBe(0);
  });

  it('ignora devoluciones de OTRO renglón de venta', () => {
    const item = ventaItem({ id: 1, cantidad: 5 });
    const previos = [devolucionItem({ ventaItemId: 999, cantidad: 3 })];
    expect(cantidadDisponibleParaDevolver(item, previos)).toBe(5);
  });

  it('ignora DevolucionItem inactivos (activo: false)', () => {
    const item = ventaItem({ id: 1, cantidad: 5 });
    const previos = [devolucionItem({ ventaItemId: 1, cantidad: 3, activo: false })];
    expect(cantidadDisponibleParaDevolver(item, previos)).toBe(5);
  });

  it('suma varias devoluciones previas del mismo renglón', () => {
    const item = ventaItem({ id: 1, cantidad: 10 });
    const previos = [
      devolucionItem({ id: 1, ventaItemId: 1, cantidad: 2 }),
      devolucionItem({ id: 2, ventaItemId: 1, cantidad: 3 }),
    ];
    expect(cantidadDisponibleParaDevolver(item, previos)).toBe(5);
  });
});

describe('folioSugeridoDevolucion', () => {
  it('empieza en DEV-0001 cuando no hay devoluciones previas', () => {
    expect(folioSugeridoDevolucion([])).toBe('DEV-0001');
  });

  it('continúa a partir del folio más alto existente', () => {
    const devoluciones = [{ folio: 'DEV-0001' } as Devolucion, { folio: 'DEV-0003' } as Devolucion];
    expect(folioSugeridoDevolucion(devoluciones)).toBe('DEV-0004');
  });
});
