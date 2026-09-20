import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { NivelJerarquicoConfig, NivelJerarquicoItem } from './nivel-jerarquico.model';

/**
 * Ventana genérica para un nivel de la jerarquía geográfica. Se reutiliza
 * para País, Estado, Municipio, Localidad, Colonia y Calle: cada uno se
 * registra en catalogos.routes.ts con su NivelJerarquicoConfig (ver
 * nivel-geografico.model.ts) en vez de tener un componente propio.
 */
@Component({
  selector: 'app-nivel-jerarquico',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ConfirmDialogComponent],
  templateUrl: './nivel-jerarquico.component.html',
  styleUrl: './nivel-jerarquico.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NivelJerarquicoComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly location = inject(Location);

  protected nivel!: NivelJerarquicoConfig;
  protected padreId: number | null = null;

  protected readonly items = signal<NivelJerarquicoItem[]>([]);
  protected readonly cargando = signal(false);
  protected readonly padreNombre = signal<string | null>(null);

  protected readonly modalAbierto = signal(false);
  protected readonly itemEnEdicion = signal<NivelJerarquicoItem | null>(null);
  protected readonly itemAEliminar = signal<NivelJerarquicoItem | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
  });

  ngOnInit(): void {
    this.nivel = this.route.snapshot.data['nivel'] as NivelJerarquicoConfig;
    const param = this.route.snapshot.paramMap.get('padreId');
    this.padreId = param ? Number(param) : null;

    if (this.padreId !== null && this.nivel.entidadPadre) {
      this.data
        .getById<{ nombre: string }>(this.nivel.entidadPadre, this.padreId)
        .subscribe((padre) => this.padreNombre.set(padre.nombre));
    }

    this.cargar();
  }

  volver(): void {
    this.location.back();
  }

  rutaSiguiente(item: NivelJerarquicoItem): string {
    return `${this.nivel.siguienteRutaBase}/${item.id}/${this.nivel.siguienteSegmento}`;
  }

  cargar(): void {
    this.cargando.set(true);
    const filtro: Record<string, unknown> = {};
    if (this.nivel.campoPadre && this.padreId !== null) {
      filtro[this.nivel.campoPadre] = this.padreId;
    }
    this.data.list<NivelJerarquicoItem>(this.nivel.entidad, filtro).subscribe({
      next: (items) => {
        this.items.set(items);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    this.itemEnEdicion.set(null);
    this.form.reset({ id: 0, nombre: '' });
    this.modalAbierto.set(true);
  }

  editar(item: NivelJerarquicoItem): void {
    this.itemEnEdicion.set(item);
    this.form.reset({ id: item.id, nombre: item.nombre });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const enEdicion = this.itemEnEdicion();
    const valor: Record<string, unknown> = { ...this.form.getRawValue(), activo: enEdicion?.activo ?? true };
    if (this.nivel.campoPadre && this.padreId !== null) {
      valor[this.nivel.campoPadre] = this.padreId;
    }

    const esEdicion = enEdicion !== null;
    const peticion = esEdicion
      ? this.data.modificacion<NivelJerarquicoItem>(this.nivel.entidad, valor as NivelJerarquicoItem)
      : this.data.alta<NivelJerarquicoItem>(this.nivel.entidad, valor);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? `${this.nivel.tituloSingular} actualizado.` : `${this.nivel.tituloSingular} creado.`);
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(item: NivelJerarquicoItem): void {
    this.itemAEliminar.set(item);
  }

  confirmarEliminar(): void {
    const item = this.itemAEliminar();
    if (!item) return;

    this.data.baja(this.nivel.entidad, item.id).subscribe({
      next: () => {
        this.toast.exito(`${this.nivel.tituloSingular} eliminado.`);
        this.itemAEliminar.set(null);
        this.cargar();
      },
    });
  }
}
