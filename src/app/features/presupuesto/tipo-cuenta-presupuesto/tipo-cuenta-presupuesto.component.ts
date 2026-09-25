import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ValorListaGrupoBase } from '../../catalogos/valor-lista/valor-lista-grupo-base';

/** Pantalla propia (sin combo) para el grupo ValorLista "CuentaPresupuestoTipo" — ver ValorListaGrupoBase. */
@Component({
  selector: 'app-tipo-cuenta-presupuesto',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../../catalogos/valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../../catalogos/valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TipoCuentaPresupuestoComponent extends ValorListaGrupoBase {
  protected readonly grupo = 'CuentaPresupuestoTipo';
  protected readonly tituloGrupo = 'Tipo de cuenta · Presupuesto Personal';
  protected readonly moduloBitacora = 'Catálogos / Tipo de cuenta (Presupuesto)';
  /** Efectivo/Banco/Tarjeta/Ahorro: CuentaPresupuesto.tipo + wallet.util (iconoTipoCuenta) y Calendario/Dashboard comparan 'Tarjeta' tal cual. */
  protected readonly clavesProtegidas = ['Efectivo', 'Banco', 'Tarjeta', 'Ahorro'];
  protected override readonly soportaInactivos = true;
}
