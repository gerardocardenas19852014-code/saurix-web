import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { DataClientService } from '../../core/services/data-client.service';
import { AdjuntosPanelComponent } from '../../shared/components/adjuntos-panel/adjuntos-panel.component';
import { ColumnaTabla, DataTableComponent } from '../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../shared/services/toast.service';
import { insertarEmbeds } from '../../shared/utils/embeds.util';
import { CategoriaOpcion, Documento, SeccionOpcion, TipoSistemaOpcion } from './documento.model';

interface Migaja {
  etiqueta: string;
  ruta?: string;
}

/**
 * Ventana de Documentos (WikiDocs). El filtro por Sección es opcional,
 * así que esta misma ventana sirve para:
 *  - /wikidocs/documentos → todos los documentos, sin filtrar.
 *  - /wikidocs/secciones/:seccionId/documentos → solo los de esa sección
 *    (llegando desde el drill-down de Secciones).
 *
 * Además del listado, esta ventana resuelve la vista de un documento
 * (contenido en Markdown renderizado con `marked` dentro de `.page-body`,
 * con enlaces de YouTube/Google Drive convertidos a embeds reales — igual
 * que el prototipo de referencia) y su edición, alternando entre Ver /
 * Editar / Adjuntos con `.tab-bar`, en vez de navegar a otra ruta.
 *
 * Para dar de alta un documento desde la vista "todos", el formulario pide
 * Tipo de sistema → Categoría → Sección en cascada real (3 selects, uno
 * por nivel de la jerarquía TipoSistema→Categoria→Seccion); el Id de la
 * Sección elegida es lo único que persiste en el Documento. Si ya se llegó
 * con una sección fija, todo este paso se omite.
 */
