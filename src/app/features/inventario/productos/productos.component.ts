import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { ToastService } from '../../../shared/services/toast.service';
import { PreferenciasGridService } from '../../../shared/services/preferencias-grid.service';
import { exportarCsv, parsearCsv } from '../../../shared/utils/csv.util';
import { Producto } from './producto.model';
import { CategoriaProducto } from '../categorias-producto/categoria-producto.model';
import { UnidadMedida } from '../unidades-medida/unidad-medida.model';
import { Proveedor } from '../proveedores/proveedor.model';
import { formatMoneda, existenciaTotal, tieneBodegaAsignada } from './producto.util';
import { ExistenciaBodega } from '../movimientos-bodega/existencia-bodega.model';

/** Una fila ya parseada del CSV de importación masiva, con su validación
 *  resuelta — ver importarArchivo()/validarFila() más abajo. `payload` solo
 *  viene lleno cuando `error` es null (fila lista para mandar a Alta). */
interface FilaImportacion {
  numero: number; // número de renglón del archivo (para ubicarlo si hay error) — 1 = encabezado
  nombre: string;
  codigo: string;
  categoriaTexto: string;
  unidadTexto: string;
  costoTexto: string;
  precioTexto: string;
  existenciaTexto: string;
  activoTexto: string;
  error: string | null;
  payload: Omit<Producto, 'id'> | null;
}

const ENCABEZADOS_CSV = ['nombre', 'codigo', 'categoria', 'unidad', 'costo', 'precio', 'existencia', 'activo'] as const;

