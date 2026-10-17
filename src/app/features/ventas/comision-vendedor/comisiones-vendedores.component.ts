import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Usuario, nombreCompletoUsuario } from '../../seguridad/usuarios/usuario.model';
import { ComisionVendedor, TipoComisionVendedor } from './comision-vendedor.model';
import { ComisionVendedorService } from './comision-vendedor.service';

interface FilaVendedor {
  /** Mismo id del Usuario — DataTableComponent exige id:number por fila. */
  id: number;
  usuario: Usuario;
  comision: ComisionVendedor | null;
}

/** Config de comisión por vendedor (% o monto fijo por venta) — ver
 *  ComisionVendedor.model.ts. Solo configura el porcentaje/monto; el
 *  cálculo real por periodo está en ReporteComisionesComponent. */
@Component({
  selector: 'app-comisiones-vendedores',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent],
  templateUrl: './comisiones-vendedores.component.html',
  styleUrl: './comisiones-vendedores.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComisionesVendedoresComponent implements OnInit, OnDestroy {
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly comisionService = inject(ComisionVendedorService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);

  protected readonly cargando = signal(true);
  protected readonly usuarios = signal<Usuario[]>([]);
  protected readonly comisiones = signal<ComisionVendedor[]>([]);

  protected readonly filas = computed<FilaVendedor[]>(() =>
    this.usuarios()
      .filter((u) => u.activo !== false)
      .map((usuario) => ({
        id: usuario.id,
        usuario,
        comision: this.comisiones().find((c) => c.usuarioId === usuario.id) ?? null,
      })),
  );

  protected readonly columnas: ColumnaTabla<FilaVendedor>[] = [
    { campo: 'usuario', etiqueta: 'Vendedor', formatear: (f) => nombreCompletoUsuario(f.usuario) },
    {
      campo: 'comision',
      etiqueta: 'Comisión configurada',
      formatear: (f) =>
        f.comision
          ? f.comision.tipo === 'Porcentaje'
            ? `${f.comision.valor}%`
            : `$${f.comision.valor.toFixed(2)} por venta`
          : 'Sin comisión',
    },
  ];

  protected readonly filaEditando = signal<FilaVendedor | null>(null);
  protected readonly guardando = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    tipo: ['Porcentaje' as TipoComisionVendedor, Validators.required],
    valor: [0, [Validators.required, Validators.min(0)]],
  });

  async ngOnInit(): Promise<void> {
    document.documentElement.setAttribute('data-wide', 'grid');
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    const [usuarios, comisiones] = await Promise.all([
      firstValueFrom(this.data.list<Usuario>('Usuario')),
      this.comisionService.listar(),
    ]);
    this.usuarios.set(usuarios);
    this.comisiones.set(comisiones);
    this.cargando.set(false);
  }

  abrirEditar(fila: FilaVendedor): void {
    this.filaEditando.set(fila);
    this.form.reset({ tipo: fila.comision?.tipo ?? 'Porcentaje', valor: fila.comision?.valor ?? 0 });
  }

  cerrarEditar(): void {
    this.filaEditando.set(null);
  }

  async guardar(): Promise<void> {
    const fila = this.filaEditando();
    if (!fila || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valor = this.form.getRawValue();
    this.guardando.set(true);
    try {
      await this.comisionService.guardar(fila.usuario.id, valor.tipo, valor.valor);
      this.toast.exito('Comisión guardada.');
      this.cerrarEditar();
      await this.cargar();
    } finally {
      this.guardando.set(false);
    }
  }
}
