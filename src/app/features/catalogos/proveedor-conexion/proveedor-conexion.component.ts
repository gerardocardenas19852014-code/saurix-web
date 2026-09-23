import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ValorListaGrupoBase } from '../valor-lista/valor-lista-grupo-base';

/** Pantalla propia (sin combo) para el grupo ValorLista "ConfiguracionConexionProveedor" — ver ValorListaGrupoBase. */
@Component({
  selector: 'app-proveedor-conexion',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedorConexionComponent extends ValorListaGrupoBase {
  protected readonly grupo = 'ConfiguracionConexionProveedor';
  protected readonly tituloGrupo = 'Proveedor de conexión · Panel de Control';
  protected readonly moduloBitacora = 'Catálogos / Proveedor de conexión (Panel de Control)';
  protected readonly clavesProtegidas: string[] = [];
}
