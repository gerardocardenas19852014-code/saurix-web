import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { AdjuntosPanelComponent } from '../../../shared/components/adjuntos-panel/adjuntos-panel.component';
import { ToastService } from '../../../shared/services/toast.service';
import { CategoriaPresupuesto } from '../../catalogos/categoria-presupuesto/categoria-presupuesto.model';
import { CuentaPresupuesto } from '../../catalogos/cuenta-presupuesto/cuenta-presupuesto.model';
import { MovimientoPresupuesto } from '../movimientos/movimiento.model';
import { ValorLista } from '../../catalogos/valor-lista/valor-lista.model';
import { MovimientoRecurrentePresupuesto } from './recurrente.model';

/**
 * "Fijos y Proyección": gastos/ingresos recurrentes (renta, nómina,
 * suscripciones, etc.). Cada fijo muestra el estado de su ciclo actual
 * (Registrado / Pendiente / Próximo) y permite "Registrar este ciclo" para
 * generar de un clic el MovimientoPresupuesto correspondiente, ligado de
 * vuelta al fijo vía origenRecurrenteId. Si el ciclo ya venció sin
 * registrarse se avisa una sola vez por ciclo (avisoFaltanteCiclo).
 */
@Component({
  selector: 'app-recurrentes',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, AdjuntosPanelComponent],
  templateUrl: './recurrentes.component.html',
  styleUrl: './recurrentes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecurrentesComponent implements OnInit {
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  protected readonly recurrentes = signal<MovimientoRecurrentePresupuesto[]>([]);
  protected readonly movimientosOrigen = signal<MovimientoPresupuesto[]>([]);
  protected readonly cuentas = signal<CuentaPresupuesto[]>([]);
  protected readonly categorias = signal<CategoriaPresupuesto[]>([]);
  protected readonly tiposMovimiento = signal<ValorLista[]>([]);
  protected readonly frecuencias = signal<ValorLista[]>([]);
  protected readonly cargando = signal(false);

  protected readonly modalAbierto = signal(false);
  protected readonly enEdicion = signal<MovimientoRecurrentePresupuesto | null>(null);
  protected readonly aEliminar = signal<MovimientoRecurrentePresupuesto | null>(null);

  protected readonly columnas: ColumnaTabla<MovimientoRecurrentePresupuesto>[] = [
    { campo: 'descripcion', etiqueta: 'Descripción' },
    { campo: 'tipo', etiqueta: 'Tipo', claseValor: (fila) => (fila.tipo === 'Ingreso' ? 'grid-badge-success' : 'grid-badge-danger') },
    { campo: 'monto', etiqueta: 'Monto', formatear: (fila) => this.formatMoneda(fila.monto) },
    {
      campo: 'frecuencia',
      etiqueta: 'Frecuencia',
      formatear: (fila) => `${fila.frecuencia} · día ${fila.diaDelMes}${fila.frecuencia === 'Anual' ? ' de ' + this.nombreMesAncla(fila) : ''}`,
    },
    {
      campo: 'diaDelMes',
      etiqueta: 'Ciclo actual',
      formatear: (fila) => this.etiquetaEstadoCiclo(fila),
      claseValor: (fila) => this.claseEstadoCiclo(fila),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    descripcion: ['', Validators.required],
    tipo: ['Gasto' as string, Validators.required],
    cuentaPresupuestoId: [0, Validators.required],
    categoriaPresupuestoId: [0],
    monto: [0, [Validators.required, Validators.min(0.01)]],
    frecuencia: ['Mensual' as string, Validators.required],
    diaDelMes: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
  });

  private get usuarioActualId(): number {
    return this.auth.usuarioActual()?.id ?? 0;
  }

  /** Tipo actual del formulario como signal (para filtrar Categoría reactivamente sin duplicar estado). */
  private readonly tipoFormulario = toSignal(this.form.controls.tipo.valueChanges, {
    initialValue: this.form.controls.tipo.value,
  });

  /** Solo categorías del mismo Tipo (o sin Tipo definido — catálogo previo a este campo). */
  protected readonly categoriasFiltradas = computed(() => {
    const tipo = this.tipoFormulario();
    return this.categorias().filter((c) => !c.tipo || c.tipo === tipo);
  });

  /** Si al cambiar Tipo la categoría ya elegida deja de aplicar, se limpia (evita guardar una combinación inconsistente). */
  onTipoChange(): void {
    const tipo = this.form.controls.tipo.value;
    const categoriaId = this.form.controls.categoriaPresupuestoId.value;
    const categoria = this.categorias().find((c) => Number(c.id) === Number(categoriaId));
    if (categoria?.tipo && categoria.tipo !== tipo) {
      this.form.controls.categoriaPresupuestoId.setValue(0);
    }
  }

  ngOnInit(): void {
    this.data.list<CuentaPresupuesto>('CuentaPresupuesto').subscribe((c) => this.cuentas.set(c));
    this.data.list<CategoriaPresupuesto>('CategoriaPresupuesto').subscribe((c) => this.categorias.set(c));
    this.data.list<ValorLista>('ValorLista', { grupo: 'MovimientoPresupuestoTipo' }).subscribe((v) =>
      this.tiposMovimiento.set(
        v.filter((x) => x.grupo === 'MovimientoPresupuestoTipo').sort((a, b) => a.orden - b.orden),
      ),
    );
    this.data.list<ValorLista>('ValorLista', { grupo: 'MovimientoRecurrenteFrecuencia' }).subscribe((v) =>
      this.frecuencias.set(
        v.filter((x) => x.grupo === 'MovimientoRecurrenteFrecuencia').sort((a, b) => a.orden - b.orden),
      ),
    );
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data
      .list<MovimientoRecurrentePresupuesto>('MovimientoRecurrentePresupuesto', { creadoPorUsuarioId: this.usuarioActualId })
      .subscribe({
        next: (r) => {
          this.recurrentes.set(r);
          this.cargando.set(false);
          this.data
            .list<MovimientoPresupuesto>('MovimientoPresupuesto', { creadoPorUsuarioId: this.usuarioActualId })
            .subscribe((movimientos) => {
              this.movimientosOrigen.set(movimientos.filter((m) => m.origenRecurrenteId !== null));
              this.avisarPendientes();
            });
        },
        error: () => this.cargando.set(false),
      });
  }

  formatMoneda(valor: number): string {
    return '$' + valor.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Mes (nombre corto) que ancla el ciclo de un fijo Anual: el mes en que se creó. */
  private mesAncla(fila: MovimientoRecurrentePresupuesto): number {
    return fila.fechaCreacion ? new Date(fila.fechaCreacion).getMonth() : new Date().getMonth();
  }

  protected nombreMesAncla(fila: MovimientoRecurrentePresupuesto): string {
    return new Date(2000, this.mesAncla(fila), 1).toLocaleDateString('es-MX', { month: 'long' });
  }

  private cicloActual(fila: MovimientoRecurrentePresupuesto): string {
    const hoy = new Date();
    return fila.frecuencia === 'Mensual' ? `${hoy.getFullYear()}-${hoy.getMonth() + 1}` : `${hoy.getFullYear()}`;
  }

  private cicloDeFecha(fecha: string, frecuencia: string): string {
    const f = new Date(fecha);
    return frecuencia === 'Mensual' ? `${f.getFullYear()}-${f.getMonth() + 1}` : `${f.getFullYear()}`;
  }

  protected estaRegistradoEsteCiclo(fila: MovimientoRecurrentePresupuesto): boolean {
    const ciclo = this.cicloActual(fila);
    return this.movimientosOrigen().some(
      (m) => Number(m.origenRecurrenteId) === Number(fila.id) && this.cicloDeFecha(m.fecha, fila.frecuencia) === ciclo,
    );
  }

  protected estadoCiclo(fila: MovimientoRecurrentePresupuesto): 'registrado' | 'pendiente' | 'proximo' {
    if (this.estaRegistradoEsteCiclo(fila)) return 'registrado';
    const hoy = new Date();
    if (fila.frecuencia === 'Anual' && hoy.getMonth() !== this.mesAncla(fila)) return 'proximo';
    return hoy.getDate() >= fila.diaDelMes ? 'pendiente' : 'proximo';
  }

  private etiquetaEstadoCiclo(fila: MovimientoRecurrentePresupuesto): string {
    switch (this.estadoCiclo(fila)) {
      case 'registrado':
        return '✓ Registrado';
      case 'pendiente':
        return '⚠ Pendiente';
      default:
        return '· Próximo';
    }
  }

  private claseEstadoCiclo(fila: MovimientoRecurrentePresupuesto): string {
    switch (this.estadoCiclo(fila)) {
      case 'registrado':
        return 'grid-badge-success';
      case 'pendiente':
        return 'grid-badge-warning';
      default:
        return 'grid-badge-muted';
    }
  }

  /** Avisa (una sola vez por ciclo) los fijos que quedaron pendientes, y guarda el ciclo avisado. */
  private avisarPendientes(): void {
    for (const fila of this.recurrentes()) {
      if (this.estadoCiclo(fila) !== 'pendiente') continue;
      const ciclo = this.cicloActual(fila);
      if (fila.avisoFaltanteCiclo === ciclo) continue;
      this.toast.advertencia(`Fijo sin registrar este ciclo: "${fila.descripcion}".`);
      this.data.modificacion<MovimientoRecurrentePresupuesto>('MovimientoRecurrentePresupuesto', { ...fila, avisoFaltanteCiclo: ciclo }).subscribe({
        next: (actualizado) => {
          this.recurrentes.update((lista) => lista.map((r) => (r.id === actualizado.id ? actualizado : r)));
        },
      });
    }
  }

  /** Genera el MovimientoPresupuesto de este ciclo a partir del fijo (botón "Registrar este ciclo"). */
  registrarCiclo(fila: MovimientoRecurrentePresupuesto): void {
    if (this.estaRegistradoEsteCiclo(fila)) {
      this.toast.info('Este ciclo ya fue registrado.');
      return;
    }
    const hoy = new Date();
    const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(fila.diaDelMes, ultimoDiaMes)).toISOString().slice(0, 10);
    const payload = {
      fecha,
      tipo: fila.tipo,
      cuentaPresupuestoId: Number(fila.cuentaPresupuestoId),
      categoriaPresupuestoId: fila.categoriaPresupuestoId ? Number(fila.categoriaPresupuestoId) : null,
      monto: fila.monto,
      descripcion: fila.descripcion,
      transferenciaId: null,
      origenRecurrenteId: fila.id,
      creadoPorUsuarioId: this.usuarioActualId,
    };
    this.data.alta<MovimientoPresupuesto>('MovimientoPresupuesto', payload).subscribe({
      next: () => {
        this.toast.exito('Movimiento registrado para este ciclo.');
        this.cargar();
      },
    });
  }

  nuevo(): void {
    this.enEdicion.set(null);
    this.form.reset({ id: 0, descripcion: '', tipo: 'Gasto', cuentaPresupuestoId: 0, categoriaPresupuestoId: 0, monto: 0, frecuencia: 'Mensual', diaDelMes: 1 });
    this.modalAbierto.set(true);
  }

  editar(item: MovimientoRecurrentePresupuesto): void {
    this.enEdicion.set(item);
    this.form.reset({
      id: item.id,
      descripcion: item.descripcion,
      tipo: item.tipo,
      cuentaPresupuestoId: Number(item.cuentaPresupuestoId),
      categoriaPresupuestoId: item.categoriaPresupuestoId ? Number(item.categoriaPresupuestoId) : 0,
      monto: item.monto,
      frecuencia: item.frecuencia,
      diaDelMes: item.diaDelMes,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valor = this.form.getRawValue();
    const esEdicion = this.enEdicion() !== null;
    const payload = {
      ...valor,
      cuentaPresupuestoId: Number(valor.cuentaPresupuestoId),
      categoriaPresupuestoId: valor.categoriaPresupuestoId ? Number(valor.categoriaPresupuestoId) : null,
      creadoPorUsuarioId: this.usuarioActualId,
      avisoFaltanteCiclo: this.enEdicion()?.avisoFaltanteCiclo ?? null,
    };
    const peticion = esEdicion
      ? this.data.modificacion<MovimientoRecurrentePresupuesto>('MovimientoRecurrentePresupuesto', payload)
      : this.data.alta<MovimientoRecurrentePresupuesto>('MovimientoRecurrentePresupuesto', payload);
    peticion.subscribe({
      next: (resultado) => {
        this.toast.exito(esEdicion ? 'Fijo actualizado.' : 'Fijo creado.');
        this.enEdicion.set(resultado);
        this.cargar();
        if (!esEdicion) this.modalAbierto.set(false);
      },
    });
  }

  pedirEliminar(item: MovimientoRecurrentePresupuesto): void {
    this.aEliminar.set(item);
  }

  confirmarEliminar(): void {
    const item = this.aEliminar();
    if (!item) return;
    this.data.baja('MovimientoRecurrentePresupuesto', item.id).subscribe({
      next: () => {
        this.toast.exito('Fijo eliminado.');
        this.aEliminar.set(null);
        if (this.enEdicion()?.id === item.id) this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }
}
