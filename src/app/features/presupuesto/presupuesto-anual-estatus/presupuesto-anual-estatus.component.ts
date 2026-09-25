import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ValorListaGrupoBase } from '../../../shared/valor-lista/valor-lista-grupo-base';

/** Pantalla propia (sin combo) para el grupo ValorLista "PresupuestoAnualEstatus" — ver ValorListaGrupoBase. */
@Component({
  selector: 'app-presupuesto-anual-estatus',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../../../shared/valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../../../shared/valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresupuestoAnualEstatusComponent extends ValorListaGrupoBase implements OnInit, OnDestroy {
  protected readonly grupo = 'PresupuestoAnualEstatus';
  protected readonly tituloGrupo = 'Estatus de presupuesto anual · Presupuesto Personal';
  protected readonly moduloBitacora = 'Catálogos / Estatus de presupuesto anual';
  /** 'Autorizado' y 'Ejecutado' son las únicas claves que la Proyección
   * compara tal cual para bloquear la edición manual de ese año (ver
   * aniosBloqueados en proyeccion.component.ts) — 'Creacion'/'Proyeccion'
   * (o cualquier clave nueva) no las compara nadie, así que no hace falta
   * protegerlas. */
  protected readonly clavesProtegidas = ['Autorizado', 'Ejecutado'];
  protected override readonly soportaInactivos = true;
  /** Catálogo angosto (3-4 columnas) atrapado en el ancho de lectura de
   *  980px — usa el ancho "wide" del layout para aprovechar mejor el
   *  espacio (ver html[data-wide='grid'] en styles.scss, mismo patrón que
   *  Movimientos/Reportes/Calendario). */
  override ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    super.ngOnInit();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}
