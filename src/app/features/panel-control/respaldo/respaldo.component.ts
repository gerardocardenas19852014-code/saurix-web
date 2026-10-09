import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { IndexedDbEngineService } from '../../../core/services/indexeddb-engine.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { fuenteDatosActual } from '../../../core/services/fuente-datos';
import { SupabaseService } from '../../../core/services/supabase.service';

/** Orden de carga a Supabase: primero los catálogos y los "padres", después
 *  lo que los referencia. Lo que no esté aquí se manda al final. */
const ORDEN_IMPORTACION = [
  'ValorLista', 'TipoSistema', 'Categoria', 'Seccion', 'Documento', 'DocumentoVersion', 'DocumentoFavorito',
  'PlantillaDocumento', 'DocumentoAdjunto',
  'CategoriaPresupuesto', 'CuentaPresupuesto', 'PresupuestoAnual', 'MovimientoRecurrentePresupuesto',
  'MovimientoRecurrentePresupuestoAdjunto', 'MovimientoPresupuesto', 'MovimientoPresupuestoAdjunto', 'DeudaPresupuesto',
  'DeudaPresupuestoAbono', 'MetaPresupuesto', 'MetaPresupuestoAporte', 'LimitePresupuesto', 'ProyeccionAjuste',
  'AvisoTarjetaCiclo',
  'Proyecto', 'TicketTipo', 'TicketPrioridad', 'TicketPrioridadNotificar', 'TicketModulo', 'TableroColumna', 'Sprint',
  'Ticket', 'TicketComentario', 'TicketActividad', 'TicketEtiqueta', 'TicketAdjunto', 'TicketHistorialEstado',
  'TicketDependencia', 'TicketSeguidor',
  'MiembroFamilia', 'DocumentoFamilia', 'DocumentoFamiliaAdjunto', 'VacunaMiembro', 'VacunaMiembroAdjunto',
  'CitaMedicaMiembro', 'CitaMedicaMiembroAdjunto', 'PolizaSeguroMiembro', 'MedicionCrecimiento',
  'ContactoEmergenciaMiembro', 'EventoFamiliar', 'TareaHogar', 'TramiteEstado', 'TramiteFamiliar',
  'Rol', 'Permiso', 'RolPermiso', 'ConfiguracionApariencia', 'Notificacion', 'Bitacora',
];
const FILAS_POR_LLAMADA = 150;

interface ResultadoImportacion {
  entidad: string;
  importados?: number;
  omitidos?: number;
  errores?: string[];
  sinTabla?: boolean;
  filas?: number;
}

/** Forma del archivo .json que genera/lee esta pantalla. */
interface RespaldoSaurix {
  app: 'Saurix';
  version: 1;
  exportadoEn: string;
  stores: Record<string, unknown[]>;
}

function esRespaldoValido(valor: unknown): valor is RespaldoSaurix {
  return (
    !!valor &&
    typeof valor === 'object' &&
    (valor as Record<string, unknown>)['app'] === 'Saurix' &&
    typeof (valor as Record<string, unknown>)['stores'] === 'object'
  );
}

/**
 * Respaldo y restauración de la base local (IndexedDB): mientras no exista
 * PlataformaSaurix conectado de verdad, todo lo que se captura en esta app
 * vive únicamente en el navegador de este dispositivo — nada se sincroniza
 * solo entre computadoras. Esta pantalla es la manera de mover esos datos:
 * "Descargar respaldo" guarda un .json con todo, y "Restaurar" lo vuelve a
 * cargar en cualquier otro dispositivo/navegador.
 */
