import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ValorListaGrupoBase } from '../../../shared/valor-lista/valor-lista-grupo-base';

/**
 * Pantalla propia (sin combo) para el grupo ValorLista "FamiliaProveedorSalud"
 * — mismo patrón que Parentesco (ver parentesco.component.ts).
 *
 * Decisión de alcance: en vez de una entidad propia con nombre/especialidad/
 * teléfono/dirección como campos separados, se reutiliza ValorLista tal
 * cual (clave + una sola "etiqueta" de texto libre, p.ej. "Dr. Pérez —
 * Pediatría — 555-1234"). Así se obtiene CRUD, orden, protección y
 * bitácora gratis, sin una pantalla ni un modelo nuevos — el mismo criterio
 * que ya se usó para el "tipo" de Pólizas (ver poliza-seguro-miembro.model.ts).
 * Se usa luego como un <select> en la cita médica para no repetir el
 * nombre del lugar cada vez (ver miembros.component.html → "Lugar").
 */
@Component({
  selector: 'app-proveedor-salud',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../../../shared/valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../../../shared/valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedorSaludComponent extends ValorListaGrupoBase implements OnInit, OnDestroy {
  protected readonly grupo = 'FamiliaProveedorSalud';
  protected readonly tituloGrupo = 'Proveedores de salud · Familia';
  protected readonly moduloBitacora = 'Catálogos / Proveedores de salud (Familia)';
  protected readonly clavesProtegidas: string[] = [];
  protected override readonly soportaInactivos = true;

  override ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    super.ngOnInit();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}
