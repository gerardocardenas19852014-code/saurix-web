import { Injectable, effect, signal } from '@angular/core';

/**
 * Claves de tema tal como las usa el prototipo (`data-theme` en <html>).
 * 'claro' es el default y NO agrega el atributo (igual que en el HTML original).
 */
export type Tema = 'claro' | 'dark' | 'sepia' | 'ocean' | 'contrast' | 'mint';

export const TEMAS: { valor: Tema; etiqueta: string; swatch: string }[] = [
  { valor: 'claro', etiqueta: 'Claro', swatch: 'theme-swatch-light' },
  { valor: 'dark', etiqueta: 'Oscuro', swatch: 'theme-swatch-dark' },
  { valor: 'sepia', etiqueta: 'Sepia', swatch: 'theme-swatch-sepia' },
  { valor: 'ocean', etiqueta: 'Océano', swatch: 'theme-swatch-ocean' },
  { valor: 'contrast', etiqueta: 'Alto Contraste', swatch: 'theme-swatch-contrast' },
  { valor: 'mint', etiqueta: 'Menta', swatch: 'theme-swatch-mint' },
];

const STORAGE_KEY = 'saurix.tema';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly tema = signal<Tema>(this.leerTemaGuardado());

  constructor() {
    effect(() => {
      const tema = this.tema();
      if (tema === 'claro') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', tema);
      }
      this.guardarTema(tema);
    });
  }

  cambiar(tema: Tema): void {
    this.tema.set(tema);
  }

  private leerTemaGuardado(): Tema {
    try {
      return (localStorage.getItem(STORAGE_KEY) as Tema | null) ?? 'claro';
    } catch {
      return 'claro';
    }
  }

  private guardarTema(tema: Tema): void {
    try {
      localStorage.setItem(STORAGE_KEY, tema);
    } catch {
      /* localStorage no disponible; se ignora */
    }
  }
}
