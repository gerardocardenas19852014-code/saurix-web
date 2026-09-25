import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ValorListaGrupoBase } from '../../catalogos/valor-lista/valor-lista-grupo-base';

/** Pantalla propia (sin combo) para el grupo ValorLista "MovimientoPresupuestoTipo" — ver ValorListaGrupoBase. */
@Component({
  selector: 'app-tipo-movimiento-presupuesto',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../../catalogos/valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../../catalogos/valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TipoMovimientoPresupuestoComponent extends ValorListaGrupoBase {
  protected readonly grupo = 'MovimientoPresupuestoTipo';
  protected readonly tituloGrupo = 'Tipo de movimiento · Presupuesto Personal';
  protected readonly moduloBitacora = 'Catálogos / Tipo de movimiento (Presupuesto)';
  /** Límites de gasto, Reportes y Calendario de pagos comparan 'Ingreso'/'Gasto' tal cual. */
  protected readonly clavesProtegidas = ['Ingreso', 'Gasto'];
  protected override readonly soportaInactivos = true;
}
