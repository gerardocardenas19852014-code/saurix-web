import { Injectable, signal } from '@angular/core';

export type ToastTipo = 'info' | 'exito' | 'error' | 'advertencia';

export interface Toast {
  id: number;
  mensaje: string;
  tipo: ToastTipo;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();
  private siguienteId = 1;

  info(mensaje: string): void {
    this.mostrar(mensaje, 'info');
  }

  exito(mensaje: string): void {
    this.mostrar(mensaje, 'exito');
  }

  error(mensaje: string): void {
    this.mostrar(mensaje, 'error');
  }

  advertencia(mensaje: string): void {
    this.mostrar(mensaje, 'advertencia');
  }

  cerrar(id: number): void {
    this._toasts.update((lista) => lista.filter((t) => t.id !== id));
  }

  private mostrar(mensaje: string, tipo: ToastTipo): void {
    const id = this.siguienteId++;
    this._toasts.update((lista) => [...lista, { id, mensaje, tipo }]);
    setTimeout(() => this.cerrar(id), 6000);
  }
}
