import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ValorListaGrupoBase } from '../../../shared/valor-lista/valor-lista-grupo-base';

/** Pantalla propia (sin combo) para el grupo ValorLista "FamiliaParentesco" — ver ValorListaGrupoBase. */
@Component({
  selector: 'app-parentesco',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../../../shared/valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../../../shared/valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParentescoComponent extends ValorListaGrupoBase implements OnInit, OnDestroy {
  protected readonly grupo = 'FamiliaParentesco';
  protected readonly tituloGrupo = 'Parentesco · Familia';
  protected readonly moduloBitacora = 'Catálogos / Parentesco (Familia)';
  /** Claves iniciales que trae el catálogo de fábrica (ver seed más abajo) — no
   *  hay ninguna otra pantalla del sistema que las compare por nombre exacto,
   *  así que no se marcan como protegidas: el usuario puede borrarlas o
   *  renombrarlas libremente si su familia usa otros parentescos. */
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
