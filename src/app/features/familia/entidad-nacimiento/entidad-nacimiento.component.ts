import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { OPCIONES_ENTIDAD } from '../../panel-control/rfc-curp/rfc-curp.util';
import { ValorListaGrupoBase } from '../../../shared/valor-lista/valor-lista-grupo-base';
import { obtenerOSembrarValorLista } from '../familia.util';
import { GRUPO_ENTIDAD_NACIMIENTO } from '../miembro-familia.model';

/** Pantalla propia (sin combo) para el grupo ValorLista "FamiliaEntidadNacimiento" — ver
 *  ValorListaGrupoBase. Se siembra de fábrica con OPCIONES_ENTIDAD (los 32 estados + "No
 *  Especificado", tal como los expone la librería "curp", ver rfc-curp.util.ts) y esas claves
 *  quedan protegidas: calcularRfcYCurp() las compara tal cual, así que borrarlas o renombrar
 *  su clave rompería el cálculo de CURP de los miembros que ya las tengan capturadas. El
 *  usuario sí puede cambiar la Etiqueta (p.ej. corregir un nombre de estado). */
@Component({
  selector: 'app-entidad-nacimiento',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../../../shared/valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../../../shared/valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntidadNacimientoComponent extends ValorListaGrupoBase implements OnInit, OnDestroy {
  protected readonly grupo = GRUPO_ENTIDAD_NACIMIENTO;
  protected readonly tituloGrupo = 'Entidad de nacimiento · Familia';
  protected readonly moduloBitacora = 'Catálogos / Entidad de nacimiento (Familia)';
  protected readonly clavesProtegidas: string[] = OPCIONES_ENTIDAD.map((o) => o.valor);

  override ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    super.ngOnInit();
  }

  override cargar(): void {
    this.cargando.set(true);
    const semilla = OPCIONES_ENTIDAD.map((o) => ({ clave: o.valor, etiqueta: o.etiqueta }));
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
