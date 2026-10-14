import { Injectable, inject, signal } from '@angular/core';
import { fuenteDatosActual } from './fuente-datos';
import { SupabaseService } from './supabase.service';

/** Claves de los módulos "vendibles" (cada empresa puede o no tenerlos
 *  contratados) — coinciden con el segmento de ruta y con el modulo_clave
 *  que usan las políticas RESTRICTIVE de Supabase (ver
 *  supabase/migrations/15_licencias_modulos.sql). Seguridad y Panel de
 *  control NO están aquí: son base del sistema, siempre habilitados. */
export const MODULOS_VENDIBLES = ['wikidocs', 'presupuesto', 'proyectos', 'familia', 'inventario'] as const;
export type ModuloVendible = (typeof MODULOS_VENDIBLES)[number];

function esModuloVendible(clave: string): clave is ModuloVendible {
  return (MODULOS_VENDIBLES as readonly string[]).includes(clave);
}

/**
 * Qué módulos tiene contratados la empresa en sesión. Solo aplica en la
 * Nube — en IndexedDB/local no hay concepto de "empresa que compra
 * módulos", así que ahí todo queda habilitado.
 *
 * Esto es nada más para que la app no OFREZCA ni deje ENTRAR por URL a un
 * módulo no contratado: quien de verdad lo protege es la política RLS
 * privado.modulo_habilitado() del lado del servidor (ver migración 15),
 * así que si esta señal tarda en cargar o falla, se prefiere no bloquear
 * de más — la base de todos modos va a rechazar cualquier lectura/escritura.
 */
@Injectable({ providedIn: 'root' })
export class LicenciaModulosService {
  private readonly sb = fuenteDatosActual() === 'supabase' ? inject(SupabaseService).cliente : null;

  private readonly habilitados = signal<Set<ModuloVendible> | null>(null);

  /** Llamar justo después de establecer la sesión (login fresco o sesión
   *  restaurada) — ver AuthService. */
  async cargar(): Promise<void> {
    if (!this.sb) {
      this.habilitados.set(new Set(MODULOS_VENDIBLES));
      return;
    }
    const { data, error } = await this.sb.schema('seguridad').rpc('mis_modulos');
    if (error) {
      this.habilitados.set(new Set(MODULOS_VENDIBLES));
      return;
    }
    const claves = ((data ?? []) as { modulo_clave: string }[])
      .map((f) => f.modulo_clave)
      .filter(esModuloVendible);
    this.habilitados.set(new Set(claves));
  }

  /** Al cerrar sesión / cambiar de empresa (modo soporte): fuerza a
   *  recalcular en el próximo cargar() en vez de arrastrar los módulos de
   *  la sesión anterior. */
  limpiar(): void {
    this.habilitados.set(null);
  }

  /** true si la empresa en sesión tiene ese módulo habilitado. Una clave
   *  que no es de los 5 módulos vendibles (seguridad, panel-control, o
   *  cualquier otra ruta) siempre es true: no se gatean. */
  habilitado(clave: string): boolean {
    if (!esModuloVendible(clave)) return true;
    const set = this.habilitados();
    if (set === null) return true; // todavía no cargó: no bloquear de más mientras resuelve
    return set.has(clave);
  }
}
