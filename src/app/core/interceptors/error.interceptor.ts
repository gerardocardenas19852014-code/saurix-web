import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../../shared/services/toast.service';

/**
 * Interceptor global de errores HTTP: muestra un toast con el mensaje
 * del backend (si lo trae) y deja que el error siga propagándose para
 * que cada componente decida si necesita manejarlo puntualmente.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const mensaje =
        (typeof error.error === 'string' ? error.error : error.error?.message) ??
        error.message ??
        'Ocurrió un error inesperado al comunicarse con el servidor.';
      toast.error(mensaje);
      return throwError(() => error);
    }),
  );
};
