import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { CONEXIONES, conexionActual } from '../../../core/services/conexion';
import { SupabaseService } from '../../../core/services/supabase.service';

interface EmpresaSesion {
  id: number;
  nombre: string;
  es_superadmin: boolean;
  es_soporte: boolean;
}

/**
 * Indicador SIEMPRE visible de dónde se están guardando los datos:
 *  - una franja de color en el borde superior de toda la app, y
 *  - una etiqueta fija arriba al centro: NUBE (verde) / LOCAL (naranja) y,
 *    en la nube, la empresa de la sesión. Si el superadmin está trabajando
 *    dentro de otra empresa (modo soporte) se pinta morado y ofrece regresar.
 * Además antepone el ambiente al título de la pestaña del navegador.
 * Se monta una sola vez en App: aparece en login, panel de módulos y en
 * todos los módulos.
 */
@Component({
  selector: 'app-indicador-ambiente',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ambiente-franja" [class.local]="!enNube" [class.soporte]="empresa()?.es_soporte" aria-hidden="true"></div>
    <div class="ambiente-etiqueta" [class.local]="!enNube" [class.soporte]="empresa()?.es_soporte" role="status" [attr.title]="detalle">
      {{ enNube ? (empresa()?.es_soporte ? '🛟 SOPORTE' : '☁️ NUBE') : '💻 LOCAL' }}
      <span class="ambiente-sub">{{ subtitulo() }}</span>
      @if (empresa()?.es_soporte) {
        <button type="button" class="ambiente-salir" (click)="salirDeSoporte()">Volver a mi empresa</button>
      }
    </div>
  `,
  styles: `
    :host { display: contents; }
    .ambiente-franja {
      position: fixed; top: 0; left: 0; right: 0; height: 4px; z-index: 1000;
      background: #2e7d5b; pointer-events: none;
    }
    .ambiente-etiqueta {
      position: fixed; top: 0; left: 50%; transform: translateX(-50%); z-index: 1000;
      display: flex; align-items: center; gap: 6px;
      padding: 3px 12px 4px; border-radius: 0 0 10px 10px;
      background: #2e7d5b; color: #fff;
      font: 700 11px/1.2 'Montserrat', sans-serif; letter-spacing: .06em;
      box-shadow: 0 4px 12px -4px rgba(0, 0, 0, .35);
      white-space: nowrap; user-select: none;
    }
    .ambiente-sub { font-weight: 500; letter-spacing: 0; opacity: .9; }
    .local { background: #c2410c; }
    .soporte { background: #7c3aed; }
    .ambiente-salir {
      margin-left: 4px; border: 1px solid rgba(255, 255, 255, .7); border-radius: 999px;
      background: transparent; color: #fff; font: inherit; font-weight: 600; letter-spacing: 0;
      padding: 1px 8px; cursor: pointer;
    }
    .ambiente-salir:hover { background: rgba(255, 255, 255, .15); }
    @media (max-width: 640px) { .ambiente-sub { display: none; } }
  `,
})
export class IndicadorAmbienteComponent implements OnInit {
  protected readonly enNube = fuenteDatosActual() === 'supabase';
  private readonly conexion = conexionActual();
  private readonly sb = this.enNube ? inject(SupabaseService).cliente : null;

  protected readonly empresa = signal<EmpresaSesion | null>(null);

  protected subtitulo(): string {
    if (!this.enNube) return 'solo este navegador';
    const partes: string[] = [];
    if (CONEXIONES.length > 1) partes.push(this.conexion.nombre);
    const empresa = this.empresa();
    if (empresa) partes.push(empresa.nombre);
    return partes.length ? partes.join(' · ') : 'Supabase';
  }

  protected readonly detalle = this.enNube
    ? 'Trabajando en la nube (Supabase). Los datos se comparten entre dispositivos y quedan en la empresa indicada.'
    : 'Trabajando en local (IndexedDB). Los datos solo existen en este navegador.';

  ngOnInit(): void {
    const prefijo = this.enNube ? '☁️ Nube' : '💻 Local';
    document.title = `${prefijo} · Saurix`;
    if (!this.sb) return;
    void this.cargarEmpresa();
    // Al iniciar o cerrar sesión cambia la empresa que se muestra.
    this.sb.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') {
        setTimeout(() => void this.cargarEmpresa(), 0);
      }
    });
  }

  private async cargarEmpresa(): Promise<void> {
    if (!this.sb) return;
    const { data: sesion } = await this.sb.auth.getSession();
    if (!sesion.session) {
      this.empresa.set(null);
      return;
    }
    const { data } = await this.sb.schema('seguridad').rpc('empresa_sesion');
    this.empresa.set(((data as EmpresaSesion[] | null) ?? [])[0] ?? null);
  }

  async salirDeSoporte(): Promise<void> {
    if (!this.sb) return;
    await this.sb.schema('seguridad').rpc('cambiar_empresa_activa', { p_empresa: null });
    window.location.assign('/modulos');
  }
}
