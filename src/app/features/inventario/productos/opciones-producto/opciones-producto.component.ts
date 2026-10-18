import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../../core/services/data-client.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { Producto } from '../producto.model';
import {
  ProductoOpcionGrupo,
  ProductoOpcionValor,
  TIPOS_SELECCION_OPCION,
  TipoSeleccionOpcion,
} from '../producto-opcion.model';

/** Un grupo con sus valores ya anidados — solo para pintar la pantalla;
 *  en la base siguen siendo 2 tablas aparte (ver producto-opcion.model.ts). */
interface GrupoConValores extends ProductoOpcionGrupo {
  valores: ProductoOpcionValor[];
}

/**
 * Inventario → Productos → "Opciones" (variantes con costo, al estilo
 * combo de cine) — mismo patrón de pantalla ruteada que
 * nivel-minimo-bodega.component.ts, pero con alta/edición/baja inmediata
 * por fila (como Módulos de empresa en empresas.component.ts) en vez de
 * guardado en bloque, porque aquí la cantidad de filas es variable
 * (agregar/quitar grupos y valores), no una lista fija de bodegas.
 *
 * Solo tiene sentido si la empresa va a usar /tienda — si no, un producto
 * sin ningún grupo se vende igual que siempre (sin variantes).
 */
@Component({
  selector: 'app-opciones-producto',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent],
  templateUrl: './opciones-producto.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpcionesProductoComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(DataClientService);
  private readonly location = inject(Location);
  private readonly fb = inject(FormBuilder);
  protected readonly toast = inject(ToastService);

  protected readonly tiposSeleccion = TIPOS_SELECCION_OPCION;

  private productoId!: number;
  protected readonly producto = signal<Producto | null>(null);
  protected readonly grupos = signal<GrupoConValores[]>([]);
  protected readonly cargando = signal(false);

  protected readonly modalGrupoAbierto = signal(false);
  protected readonly grupoEnEdicion = signal<ProductoOpcionGrupo | null>(null);
  protected readonly grupoAEliminar = signal<ProductoOpcionGrupo | null>(null);

  protected readonly modalValorAbierto = signal(false);
  protected readonly grupoDelValor = signal<GrupoConValores | null>(null);
  protected readonly valorEnEdicion = signal<ProductoOpcionValor | null>(null);
  protected readonly valorAEliminar = signal<ProductoOpcionValor | null>(null);

  protected readonly formGrupo = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.maxLength(60)]],
    tipoSeleccion: ['unica' as TipoSeleccionOpcion, Validators.required],
    requerido: [true],
    minimo: [1, [Validators.min(0)]],
    maximo: [1, [Validators.min(1)]],
  });

  protected readonly formValor = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.maxLength(60)]],
    precioAdicional: [0, [Validators.required]],
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    this.productoId = Number(this.route.snapshot.paramMap.get('id'));
    this.data.getById<Producto>('Producto', this.productoId).subscribe((p) => this.producto.set(p));
    this.cargar();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  volver(): void {
    this.location.back();
  }

  cargar(): void {
    this.cargando.set(true);
    Promise.all([
      firstValueFrom(this.data.list<ProductoOpcionGrupo>('ProductoOpcionGrupo', { productoId: this.productoId })),
      firstValueFrom(this.data.list<ProductoOpcionValor>('ProductoOpcionValor')),
    ]).then(([grupos, valores]) => {
      const porGrupo: GrupoConValores[] = grupos
        .filter((g) => g.activo !== false)
        .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
        .map((g) => ({
          ...g,
          valores: valores
            .filter((v) => v.grupoId === g.id && v.activo !== false)
            .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)),
        }));
      this.grupos.set(porGrupo);
      this.cargando.set(false);
    });
  }

  // ── Grupos ────────────────────────────────────────────────────────
  nuevoGrupo(): void {
    this.grupoEnEdicion.set(null);
    this.formGrupo.reset({ nombre: '', tipoSeleccion: 'unica', requerido: true, minimo: 1, maximo: 1 });
    this.modalGrupoAbierto.set(true);
  }

  editarGrupo(grupo: ProductoOpcionGrupo): void {
    this.grupoEnEdicion.set(grupo);
    this.formGrupo.reset({
      nombre: grupo.nombre,
      tipoSeleccion: grupo.tipoSeleccion,
      requerido: grupo.requerido,
      minimo: grupo.minimo,
      maximo: grupo.maximo,
    });
    this.modalGrupoAbierto.set(true);
  }

  guardarGrupo(): void {
    if (this.formGrupo.invalid) {
      this.formGrupo.markAllAsTouched();
      this.toast.error('Nombre del grupo obligatorio.');
      return;
    }
    const v = this.formGrupo.getRawValue();
    const edicion = this.grupoEnEdicion();
    const dto = {
      nombre: v.nombre.trim(),
      tipoSeleccion: v.tipoSeleccion,
      requerido: v.requerido,
      minimo: v.tipoSeleccion === 'multiple' ? v.minimo : 1,
      maximo: v.tipoSeleccion === 'multiple' ? v.maximo : 1,
    };
    const peticion = edicion
      ? this.data.modificacion<ProductoOpcionGrupo>('ProductoOpcionGrupo', { id: edicion.id, ...dto })
      : this.data.alta<ProductoOpcionGrupo>('ProductoOpcionGrupo', {
          ...dto,
          productoId: this.productoId,
          orden: this.grupos().length,
        });
    peticion.subscribe({
      next: () => {
        this.modalGrupoAbierto.set(false);
        this.toast.exito(edicion ? 'Grupo actualizado.' : 'Grupo creado.');
        this.cargar();
      },
    });
  }

  pedirEliminarGrupo(grupo: ProductoOpcionGrupo): void {
    this.grupoAEliminar.set(grupo);
  }

  confirmarEliminarGrupo(): void {
    const grupo = this.grupoAEliminar();
    if (!grupo) return;
    this.grupoAEliminar.set(null);
    this.data.baja('ProductoOpcionGrupo', grupo.id).subscribe({
      next: () => {
        this.toast.exito('Grupo eliminado (y sus valores).');
        this.cargar();
      },
    });
  }

  // ── Valores ───────────────────────────────────────────────────────
  nuevoValor(grupo: GrupoConValores): void {
    this.grupoDelValor.set(grupo);
    this.valorEnEdicion.set(null);
    this.formValor.reset({ nombre: '', precioAdicional: 0 });
    this.modalValorAbierto.set(true);
  }

  editarValor(grupo: GrupoConValores, valor: ProductoOpcionValor): void {
    this.grupoDelValor.set(grupo);
    this.valorEnEdicion.set(valor);
    this.formValor.reset({ nombre: valor.nombre, precioAdicional: valor.precioAdicional });
    this.modalValorAbierto.set(true);
  }

  guardarValor(): void {
    const grupo = this.grupoDelValor();
    if (!grupo || this.formValor.invalid) {
      this.formValor.markAllAsTouched();
      this.toast.error('Nombre del valor obligatorio.');
      return;
    }
    const v = this.formValor.getRawValue();
    const edicion = this.valorEnEdicion();
    const peticion = edicion
      ? this.data.modificacion<ProductoOpcionValor>('ProductoOpcionValor', {
          id: edicion.id,
          nombre: v.nombre.trim(),
          precioAdicional: v.precioAdicional,
        })
      : this.data.alta<ProductoOpcionValor>('ProductoOpcionValor', {
          grupoId: grupo.id,
          nombre: v.nombre.trim(),
          precioAdicional: v.precioAdicional,
          orden: grupo.valores.length,
        });
    peticion.subscribe({
      next: () => {
        this.modalValorAbierto.set(false);
        this.toast.exito(edicion ? 'Valor actualizado.' : 'Valor agregado.');
        this.cargar();
      },
    });
  }

  pedirEliminarValor(valor: ProductoOpcionValor): void {
    this.valorAEliminar.set(valor);
  }

  confirmarEliminarValor(): void {
    const valor = this.valorAEliminar();
    if (!valor) return;
    this.valorAEliminar.set(null);
    this.data.baja('ProductoOpcionValor', valor.id).subscribe({
      next: () => {
        this.toast.exito('Valor eliminado.');
        this.cargar();
      },
    });
  }
}
