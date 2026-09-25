import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { CuentaPresupuesto } from '../cuenta-presupuesto/cuenta-presupuesto.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { fechaLocalDeTexto, formatMoneda } from '../shared/wallet.util';
import { MetaPresupuesto, MetaPresupuestoAporte } from './meta.model';

/** Metas de ahorro — seguimiento manual (el usuario aporta y montoActual sube),
 *  con historial de aportes (MetaPresupuestoAporte) para saber cuándo se
 *  aportó cada uno, poder deshacer uno específico, y opcionalmente ligarlo a
 *  una cuenta real — mismo patrón ya usado en Deudas/DeudaPresupuestoAbono. */
@Component({
  selector: 'app-metas',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent, DatePipe, DecimalPipe],
  templateUrl: './metas.component.html',
  styleUrl: './metas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetasComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  protected readonly formatMoneda = formatMoneda;

  protected readonly metas = signal<MetaPresupuesto[]>([]);
  protected readonly aportes = signal<MetaPresupuestoAporte[]>([]);
  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);
  protected readonly cargando = signal(false);
  protected readonly modalAbierto = signal(false);
  protected readonly enEdicion = signal<MetaPresupuesto | null>(null);
  protected readonly aEliminar = signal<MetaPresupuesto | null>(null);
  protected readonly historialAbierto = signal<number | null>(null);

  /** Antes las metas cumplidas se quedaban mezcladas para siempre con las
   *  activas en la misma lista; ahora se ocultan por default (igual que en
   *  Deudas) y este checkbox las regresa. */
  protected readonly mostrarCumplidas = signal(false);

  protected readonly metasActivas = computed(() => this.metas().filter((m) => !this.cumplida(m)));
  protected readonly cantidadCumplidas = computed(() => this.metas().length - this.metasActivas().length);
  protected readonly metasVisibles = computed(() => (this.mostrarCumplidas() ? this.metas() : this.metasActivas()));

  /** Total ahorrado: a diferencia de Deudas (donde una liquidada ya no debe
   *  contar), aquí SÍ se suman también las metas cumplidas — el dinero
   *  ahorrado ahí sigue siendo dinero ahorrado. */
  protected readonly totalAhorrado = computed(() => this.metas().reduce((s, m) => s + m.montoActual, 0));

  protected readonly totalAportadoEsteMes = computed(() => {
    const hoy = new Date();
    // Filtra a aportes de metas que SIGUEN existiendo — evita que un aporte
    // huérfano (de una meta ya borrada) se cuele aquí, mismo caso que se
    // encontró en Deudas.
    const idsMetasExistentes = new Set(this.metas().map((m) => Number(m.id)));
    return this.aportes()
      .filter((a) => idsMetasExistentes.has(Number(a.metaPresupuestoId)))
      .filter((a) => {
        const f = fechaLocalDeTexto(a.fecha);
        return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
      })
      .reduce((s, a) => s + a.monto, 0);
  });

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    montoObjetivo: [0, [Validators.required, Validators.min(0.01)]],
    montoActual: [0, [Validators.required, Validators.min(0)]],
    fechaLimite: [new Date().toISOString().slice(0, 10), Validators.required],
  });

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
  }

  ngOnInit(): void {
    // Tarjetas con barra de progreso apiladas — usa el ancho "wide" del
    // layout para aprovechar mejor el espacio (ver html[data-wide='grid']
    // en styles.scss, mismo patrón que Movimientos).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.data.list<CuentaPresupuesto>('CuentaPresupuesto').subscribe((c) => this.cuentas.set(c));
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<MetaPresupuesto>('MetaPresupuesto', { creadoPorUsuarioId: this.usuarioActualId }).subscribe({
      next: (m) => {
        this.metas.set(m);
        this.cargando.set(false);
        this.data.list<MetaPresupuestoAporte>('MetaPresupuestoAporte', { creadoPorUsuarioId: this.usuarioActualId }).subscribe((a) => this.aportes.set(a));
      },
      error: () => this.cargando.set(false),
    });
  }

  /** Nombre de la cuenta de un aporte que sí se registró como Gasto real —
   *  para el historial (ver plantilla). '—' si esa cuenta ya no existe. */
  nombreCuenta(cuentaId: number | null | undefined): string {
    if (!cuentaId) return '—';
    return this.cuentas().find((c) => Number(c.id) === Number(cuentaId))?.nombre ?? '—';
  }

  aportesDe(metaId: number): MetaPresupuestoAporte[] {
    return this.aportes()
      .filter((a) => Number(a.metaPresupuestoId) === Number(metaId))
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }

  toggleHistorial(meta: MetaPresupuesto): void {
    this.historialAbierto.update((id) => (id === meta.id ? null : meta.id));
  }

  pctAhorrado(meta: MetaPresupuesto): number {
    if (meta.montoObjetivo <= 0) return 0;
    return Math.min((meta.montoActual / meta.montoObjetivo) * 100, 100);
  }

  cumplida(meta: MetaPresupuesto): boolean {
    return meta.montoActual >= meta.montoObjetivo;
  }

  diasRestantes(meta: MetaPresupuesto): number | null {
    if (!meta.fechaLimite) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const limite = new Date(meta.fechaLimite + 'T00:00:00');
    return Math.ceil((limite.getTime() - hoy.getTime()) / 86400000);
  }

  /** true = ya pasó la fecha límite y todavía no se cumple — para resaltarla
   *  distinto (barra roja + aviso) en vez de que se vea igual que una a tiempo. */
  atrasada(meta: MetaPresupuesto): boolean {
    const dias = this.diasRestantes(meta);
    return !this.cumplida(meta) && dias !== null && dias < 0;
  }

  /** Cuánto haría falta aportar cada mes, de aquí a la fecha límite, para
   *  llegar a tiempo — con lo que ya existe (objetivo, ahorrado, fecha
   *  límite) no hace falta ningún dato nuevo para calcularlo. null cuando no
   *  aplica: ya se cumplió, no tiene fecha límite, o ya venció (ahí lo que
   *  importa es que está atrasada, no "por mes").
   */
  aportacionMensualNecesaria(meta: MetaPresupuesto): number | null {
    if (this.cumplida(meta) || this.atrasada(meta)) return null;
    const dias = this.diasRestantes(meta);
    if (dias === null || dias <= 0) return null;
    const restante = meta.montoObjetivo - meta.montoActual;
    // Redondeado hacia arriba a meses completos (mínimo 1) para no inflar
    // el monto "mensual" cuando falta menos de un mes — ahí lo que hace
    // falta es, sencillamente, el restante completo.
    const meses = Math.max(Math.ceil(dias / 30.4368), 1);
    return restante / meses;
  }

  nuevo(): void {
    this.enEdicion.set(null);
    this.form.reset({ id: 0, nombre: '', montoObjetivo: 0, montoActual: 0, fechaLimite: new Date().toISOString().slice(0, 10) });
    this.modalAbierto.set(true);
  }

  editar(item: MetaPresupuesto): void {
    this.enEdicion.set(item);
    this.form.reset({ ...item, fechaLimite: item.fechaLimite?.slice(0, 10) });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valor = this.form.getRawValue();
    const esEdicion = this.enEdicion() !== null;
    const payload = { ...valor, creadoPorUsuarioId: this.usuarioActualId };
    const peticion = esEdicion
      ? this.data.modificacion<MetaPresupuesto>('MetaPresupuesto', payload)
      : this.data.alta<MetaPresupuesto>('MetaPresupuesto', payload);
    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Actualizada.' : 'Creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  /** cuentaIdTexto viene del <select> "Desde: <cuenta>" del aporte — "0" (o
   *  vacío) significa que este aporte NO debe afectar ninguna cuenta (el
   *  comportamiento de siempre). Si el usuario elige una cuenta, además se
   *  genera un Gasto real en Movimientos, igual que el "abonar" de Deudas. */
  aportar(meta: MetaPresupuesto, montoTexto: string, cuentaIdTexto: string): void {
    const monto = parseFloat(montoTexto);
    if (!monto || monto <= 0) {
      this.toast.advertencia('Escribe un monto válido para aportar.');
      return;
    }
    const cuentaId = Number(cuentaIdTexto) || 0;

    const registrarAporte = (movimientoPresupuestoId: number | null): void => {
      const aporte = {
        metaPresupuestoId: meta.id,
        fecha: new Date().toISOString().slice(0, 10),
        monto,
        nota: null,
        cuentaPresupuestoId: cuentaId || null,
        movimientoPresupuestoId,
        creadoPorUsuarioId: this.usuarioActualId,
      };
      this.data.alta<MetaPresupuestoAporte>('MetaPresupuestoAporte', aporte).subscribe({
        next: () => {
          const montoActual = meta.montoActual + monto;
          this.data.modificacion<MetaPresupuesto>('MetaPresupuesto', { ...meta, montoActual }).subscribe({
            next: () => {
              const sufijoCuenta = cuentaId ? ` desde ${this.nombreCuenta(cuentaId)}` : '';
              this.toast.exito(
                montoActual >= meta.montoObjetivo
                  ? `🎉 ¡Alcanzaste tu meta "${meta.nombre}"!`
                  : `Se agregaron ${this.formatMoneda(monto)}${sufijoCuenta}.`,
              );
              this.cargar();
            },
          });
        },
      });
    };

    if (!cuentaId) {
      registrarAporte(null);
      return;
    }

    const movimiento: Partial<MovimientoPresupuesto> = {
      fecha: new Date().toISOString().slice(0, 10),
      tipo: 'Gasto',
      cuentaPresupuestoId: cuentaId,
      categoriaPresupuestoId: null,
      monto,
      descripcion: `Aporte a meta "${meta.nombre}"`,
      transferenciaId: null,
      origenRecurrenteId: null,
      proyectado: false,
      creadoPorUsuarioId: this.usuarioActualId,
    };
    this.data.alta<MovimientoPresupuesto>('MovimientoPresupuesto', movimiento).subscribe({
      next: (creado) => registrarAporte(creado.id),
      error: () => this.toast.error('No se pudo registrar el gasto en la cuenta. Intenta de nuevo.'),
    });
  }

  eliminarAporte(aporte: MetaPresupuestoAporte, meta: MetaPresupuesto): void {
    this.data.baja('MetaPresupuestoAporte', aporte.id).subscribe({
      next: () => {
        // Si este aporte había generado un Gasto real en una cuenta, se
        // revierte también (best-effort: si ya no existe, no pasa nada).
        if (aporte.movimientoPresupuestoId) {
          this.data.baja('MovimientoPresupuesto', aporte.movimientoPresupuestoId).subscribe();
        }
        const montoActual = Math.max(meta.montoActual - aporte.monto, 0);
        this.data.modificacion<MetaPresupuesto>('MetaPresupuesto', { ...meta, montoActual }).subscribe({
          next: () => {
            this.toast.exito('Aporte eliminado.');
            this.cargar();
          },
        });
      },
    });
  }

  pedirEliminar(item: MetaPresupuesto): void {
    this.aEliminar.set(item);
  }

  confirmarEliminar(): void {
    const item = this.aEliminar();
    if (!item) return;

    const eliminarMeta = (): void => {
      this.data.baja('MetaPresupuesto', item.id).subscribe({
        next: () => {
          this.toast.exito('Eliminada.');
          this.aEliminar.set(null);
          this.cargar();
        },
      });
    };

    // El historial de aportes de esta meta no tiene sentido sin su padre —
    // se borra junto con ella para no dejar aportes huérfanos (mismo
    // problema encontrado y corregido en Deudas). Los Gastos reales que
    // algún aporte haya generado en una cuenta se CONSERVAN a propósito:
    // ese dinero ya salió de verdad.
    const aportesDeEsta = this.aportesDe(item.id);
    if (aportesDeEsta.length === 0) {
      eliminarMeta();
    } else {
      forkJoin(aportesDeEsta.map((a) => this.data.baja('MetaPresupuestoAporte', a.id))).subscribe({ next: eliminarMeta });
    }
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}