@Component({
  selector: 'app-productos',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent, SelectBuscableComponent],
  templateUrl: './productos.component.html',
  styleUrl: './productos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductosComponent implements OnInit, OnDestroy {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  protected readonly toast = inject(ToastService);
  protected readonly preferenciasGrid = inject(PreferenciasGridService);
  private readonly fb = inject(FormBuilder);

  protected readonly productos = signal<Producto[]>([]);
  protected readonly categorias = signal<CategoriaProducto[]>([]);
  protected readonly unidades = signal<UnidadMedida[]>([]);
  protected readonly proveedores = signal<Proveedor[]>([]);
  protected readonly existenciasBodega = signal<ExistenciaBodega[]>([]);
  protected readonly cargando = signal(false);
  protected readonly busqueda = signal('');
  protected readonly mostrarInactivos = signal(false);
  protected readonly productosFiltrados = computed(() =>
    this.productos().filter((p) => this.mostrarInactivos() || p.activo !== false),
  );

  protected readonly opcionesCategoria = computed<OpcionBuscable[]>(() =>
    this.categorias()
      .filter((c) => c.activo !== false)
      .map((c) => ({ valor: c.id, etiqueta: c.nombre })),
  );
  protected readonly opcionesUnidad = computed<OpcionBuscable[]>(() =>
    this.unidades()
      .filter((u) => u.activo !== false)
      .map((u) => ({ valor: u.id, etiqueta: u.nombre })),
  );
  /** Incluye la opción "Sin proveedor" (valor 0) porque, a diferencia de
   *  Categoría/Unidad, asignar proveedor es opcional (ver Producto.proveedorId). */
  protected readonly opcionesProveedor = computed<OpcionBuscable[]>(() => [
    { valor: 0, etiqueta: 'Sin proveedor' },
    ...this.proveedores()
      .filter((p) => p.activo !== false)
      .map((p) => ({ valor: p.id, etiqueta: p.nombre })),
  ]);

  private nombreCategoria(id: number): string {
    return this.categorias().find((c) => c.id === id)?.nombre ?? '—';
  }
  private nombreUnidad(id: number): string {
    return this.unidades().find((u) => u.id === id)?.nombre ?? '—';
  }
  protected nombreProveedor(id: number | null): string {
    if (!id) return '—';
    return this.proveedores().find((p) => p.id === id)?.nombre ?? '—';
  }

  protected readonly modalAbierto = signal(false);
  protected readonly productoEnEdicion = signal<Producto | null>(null);
  protected readonly productoAEliminar = signal<Producto | null>(null);
  /** true cuando el producto en edición ya tiene al menos una bodega
   *  asignada (ver tieneBodegaAsignada() en producto.util.ts) — a partir de
   *  ahí "Existencia inicial" se vuelve de solo lectura: cambiarla de verdad
   *  se hace desde Movimientos entre bodegas, para no tener dos números que
   *  puedan desincronizarse. */
  protected readonly existenciaBloqueada = signal(false);
  /** Foto del producto en edición (base64, ya redimensionada) — aparte del
   *  formulario reactivo por lo mismo que fotoActual en miembros.component.ts:
   *  más simple de resetear/precargar que meterla como FormControl. */
  protected readonly fotoActual = signal<string>('');
  /** true mientras el visor de foto a tamaño completo está abierto (ver
   *  guardar()/quitarFoto() no la tocan; solo se cierra al abrir/cerrar el
   *  modal o con el botón ✕ del visor). */
  protected readonly fotoAmpliada = signal(false);

  protected readonly columnas: ColumnaTabla<Producto>[] = [
    { campo: 'codigo', etiqueta: 'Código', formatear: (fila) => fila.codigo ?? '—' },
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'categoriaProductoId', etiqueta: 'Categoría', formatear: (fila) => this.nombreCategoria(fila.categoriaProductoId) },
    { campo: 'unidadMedidaId', etiqueta: 'Unidad', formatear: (fila) => this.nombreUnidad(fila.unidadMedidaId) },
    {
      campo: 'existencia',
      etiqueta: 'Tipo',
      formatear: (fila) => (fila.existencia === null ? 'Servicio' : 'Producto'),
      claseValor: (fila) => (fila.existencia === null ? 'grid-badge-muted' : 'grid-badge-warning'),
    },
    { campo: 'costo', etiqueta: 'Costo', formatear: (fila) => formatMoneda(fila.costo) },
    { campo: 'precioUnitario', etiqueta: 'Precio', formatear: (fila) => formatMoneda(fila.precioUnitario) },
    {
      campo: 'existencia',
      etiqueta: 'Existencia',
      formatear: (fila) => (fila.existencia === null ? '—' : String(existenciaTotal(fila, this.existenciasBodega()))),
    },
    { campo: 'proveedorId', etiqueta: 'Proveedor', formatear: (fila) => this.nombreProveedor(fila.proveedorId) },
    {
      campo: 'activo',
      etiqueta: 'Activo',
      formatear: (fila) => (fila.activo !== false ? 'Sí' : 'No'),
      claseValor: (fila) => (fila.activo !== false ? 'grid-badge-success' : 'grid-badge-muted'),
    },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    codigo: [''],
    categoriaProductoId: [0, [Validators.required, Validators.min(1)]],
    unidadMedidaId: [0, [Validators.required, Validators.min(1)]],
    descripcion: [''],
    costo: [0, [Validators.required, Validators.min(0)]],
    precioUnitario: [0, [Validators.required, Validators.min(0)]],
    /** No se manda tal cual al backend — decide si `existencia` sale como
     *  null (servicio) o como el número del control `existencia` de abajo
     *  (ver guardar()). */
    esServicio: [false],
    existencia: [0, [Validators.min(0)]],
    /** Opcional — null = sin mínimo definido (ver producto.model.ts). Igual
     *  que `existencia`, se oculta y se fuerza a null cuando es servicio
     *  (ver guardar()). */
    nivelMinimo: [null as number | null, [Validators.min(0)]],
    /** 0 = "Sin proveedor" (ver opcionesProveedor arriba) — se convierte a
     *  null en guardar() antes de mandarlo, igual que codigo/descripcion. */
    proveedorId: [0],
    activo: [true],
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargarCatalogos();
    this.cargar();
  }

  private cargarCatalogos(): void {
    this.data.list<CategoriaProducto>('CategoriaProducto').subscribe((c) => this.categorias.set(c));
    this.data.list<UnidadMedida>('UnidadMedida').subscribe((u) => this.unidades.set(u));
    this.data.list<ExistenciaBodega>('ExistenciaBodega').subscribe((e) => this.existenciasBodega.set(e));
    this.data.list<Proveedor>('Proveedor').subscribe((p) => this.proveedores.set(p));
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<Producto>('Producto', { nombre: this.busqueda() || undefined }).subscribe({
      next: (productos) => {
        this.productos.set(productos);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nuevo(): void {
    if (this.categorias().length === 0 || this.unidades().length === 0) {
      this.toast.advertencia('Antes crea al menos una Categoría de producto y una Unidad de medida (Inventario → Catálogos).');
      return;
    }
    this.productoEnEdicion.set(null);
    this.existenciaBloqueada.set(false);
    this.fotoActual.set('');
    this.fotoAmpliada.set(false);
    this.form.controls.existencia.enable();
    this.form.reset({
      id: 0,
      nombre: '',
      codigo: '',
      categoriaProductoId: 0,
      unidadMedidaId: 0,
      descripcion: '',
      costo: 0,
      precioUnitario: 0,
      esServicio: false,
      existencia: 0,
      nivelMinimo: null,
      proveedorId: 0,
      activo: true,
    });
    this.modalAbierto.set(true);
  }

  editar(producto: Producto): void {
    this.productoEnEdicion.set(producto);
    const bloqueada = tieneBodegaAsignada(producto.id, this.existenciasBodega());
    this.existenciaBloqueada.set(bloqueada);
    this.fotoActual.set(producto.foto ?? '');
    this.fotoAmpliada.set(false);
    /** Deshabilitar de verdad el FormControl (no solo el atributo HTML) es
     *  necesario: ReactiveFormsModule reescribe la propiedad `disabled` del
     *  <input> en cada ciclo de detección de cambios según el estado del
     *  control, así que un `[attr.disabled]` puesto solo en la plantilla
     *  pierde esa pelea y el campo queda editable de todas formas. */
    if (bloqueada) {
      this.form.controls.existencia.disable();
    } else {
      this.form.controls.existencia.enable();
    }
    this.form.reset({
      id: producto.id,
      nombre: producto.nombre,
      codigo: producto.codigo ?? '',
      categoriaProductoId: producto.categoriaProductoId,
      unidadMedidaId: producto.unidadMedidaId,
      descripcion: producto.descripcion ?? '',
      costo: producto.costo,
      precioUnitario: producto.precioUnitario,
      esServicio: producto.existencia === null,
      existencia: existenciaTotal(producto, this.existenciasBodega()),
      nivelMinimo: producto.nivelMinimo ?? null,
      proveedorId: producto.proveedorId ?? 0,
      activo: producto.activo !== false,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const { esServicio, existencia, nivelMinimo, ...resto } = valor;
    const payload = {
      ...resto,
      codigo: resto.codigo || null,
      descripcion: resto.descripcion || null,
      existencia: esServicio ? null : existencia,
      nivelMinimo: esServicio ? null : nivelMinimo,
      proveedorId: resto.proveedorId || null,
      foto: this.fotoActual(),
    };
    const esEdicion = this.productoEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Producto>('Producto', payload)
      : this.data.alta<Producto>('Producto', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Producto actualizado.' : 'Producto creado.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(producto: Producto): void {
    this.productoAEliminar.set(producto);
  }

  confirmarEliminar(): void {
    const producto = this.productoAEliminar();
    if (!producto) return;

    this.data.baja('Producto', producto.id).subscribe({
      next: () => {
        this.toast.exito('Producto eliminado.');
        this.productoAEliminar.set(null);
        this.cargar();
      },
    });
  }

  // ── Importación masiva ──────────────────────────────────────────────

  protected readonly modalImportarAbierto = signal(false);
  protected readonly filasImportacion = signal<FilaImportacion[]>([]);
  protected readonly importando = signal(false);
  protected readonly progresoImportacion = signal('');
  protected readonly resumenImportacion = signal<{ importados: number; omitidos: number } | null>(null);

  protected readonly filasValidas = computed(() => this.filasImportacion().filter((f) => f.error === null));
  protected readonly filasConError = computed(() => this.filasImportacion().filter((f) => f.error !== null));

  /** Plantilla descargable: mismos encabezados que espera importarArchivo(),
   *  con dos renglones de ejemplo (un producto físico y un servicio) usando
   *  claves reales si ya hay catálogos capturados, o un ejemplo genérico si
   *  todavía no hay ninguno. */
  descargarPlantilla(): void {
    const claveCategoria = this.categorias()[0]?.clave ?? 'GENERAL';
    const claveUnidad = this.unidades()[0]?.clave ?? 'PZA';
    const filas = [
      {
        nombre: 'Ejemplo producto físico',
        codigo: 'SKU-001',
        categoria: claveCategoria,
        unidad: claveUnidad,
        costo: '50.00',
        precio: '89.90',
        existencia: '10',
        activo: 'si',
      },
      {
        nombre: 'Ejemplo servicio',
        codigo: '',
        categoria: claveCategoria,
        unidad: claveUnidad,
        costo: '0',
        precio: '350.00',
        existencia: '',
        activo: 'si',
      },
    ];
    exportarCsv(
      'plantilla-productos.csv',
      ENCABEZADOS_CSV.map((clave) => ({ clave, etiqueta: clave })),
      filas,
    );
    this.toast.info('La columna "categoria" y "unidad" deben coincidir con la Clave de esos catálogos. "existencia" vacío = servicio.');
  }

  async archivoSeleccionado(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = ''; // permite volver a elegir el mismo archivo después
    if (!archivo) return;

    const texto = await archivo.text();
    const filas = parsearCsv(texto);
    if (filas.length === 0) {
      this.toast.advertencia('El archivo está vacío.');
      return;
    }

    // La primera fila se asume encabezado — no se valida su contenido, solo se descarta.
    const renglones = filas.slice(1);
    if (renglones.length === 0) {
      this.toast.advertencia('El archivo no trae renglones de datos, solo el encabezado.');
      return;
    }

    this.resumenImportacion.set(null);
    this.filasImportacion.set(renglones.map((campos, indice) => this.validarFila(campos, indice + 2)));
    this.modalImportarAbierto.set(true);
  }

  /** `numeroRenglon` es el número de línea real del archivo (contando el
   *  encabezado como línea 1) — así un error apunta al mismo renglón que el
   *  usuario vería si abre el CSV en Excel. */
  private validarFila(campos: string[], numeroRenglon: number): FilaImportacion {
    const [nombre = '', codigo = '', categoriaTexto = '', unidadTexto = '', costoTexto = '', precioTexto = '', existenciaTexto = '', activoTexto = ''] = campos;

    const base: Omit<FilaImportacion, 'error' | 'payload'> = {
      numero: numeroRenglon,
      nombre: nombre.trim(),
      codigo: codigo.trim(),
      categoriaTexto: categoriaTexto.trim(),
      unidadTexto: unidadTexto.trim(),
      costoTexto: costoTexto.trim(),
      precioTexto: precioTexto.trim(),
      existenciaTexto: existenciaTexto.trim(),
      activoTexto: activoTexto.trim(),
    };

    if (!base.nombre) {
      return { ...base, error: 'Falta el nombre.', payload: null };
    }

    const categoria = this.categorias().find((c) => c.clave.toLowerCase() === base.categoriaTexto.toLowerCase());
    if (!categoria) {
      return { ...base, error: `La categoría "${base.categoriaTexto}" no existe (revisa la Clave).`, payload: null };
    }

    const unidad = this.unidades().find((u) => u.clave.toLowerCase() === base.unidadTexto.toLowerCase());
    if (!unidad) {
      return { ...base, error: `La unidad "${base.unidadTexto}" no existe (revisa la Clave).`, payload: null };
    }

    const costo = base.costoTexto === '' ? 0 : Number(base.costoTexto);
    if (Number.isNaN(costo) || costo < 0) {
      return { ...base, error: `Costo inválido: "${base.costoTexto}".`, payload: null };
    }

    if (base.precioTexto === '') {
      return { ...base, error: 'Falta el precio.', payload: null };
    }
    const precio = Number(base.precioTexto);
    if (Number.isNaN(precio) || precio < 0) {
      return { ...base, error: `Precio inválido: "${base.precioTexto}".`, payload: null };
    }

    let existencia: number | null = null;
    if (base.existenciaTexto !== '') {
      existencia = Number(base.existenciaTexto);
      if (Number.isNaN(existencia) || existencia < 0) {
        return { ...base, error: `Existencia inválida: "${base.existenciaTexto}".`, payload: null };
      }
    }

    const activoTextoNormalizado = base.activoTexto.toLowerCase();
    const activo = !['no', 'false', '0'].includes(activoTextoNormalizado);

    return {
      ...base,
      error: null,
      payload: {
        nombre: base.nombre,
        codigo: base.codigo || null,
        categoriaProductoId: categoria.id,
        unidadMedidaId: unidad.id,
        descripcion: null,
        costo,
        precioUnitario: precio,
        existencia,
        nivelMinimo: null, // el CSV no trae esta columna — se define luego, por producto, en Productos.
        proveedorId: null, // idem — se asigna después, en Productos.
        activo,
      },
    };
  }

  cancelarImportacion(): void {
    this.modalImportarAbierto.set(false);
    this.filasImportacion.set([]);
    this.resumenImportacion.set(null);
  }

  async confirmarImportacion(): Promise<void> {
    const validas = this.filasValidas();
    if (validas.length === 0) return;

    this.importando.set(true);
    let importados = 0;
    const errores: string[] = [];

    for (let i = 0; i < validas.length; i++) {
      const fila = validas[i];
      this.progresoImportacion.set(`Importando ${i + 1}/${validas.length}: ${fila.nombre}…`);
      try {
        await firstValueFrom(this.data.alta<Producto>('Producto', fila.payload!));
        importados++;
      } catch (error) {
        errores.push(`Renglón ${fila.numero} (${fila.nombre}): ${(error as Error)?.message ?? 'error desconocido'}.`);
      }
    }

    this.importando.set(false);
    this.progresoImportacion.set('');
    this.resumenImportacion.set({ importados, omitidos: this.filasConError().length + errores.length });

    if (errores.length > 0) {
      this.filasImportacion.update((filas) => [
        ...filas.filter((f) => f.error !== null),
        ...errores.map((mensaje, indice) => ({
          numero: -1 - indice,
          nombre: '',
          codigo: '',
          categoriaTexto: '',
          unidadTexto: '',
          costoTexto: '',
          precioTexto: '',
          existenciaTexto: '',
          activoTexto: '',
          error: mensaje,
          payload: null,
        })),
      ]);
    } else {
      this.filasImportacion.set(this.filasImportacion().filter((f) => f.error !== null));
    }

    this.toast.exito(`Importación terminada: ${importados} creado${importados === 1 ? '' : 's'}.`);
    this.cargar();
  }

  // ── Foto del producto ────────────────────────────────────────────────
  /** Igual que redimensionarFoto() en miembros.component.ts (FileReader →
   *  <canvas> → JPEG comprimido), para no guardar fotos de cámara de varios
   *  MB tal cual en IndexedDB. */
  private redimensionarFoto(archivo: File): Promise<string> {
    const MAX_LADO = 480;
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => {
        const imagen = new Image();
        imagen.onload = () => {
          let { width, height } = imagen;
          if (width > height && width > MAX_LADO) {
            height = Math.round((height * MAX_LADO) / width);
            width = MAX_LADO;
          } else if (height >= width && height > MAX_LADO) {
            width = Math.round((width * MAX_LADO) / height);
            height = MAX_LADO;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const contexto = canvas.getContext('2d');
          if (!contexto) {
            reject(new Error('Sin contexto de canvas.'));
            return;
          }
          contexto.drawImage(imagen, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        imagen.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        imagen.src = lector.result as string;
      };
      lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      lector.readAsDataURL(archivo);
    });
  }

  onFotoSeleccionada(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;

    if (!archivo.type.startsWith('image/')) {
      this.toast.advertencia('Elige un archivo de imagen (JPG, PNG, etc.).');
      input.value = '';
      return;
    }
    if (archivo.size > 8 * 1024 * 1024) {
      this.toast.advertencia('La imagen no puede pesar más de 8 MB.');
      input.value = '';
      return;
    }

    this.redimensionarFoto(archivo)
      .then((dataUrl) => this.fotoActual.set(dataUrl))
      .catch(() => this.toast.error('No se pudo procesar la imagen. Intenta con otra.'))
      .finally(() => {
        input.value = '';
      });
  }

  quitarFoto(input: HTMLInputElement): void {
    this.fotoActual.set('');
    this.fotoAmpliada.set(false);
    input.value = '';
  }
}
