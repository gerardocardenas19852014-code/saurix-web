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
  /** El cálculo de ciclo de Fijos y Proyección/Calendario compara 'Mensual'/'Anual' tal cual. */
  protected readonly clavesProtegidas = ['Mensual', 'Anual'];
}
