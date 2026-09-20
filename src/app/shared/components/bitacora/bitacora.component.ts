import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BitacoraRegistro, BitacoraService } from '../../services/bitacora.service';
import { AuthService } from '../../../core/services/auth.service';
import { exportarCsv } from '../../utils/csv.util';

@Component({
  selector: 'app-bitacora',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './bitacora.component.html',
  styleUrl: './bitacora.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BitacoraComponent {
  readonly modulo = input.required<string>();

  private readonly bitacora = inject(BitacoraService);
  private readonly auth = inject(AuthService);

  protected readonly abierta = signal(false);
  protected readonly cargando = signal(false);
  protected readonly registros = signal<BitacoraRegistro[]>([]);
  protected readonly registroSeleccionado = signal<BitacoraRegistro | null>(null);
  protected readonly ultimoRegistro = computed(() => this.registros()[0] ?? null);

  // Filtros de la tabla (el "Último evento" de arriba siempre refleja el
  // historial completo, sin filtrar).
  protected readonly filtroDesde = signal('');
  protected readonly filtroHasta = signal('');
  protected readonly filtroAccion = signal('');
  protected readonly filtroUsuario = signal('');

  protected readonly accionesDisponibles = computed(() => {
    const acciones = new Set(this.registros().map((r) => r.accion));
    return [...acciones].sort();
  });

  protected readonly registrosFiltrados = computed(() => {
    const desde = this.filtroDesde();
    const hasta = this.filtroHasta();
    const accion = this.filtroAccion();
    const usuario = this.filtroUsuario().trim().toLowerCase();

    return this.registros().filter((registro) => {
      const fechaRegistro = registro.fecha.slice(0, 10);
      if (desde && fechaRegistro < desde) return false;
      if (hasta && fechaRegistro > hasta) return false;
      if (accion && registro.accion !== accion) return false;
      if (usuario && !registro.usuario.toLowerCase().includes(usuario)) return false;
      return true;
    });
  });

  abrir(): void {
    this.cargando.set(true);
    this.abierta.set(true);
    this.registroSeleccionado.set(null);
    this.filtroDesde.set('');
    this.filtroHasta.set('');
    this.filtroAccion.set('');
    this.filtroUsuario.set('');
    this.bitacora.listar(this.modulo()).subscribe({
      next: (registros) => {
        this.registros.set(registros);
        this.cargando.set(false);
      },
      error: () => {
        this.registros.set([]);
        this.cargando.set(false);
      },
    });
  }

  cerrar(): void {
    this.abierta.set(false);
    this.registroSeleccionado.set(null);
  }

  seleccionar(registro: BitacoraRegistro): void {
    this.registroSeleccionado.set(registro);
    const usuarioActual = this.auth.usuarioActual()?.nombreUsuario ?? 'Sistema';
    this.bitacora.registrarConsulta(this.modulo(), 'Bitacora', usuarioActual, registro.id).subscribe();
  }

  exportarCsv(): void {
    const filas = this.registrosFiltrados().map((registro) => ({
      accion: registro.accion,
      fecha: this.fecha(registro.fecha),
      usuario: registro.usuario,
      registro: registro.entidad + (registro.registroId ? ` #${registro.registroId}` : ''),
      cambios: registro.cambios.length
        ? registro.cambios.map((c) => `${c.campo}: ${this.valor(c.anterior)} → ${this.valor(c.actual)}`).join(' | ')
        : '',
    }));

    exportarCsv(
      'bitacora.csv',
      [
        { clave: 'accion', etiqueta: 'Acción' },
        { clave: 'fecha', etiqueta: 'Fecha' },
        { clave: 'usuario', etiqueta: 'Usuario' },
        { clave: 'registro', etiqueta: 'Registro' },
        { clave: 'cambios', etiqueta: 'Cambios' },
      ],
      filas,
    );
  }

  valor(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') return '—';
    if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
    if (typeof valor === 'object') return JSON.stringify(valor);
    return String(valor);
  }

  fecha(valor: string): string {
    return new Date(valor).toLocaleString('es-MX');
  }
}