@Component({
  selector: 'app-documentos-list',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, DataTableComponent, ConfirmDialogComponent, AdjuntosPanelComponent],
  templateUrl: './documentos-list.component.html',
  styleUrl: './documentos-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentosListComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);

  protected seccionFijaId: number | null = null;
  protected seccionFijaNombre = '';

  protected readonly documentos = signal<Documento[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');

  protected readonly migajas = signal<Migaja[]>([]);

  protected readonly tiposSistema = signal<TipoSistemaOpcion[]>([]);
  protected readonly categorias = signal<CategoriaOpcion[]>([]);
  protected readonly secciones = signal<SeccionOpcion[]>([]);

  /** null = listado; 'ver'/'editar'/'adjuntos' = documento abierto en esa pestaña. */
  protected readonly vista = signal<'lista' | 'ver' | 'editar' | 'adjuntos'>('lista');
  protected readonly documentoActual = signal<Documento | null>(null);
  protected readonly documentoAEliminar = signal<Documento | null>(null);

  protected readonly esNuevo = computed(() => this.vista() !== 'lista' && this.documentoActual() === null);

  protected readonly columnas: ColumnaTabla<Documento>[] = [
    { campo: 'titulo', etiqueta: 'Título' },
    { campo: 'seccionId', etiqueta: 'Sección Id' },
    { campo: 'activo', etiqueta: 'Activo', formatear: (fila) => (fila.activo ? 'Sí' : 'No') },
  ];

  protected readonly contenidoRenderizado = computed<SafeHtml>(() => {
    const doc = this.documentoActual();
    const html = doc ? marked.parse(doc.contenido || '', { async: false }) : '';
    return this.sanitizer.bypassSecurityTrustHtml(insertarEmbeds(html));
  });

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    tipoSistemaId: [0],
    categoriaId: [0],
    seccionId: [0],
    titulo: ['', Validators.required],
    contenido: ['', Validators.required],
  });

  ngOnInit(): void {
    const param = this.route.snapshot.paramMap.get('seccionId');
    this.seccionFijaId = param ? Number(param) : null;

    if (!this.seccionFijaId) {
      this.data.list<TipoSistemaOpcion>('TipoSistema').subscribe({
        next: (tipos) => this.tiposSistema.set(tipos),
        error: () => this.toast.error('No se pudieron cargar los tipos de sistema.'),
      });
    } else {
      this.cargarMigajas(this.seccionFijaId);
    }

    this.cargar();
  }

  private cargarMigajas(seccionId: number): void {
    this.data.getById<SeccionOpcion>('Seccion', seccionId).subscribe((seccion) => {
      this.seccionFijaNombre = seccion.nombre;
      this.migajas.set([
        { etiqueta: 'Secciones', ruta: '/wikidocs/secciones' },
        { etiqueta: seccion.nombre },
      ]);
    });
  }

  cargar(): void {
    this.cargando.set(true);
    const filtro: Record<string, unknown> = {};
    if (this.busqueda()) filtro['titulo'] = this.busqueda();
    if (this.seccionFijaId) filtro['seccionId'] = this.seccionFijaId;

    this.data.list<Documento>('Documento', filtro).subscribe({
      next: (documentos) => {
        this.documentos.set(documentos);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  onTipoSistemaCambia(idTexto: string): void {
    const tipoSistemaId = Number(idTexto);
    this.form.patchValue({ tipoSistemaId, categoriaId: 0, seccionId: 0 });
    this.categorias.set([]);
    this.secciones.set([]);
    if (!tipoSistemaId) return;

    this.data
      .list<CategoriaOpcion>('Categoria', { tipoSistemaId })
      .subscribe((categorias) => this.categorias.set(categorias));
  }

  onCategoriaCambia(idTexto: string): void {
    const categoriaId = Number(idTexto);
    this.form.patchValue({ categoriaId, seccionId: 0 });
    this.secciones.set([]);
    if (!categoriaId) return;

    this.data.list<SeccionOpcion>('Seccion', { categoriaId }).subscribe((secciones) => this.secciones.set(secciones));
  }

  onSeccionCambia(idTexto: string): void {
    this.form.patchValue({ seccionId: Number(idTexto) });
  }

  nuevoDocumento(): void {
    this.documentoActual.set(null);
    this.form.reset({
      id: 0,
      tipoSistemaId: 0,
      categoriaId: 0,
      seccionId: this.seccionFijaId ?? 0,
      titulo: '',
      contenido: '',
    });
    this.categorias.set([]);
    this.secciones.set([]);
    this.vista.set('editar');
  }

  verDocumento(documento: Documento): void {
    this.documentoActual.set(documento);
    this.vista.set('ver');
  }

  editarDocumento(documento: Documento): void {
    this.documentoActual.set(documento);
    this.cargarFormDesde(documento);
    this.vista.set('editar');
  }

  cambiarTab(tab: 'ver' | 'editar' | 'adjuntos'): void {
    if (tab === 'editar') {
      const doc = this.documentoActual();
      if (doc) this.cargarFormDesde(doc);
    }
    this.vista.set(tab);
  }

  private cargarFormDesde(documento: Documento): void {
    this.form.reset({
      id: documento.id,
      tipoSistemaId: 0,
      categoriaId: 0,
      seccionId: documento.seccionId,
      titulo: documento.titulo,
      contenido: documento.contenido,
    });
  }

  volverALista(): void {
    this.documentoActual.set(null);
    this.vista.set('lista');
    this.cargar();
  }

  cancelarEdicion(): void {
    this.toast.info('Cambios descartados.');
    this.volverALista();
  }

  guardar(): void {
    if (this.form.invalid || !this.form.getRawValue().seccionId) {
      this.form.markAllAsTouched();
      this.toast.advertencia('Selecciona tipo de sistema, categoría y sección.');
      return;
    }

    const { tipoSistemaId: _tipoSistemaId, categoriaId: _categoriaId, ...valor } = this.form.getRawValue();
    const activo = this.documentoActual()?.activo ?? true;
    const dto = { ...valor, activo };
    const esEdicion = this.documentoActual() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Documento>('Documento', dto)
      : this.data.alta<Documento>('Documento', dto);

    peticion.subscribe({
      next: (documento) => {
        this.toast.exito(esEdicion ? 'Documento actualizado.' : 'Documento creado.');
        this.documentoActual.set(documento);
        this.vista.set('ver');
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar el documento. Intenta de nuevo.'),
    });
  }

  private renderParaDescarga(documento: Documento): string {
    return insertarEmbeds(marked.parse(documento.contenido || '', { async: false }) as string);
  }

  descargar(documento: Documento): void {
    const meta = `Última modificación: ${this.formatearFecha(documento)}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${documento.titulo}</title></head><body><h1>${documento.titulo}</h1><p>${meta}</p>${this.renderParaDescarga(documento)}</body></html>`;
    this.descargarBlob(`${documento.titulo || 'documento'}.html`, html);
  }

  /** Descarga TODOS los documentos de la sección actual (solo disponible en
   *  la vista ya filtrada por sección) en un único archivo HTML — igual que
   *  "downloadSection" en el prototipo de referencia. */
  descargarSeccion(): void {
    const documentos = this.documentos();
    if (!documentos.length) {
      this.toast.advertencia('No hay documentos para descargar en esta sección.');
      return;
    }

    const titulo = this.seccionFijaNombre || 'Sección';
    const partes = [`<h1>${titulo}</h1>`];
    documentos.forEach((doc, indice) => {
      if (indice > 0) partes.push('<hr>');
      partes.push(`<h2>${doc.titulo}</h2>`);
      partes.push(`<p>Última modificación: ${this.formatearFecha(doc)}</p>`);
      partes.push(this.renderParaDescarga(doc));
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title></head><body>${partes.join('')}</body></html>`;
    this.descargarBlob(`${titulo}.html`, html);
  }

  private descargarBlob(nombreArchivo: string, html: string): void {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivo;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  protected formatearFecha(documento: Documento): string {
    const iso = documento.fechaModificacion ?? documento.fechaCreacion;
    if (!iso) return 'sin registrar';
    return new Date(iso).toLocaleString('es-MX');
  }

  pedirEliminar(documento: Documento): void {
    this.documentoAEliminar.set(documento);
  }

  confirmarEliminar(): void {
    const documento = this.documentoAEliminar();
    if (!documento) return;

    this.data.baja('Documento', documento.id).subscribe({
      next: () => {
        this.toast.exito('Documento eliminado.');
        this.documentoAEliminar.set(null);
        if (this.documentoActual()?.id === documento.id) this.volverALista();
        else this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar el documento. Intenta de nuevo.'),
    });
  }
}