@Component({
  selector: 'app-respaldo',
  standalone: true,
  imports: [ConfirmDialogComponent],
  templateUrl: './respaldo.component.html',
  styleUrl: './respaldo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RespaldoComponent implements OnInit, OnDestroy {
  // Pantallas de Panel de Control (menos "Inicio", que es la cuadrícula de
  // iconos): por defecto .content tiene max-width: 980px y queda centrada,
  // dejando franjas vacías grandes a los lados en pantallas anchas. Se pide
  // aquí el mismo ancho ampliado que ya usan Movimientos/Deudas/Proyección/
  // Familia (ver html[data-wide='grid'] en styles.scss) para que el
  // contenido aproveche ese espacio.
  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid');
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly engine = inject(IndexedDbEngineService);
  protected readonly toast = inject(ToastService);

  protected readonly generandoRespaldo = signal(false);
  protected readonly restaurando = signal(false);

  /** Respaldo ya leído y validado del archivo elegido, esperando confirmación
   *  del usuario antes de sobreescribir todo lo que hay en este dispositivo. */
  protected readonly respaldoPendiente = signal<RespaldoSaurix | null>(null);
  protected readonly nombreArchivoPendiente = signal('');

  // ── Importar a Supabase ─────────────────────────────────────────────
  protected readonly modoSupabase = fuenteDatosActual() === 'supabase';
  private readonly sb = this.modoSupabase ? inject(SupabaseService).cliente : null;
  protected readonly respaldoAImportar = signal<RespaldoSaurix | null>(null);
  protected readonly nombreArchivoImportar = signal('');
  protected readonly importando = signal(false);
  protected readonly progresoImportacion = signal('');
  protected readonly resultadosImportacion = signal<ResultadoImportacion[]>([]);

  async descargarRespaldo(): Promise<void> {
    this.generandoRespaldo.set(true);
    try {
      const stores = await this.engine.exportarTodo();
      const respaldo: RespaldoSaurix = {
        app: 'Saurix',
        version: 1,
        exportadoEn: new Date().toISOString(),
        stores,
      };

      const fecha = new Date().toISOString().slice(0, 10);
      const contenido = JSON.stringify(respaldo, null, 2);
      const blob = new Blob([contenido], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `saurix-respaldo-${fecha}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      const totalRegistros = Object.values(stores).reduce((acc, filas) => acc + filas.length, 0);
      this.toast.exito(`Respaldo descargado (${totalRegistros} registros en total).`);
    } catch {
      this.toast.error('No se pudo generar el respaldo. Intenta de nuevo.');
    } finally {
      this.generandoRespaldo.set(false);
    }
  }

  /** Lee y valida el archivo elegido, pero NO restaura todavía — se pide
   *  confirmación explícita (ver app-confirm-dialog) porque es destructivo:
   *  reemplaza todo lo que ya hay guardado en este dispositivo. */
  async archivoSeleccionado(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = ''; // permite volver a elegir el mismo archivo si se cancela después

    if (!archivo) return;

    try {
      const texto = await archivo.text();
      const datos: unknown = JSON.parse(texto);
      if (!esRespaldoValido(datos)) {
        this.toast.error('Ese archivo no es un respaldo de Saurix válido.');
        return;
      }
      this.nombreArchivoPendiente.set(archivo.name);
      this.respaldoPendiente.set(datos);
    } catch {
      this.toast.error('No se pudo leer el archivo. ¿Seguro que es el .json del respaldo?');
    }
  }

  cancelarRestauracion(): void {
    this.respaldoPendiente.set(null);
    this.toast.info('Restauración cancelada.');
  }

  async confirmarRestauracion(): Promise<void> {
    const respaldo = this.respaldoPendiente();
    if (!respaldo) return;

    this.restaurando.set(true);
    try {
      await this.engine.restaurarTodo(respaldo.stores);
      this.toast.exito('Restauración completada. Recargando…');
      // Todo lo cacheado en memoria por cada pantalla (signals ya cargados
      // antes de restaurar) quedaría desactualizado — una recarga completa
      // es la forma más simple y segura de que todo vuelva a leer la base
      // ya restaurada, sin tener que tocar cada componente de la app.
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      this.toast.error('No se pudo restaurar el respaldo. Intenta de nuevo.');
      this.restaurando.set(false);
    }
  }

  /** Lee y valida el .json; la importación espera confirmación. */
  async archivoParaImportar(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    try {
      const datos: unknown = JSON.parse(await archivo.text());
      if (!esRespaldoValido(datos)) {
        this.toast.error('Ese archivo no es un respaldo de Saurix válido.');
        return;
      }
      this.nombreArchivoImportar.set(archivo.name);
      this.respaldoAImportar.set(datos);
    } catch {
      this.toast.error('No se pudo leer el archivo. ¿Seguro que es el .json del respaldo?');
    }
  }

  cancelarImportacion(): void {
    this.respaldoAImportar.set(null);
  }

  /**
   * Manda el respaldo a Supabase una entidad a la vez (función
   * panel_control.importar_entidad, ver supabase/migrations/08). Conserva
   * los ids, así que las relaciones quedan igual; lo que ya exista se
   * omite, por lo que se puede volver a correr sin duplicar. Los adjuntos
   * se suben primero a Storage desde aquí.
   */
  async confirmarImportacion(): Promise<void> {
    const respaldo = this.respaldoAImportar();
    if (!respaldo || !this.sb) return;
    this.respaldoAImportar.set(null);
    this.importando.set(true);
    this.resultadosImportacion.set([]);

    const stores = respaldo.stores as Record<string, Record<string, unknown>[]>;
    const usuarios = stores['Usuario'] ?? [];
    const entidades = [
      ...ORDEN_IMPORTACION.filter((e) => stores[e]?.length),
      ...Object.keys(stores).filter((e) => !ORDEN_IMPORTACION.includes(e) && e !== 'Usuario' && stores[e]?.length),
    ];

    try {
      for (const entidad of entidades) {
        let filas = stores[entidad];
        const erroresAdjuntos: string[] = [];
        if (entidad.endsWith('Adjunto')) {
          this.progresoImportacion.set(`Subiendo archivos de ${entidad}…`);
          filas = await this.subirAdjuntos(entidad, filas, erroresAdjuntos);
        }
        const total: ResultadoImportacion = { entidad, importados: 0, omitidos: erroresAdjuntos.length, errores: erroresAdjuntos };
        for (let i = 0; i < filas.length; i += FILAS_POR_LLAMADA) {
          this.progresoImportacion.set(`Importando ${entidad} (${Math.min(i + FILAS_POR_LLAMADA, filas.length)}/${filas.length})…`);
          const { data, error } = await this.sb
            .schema('panel_control')
            .rpc('importar_entidad', {
              p_entidad: entidad,
              p_filas: filas.slice(i, i + FILAS_POR_LLAMADA),
              p_usuarios: usuarios,
            });
          if (error) throw new Error(`${entidad}: ${error.message}`);
          const r = data as ResultadoImportacion;
          if (r.sinTabla) {
            total.sinTabla = true;
            total.filas = filas.length;
            break;
          }
          total.importados = (total.importados ?? 0) + (r.importados ?? 0);
          total.omitidos = (total.omitidos ?? 0) + (r.omitidos ?? 0);
          total.errores = [...(total.errores ?? []), ...(r.errores ?? [])];
        }
        this.resultadosImportacion.update((lista) => [...lista, total]);
      }
      this.toast.exito('Importación terminada. Revisa el resumen.');
    } catch (error) {
      this.toast.error(`La importación se detuvo: ${(error as Error).message}`);
    } finally {
      this.importando.set(false);
      this.progresoImportacion.set('');
    }
  }

  /** Sube cada adjunto (data URL) a Storage y lo cambia por su ruta. */
  private async subirAdjuntos(
    entidad: string,
    filas: Record<string, unknown>[],
    errores: string[],
  ): Promise<Record<string, unknown>[]> {
    const almacen = this.sb!.storage.from('adjuntos');
    const listos: Record<string, unknown>[] = [];
    for (const fila of filas) {
      const { contenido, ...resto } = fila;
      if (typeof contenido !== 'string' || !contenido.startsWith('data:')) {
        errores.push(`id ${fila['id']}: sin contenido`);
        continue;
      }
      try {
        const blob = await (await fetch(contenido)).blob();
        const campoPadre = Object.keys(fila).find((k) => k !== 'id' && k.endsWith('Id'));
        const padre = campoPadre ? String(fila[campoPadre]) : 'sin-padre';
        const nombre = String(fila['nombreArchivo'] ?? 'archivo').normalize('NFD').replace(/[^\w.-]+/g, '_');
        const ruta = `${entidad}/${padre}/${crypto.randomUUID()}-${nombre}`;
        const { error } = await almacen.upload(ruta, blob, {
          contentType: String(fila['tipoContenido'] ?? blob.type ?? 'application/octet-stream'),
        });
        if (error) throw error;
        listos.push({ ...resto, rutaStorage: ruta, tamanoBytes: blob.size });
      } catch (error) {
        errores.push(`id ${fila['id']}: ${(error as Error).message}`);
      }
    }
    return listos;
  }

  totalRegistros(respaldo: RespaldoSaurix | null): number {
    if (!respaldo) return 0;
    return Object.values(respaldo.stores).reduce((acc, filas) => acc + filas.length, 0);
  }
}
