import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ConfiguracionVentasService } from '../../shared/services/configuracion-ventas.service';
import { ToastService } from '../../shared/services/toast.service';

/** Bloquea la entrada por URL directa a "Apertura de caja"/"Corte de caja"/
 *  "Cierre de caja" cuando el parámetro correspondiente está apagado en
 *  Panel de Control → Parámetros del sistema (ver ConfiguracionVentasService)
 *  — mismo criterio que moduloGuard: el menú/Inicio ya los ocultan (ver
 *  ShellComponent/VentasLandingComponent), esto es solo para quien
 *  escriba la URL a mano o tenga el link guardado de cuando sí estaban
 *  activos. */
export function parametroVentasGuard(
  parametro: 'aperturaCajaActivo' | 'corteCajaActivo' | 'cierreCajaActivo',
): CanActivateFn {
  return async () => {
    const configuracionVentas = inject(ConfiguracionVentasService);
    await configuracionVentas.cargar();
    if (configuracionVentas[parametro]()) return true;
    const etiqueta =
      parametro === 'aperturaCajaActivo'
        ? 'Apertura de caja'
        : parametro === 'corteCajaActivo'
          ? 'Corte de caja'
          : 'Cierre de caja';
    inject(ToastService).advertencia(`"${etiqueta}" está desactivado — actívalo en Panel de Control → Parámetros del sistema.`);
    return inject(Router).createUrlTree(['/ventas']);
  };
}
