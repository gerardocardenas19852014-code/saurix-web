import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { LicenciaModulosService, ModuloVendible } from '../services/licencia-modulos.service';
import { ToastService } from '../../shared/services/toast.service';

/** Bloquea la entrada a un módulo que la empresa no tiene contratado.
 *  La protección real está en la base (RLS, ver migración 15 y
 *  privado.modulo_habilitado) — este guard solo evita que alguien
 *  navegue a mano a la URL y se tope con pantallas vacías o errores
 *  crípticos de "no existe la entidad". */
export function moduloGuard(clave: ModuloVendible): CanActivateFn {
  return () => {
    const licencia = inject(LicenciaModulosService);
    if (licencia.habilitado(clave)) return true;
    inject(ToastService).advertencia('Tu empresa no tiene contratado este módulo.');
    return inject(Router).createUrlTree(['/modulos']);
  };
}
