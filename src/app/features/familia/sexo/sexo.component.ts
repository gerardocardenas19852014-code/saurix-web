import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { OPCIONES_SEXO } from '../../panel-control/rfc-curp/rfc-curp.util';
import { ValorListaGrupoBase } from '../../../shared/valor-lista/valor-lista-grupo-base';
import { obtenerOSembrarValorLista } from '../familia.util';
import { GRUPO_SEXO } from '../miembro-familia.model';

/** Pantalla propia (sin combo) para el grupo ValorLista "FamiliaSexo" — ver ValorListaGrupoBase.
 *  Se siembra de fábrica con OPCIONES_SEXO (las mismas claves 'H'/'M'/'X' que expone la
 *  librería "curp", ver rfc-curp.util.ts) y esas claves quedan protegidas: calcularRfcYCurp()
 *  las compara tal cual, así que borrarlas o renombrar su clave rompería el cálculo de CURP
 *  de los miembros que ya las tengan capturadas. El usuario sí puede cambiar la Etiqueta. */
@Component({
  selector: 'app-sexo',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../../../shared/valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../../../shared/valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SexoComponent extends ValorListaGrupoBase implements OnInit, OnDestroy {
  protected readonly grupo = GRUPO_SEXO;
  protected readonly tituloGrupo = 'Sexo · Familia';
  protected readonly moduloBitacora = 'Catálogos / Sexo (Familia)';
  protected readonly clavesProtegidas: string[] = OPCIONES_SEXO.map((o) => o.valor);

  override ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    super.ngOnInit();
  }

  override cargar(): void {
    this.cargando.set(true);
    const semilla = OPCIONES_SEXO.map((o) => ({ clave: o.valor, etiqueta: o.etiqueta }));
    obtenerOSembrarValorLista(this.data, this.grupo, semilla).subscribe({
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
