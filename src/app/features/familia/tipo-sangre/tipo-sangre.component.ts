import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ValorListaGrupoBase } from '../../../shared/valor-lista/valor-lista-grupo-base';
import { obtenerOSembrarValorLista } from '../familia.util';
import { GRUPO_TIPO_SANGRE, SEMILLA_TIPO_SANGRE } from '../miembro-familia.model';

/** Pantalla propia (sin combo) para el grupo ValorLista "FamiliaTipoSangre" — ver ValorListaGrupoBase.
 *  Sin claves protegidas: a diferencia de Sexo/Entidad de nacimiento, el tipo de sangre no lo usa
 *  ningún cálculo, así que el usuario puede agregar/quitar/renombrar libremente. Solo se siembra
 *  con los 8 tipos de fábrica la primera vez que el catálogo está vacío. */
@Component({
  selector: 'app-tipo-sangre',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../../../shared/valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../../../shared/valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TipoSangreComponent extends ValorListaGrupoBase implements OnInit, OnDestroy {
  protected readonly grupo = GRUPO_TIPO_SANGRE;
  protected readonly tituloGrupo = 'Tipo de sangre · Familia';
  protected readonly moduloBitacora = 'Catálogos / Tipo de sangre (Familia)';
  protected readonly clavesProtegidas: string[] = [];
  protected override readonly soportaInactivos = true;

  override ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    super.ngOnInit();
  }

  override cargar(): void {
    this.cargando.set(true);
    obtenerOSembrarValorLista(this.data, this.grupo, SEMILLA_TIPO_SANGRE).subscribe({
      next: (registros) => {
        this.registros.set([...registros].sort((a, b) => a.orden - b.orden));
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}
