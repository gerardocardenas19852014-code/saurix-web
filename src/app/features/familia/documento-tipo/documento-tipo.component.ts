import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ValorListaGrupoBase } from '../../../shared/valor-lista/valor-lista-grupo-base';

/** Pantalla propia (sin combo) para el grupo ValorLista "DocumentoFamiliaTipo" — ver ValorListaGrupoBase. */
@Component({
  selector: 'app-documento-tipo',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../../../shared/valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../../../shared/valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentoTipoComponent extends ValorListaGrupoBase implements OnInit, OnDestroy {
  protected readonly grupo = 'DocumentoFamiliaTipo';
  protected readonly tituloGrupo = 'Tipo de documento · Familia';
  protected readonly moduloBitacora = 'Catálogos / Tipo de documento (Familia)';
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
