import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { BitacoraComponent } from '../../../shared/components/bitacora/bitacora.component';
import { ValorListaGrupoBase } from '../../../shared/valor-lista/valor-lista-grupo-base';
import { obtenerOSembrarValorLista } from '../familia.util';
import { GRUPO_CATEGORIA_CONTACTO, SEMILLA_CATEGORIA_CONTACTO } from '../contacto-familiar.model';

@Component({
  selector: 'app-categoria-contacto',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, BitacoraComponent],
  templateUrl: '../../../shared/valor-lista/valor-lista-grupo.component.html',
  styleUrl: '../../../shared/valor-lista/valor-lista-grupo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriaContactoComponent extends ValorListaGrupoBase implements OnInit, OnDestroy {
  protected readonly grupo = GRUPO_CATEGORIA_CONTACTO;
  protected readonly tituloGrupo = 'Categoría de contacto · Familia';
  protected readonly moduloBitacora = 'Catálogos / Categoría de contacto (Familia)';
  protected readonly clavesProtegidas: string[] = [];
  protected override readonly soportaInactivos = true;

  override ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
    super.ngOnInit();
  }

  override cargar(): void {
    this.cargando.set(true);
    obtenerOSembrarValorLista(this.data, this.grupo, SEMILLA_CATEGORIA_CONTACTO).subscribe({
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
