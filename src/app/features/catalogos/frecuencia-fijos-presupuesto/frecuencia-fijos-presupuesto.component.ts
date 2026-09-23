import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ValorListaGrupoBase } from '../valor-lista/valor-lista-grupo-base';

/** Pantalla propia (sin combo) para el grupo ValorLista "MovimientoRecurrenteFrecuencia" — ver ValorListaGrupoBase. */
@Component({
  selector: 'app-frecuencia-fijos-presupuesto',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FrecuenciaFijosPresupuestoComponent extends ValorListaGrupoBase {
  protected readonly grupo = 'MovimientoRecurrenteFrecuencia';
  protected readonly tituloGrupo = 'Frecuencia de fijos · Presupuesto Personal';
  protected readonly moduloBitacora = 'Catálogos / Frecuencia de fijos (Presupuesto)';
  /** 'Anual' es la única clave especial para Fijos y Proyección/Calendario/
   * Reportes (ciclo una vez al año, anclado al mes de creación del fijo);
   * cualquier otra clave — 'Mensual' o una nueva que se agregue aquí, p.ej.
   * 'Quincenal' — se trata con cadencia mensual (un ciclo por mes, el día
   * indicado clampado al último día de cada mes: funciona igual en meses de
   * 28, 30 o 31 días). Por eso solo 'Mensual'/'Anual' están protegidas: son
   * las únicas que ese código compara por nombre exacto. */
  protected readonly clavesProtegidas = ['Mensual', 'Anual'];
}
