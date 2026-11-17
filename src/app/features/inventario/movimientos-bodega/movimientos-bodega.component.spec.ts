import { evaluarAperturaMovimiento } from './movimientos-bodega.component';

describe('evaluarAperturaMovimiento — hallazgo QA "Movimiento masivo: mensaje incorrecto durante la carga"', () => {
  it('no permite abrir ni muestra ningún aviso mientras el catálogo de bodegas está cargando', () => {
    // Repro exacto del hallazgo: clic rápido en "📦 Movimiento masivo"
    // antes de que responda la consulta de bodegas — antes de la
    // corrección, esto mostraba "Antes crea al menos una Bodega activa"
    // aunque sí existieran bodegas, solo porque la consulta no había
    // respondido todavía.
    const resultado = evaluarAperturaMovimiento('cargando', 0, null);
    expect(resultado.permitido).toBe(false);
    expect(resultado.mensaje).toBeNull();
  });

  it('no permite abrir ni muestra el aviso incluso si, de casualidad, ya hay bodegas activas cargadas', () => {
    // Mientras el estado siga siendo "cargando" no debe decidir nada con
    // el array de bodegas todavía — es un estado de tránsito.
    const resultado = evaluarAperturaMovimiento('cargando', 3, null);
    expect(resultado.permitido).toBe(false);
    expect(resultado.mensaje).toBeNull();
  });

  it('muestra el error real (no "crea una bodega") cuando la carga de bodegas falló', () => {
    const resultado = evaluarAperturaMovimiento('error', 0, 'Falló la red al consultar bodegas.');
    expect(resultado.permitido).toBe(false);
    expect(resultado.mensaje).toBe('Falló la red al consultar bodegas.');
  });

  it('usa un mensaje genérico de respaldo si el estado de error no traía un mensaje concreto', () => {
    const resultado = evaluarAperturaMovimiento('error', 0, null);
    expect(resultado.permitido).toBe(false);
    expect(resultado.mensaje).toBe('No se pudo cargar el catálogo de bodegas.');
  });

  it('solo muestra "Antes crea al menos una Bodega activa" cuando SÍ se consultó con éxito y de verdad no hay ninguna', () => {
    const resultado = evaluarAperturaMovimiento('listo', 0, null);
    expect(resultado.permitido).toBe(false);
    expect(resultado.mensaje).toBe('Antes crea al menos una Bodega activa (Inventario → Bodegas).');
  });

  it('permite abrir sin ningún aviso cuando la carga terminó con éxito y hay al menos una bodega activa', () => {
    const resultado = evaluarAperturaMovimiento('listo', 1, null);
    expect(resultado.permitido).toBe(true);
    expect(resultado.mensaje).toBeNull();
  });
});
