import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { filaACamel } from '../../../core/services/supabase-data-client.service';
import { ToastService } from '../../../shared/services/toast.service';

/** Fila de `wikidocs.fn_dashboard_resumen` (ver mandato "Evolución de
 *  WikiDocs: Dashboard y Mapa de trazabilidad", nov-2026) — un solo
 *  registro con los 8 indicadores, todos calculados server-side. */
interface ResumenDashboard {
  documentosActivos: number;
  documentosInactivos: number;
  misFavoritos: number;
  documentosConectados: number;
  documentosHuerfanos: number;
  totalSistemas: number;
  totalCategorias: number;
  totalSecciones: number;
}

interface DistribucionSistemaFila {
  tipoSistemaId: number;
  nombre: string;
  totalDocumentos: number;
}

interface DistribucionCategoriaFila {
  categoriaId: number;
  nombre: string;
  totalDocumentos: number;
}

interface FavoritoReciente {
  documentoId: number;
  titulo: string;
  seccionId: number;
  marcadoEn?: string;
}

/** Fila de `wikidocs.fn_documentos_lista_pagina` reutilizada tal cual
 *  (sin `contenido`) para "Últimos 10 documentos actualizados". */
interface DocumentoReciente {
  id: number;
  titulo: string;
  seccionId: number;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

/**
 * Dashboard propio de WikiDocs — mismo mandato "Evolución de WikiDocs:
 * Dashboard y Mapa de trazabilidad" (nov-2026) que lo creó: indicadores,
 * distribución por sistema/categoría, últimos documentos actualizados y
 * favoritos recientes, todo calculado server-side vía 5 funciones RPC
 * ligeras (`fn_dashboard_resumen`, `fn_dashboard_distribucion_sistema`,
 * `fn_dashboard_distribucion_categoria`, `fn_dashboard_favoritos_recientes`
 * y la ya existente `fn_documentos_lista_pagina`). Ninguna de las 5
 * descarga `contenido` ni hace polling; los catálogos (Tipo de
 * sistema/Categoría/Secciones) nunca se paginan, así que sus
 * distribuciones se traen completas.
 *
 * Rectificación a la Corrección 02 del Mandato 89 (nov-2026): este
 * componente — y su propia ruta `wikidocs/dashboard` — se separan de
 * `WikidocsLandingComponent`, que vuelve a ser SOLO el índice de pantallas
 * (Inicio), exactamente como ya funcionan `InventarioDashboardComponent` /
 * `ProyectosDashboardComponent` frente a sus respectivos `*-landing`: Inicio
 * es la cuadrícula de accesos; Dashboard es su propia pantalla, con su
 * propia carga de datos, a la que se llega desde el tile "Dashboard" dentro
 * del grupo "Reportes" de Inicio. Antes de esta rectificación, el Dashboard
 * vivía dentro de la misma `WikidocsLandingComponent` que el menú — esta
 * separación es exactamente lo que pide la rectificación: "Inicio" y
 * "Dashboard" deben ser dos ventanas independientes, igual que en
 * Inventario y Ventas. Se conserva `data-wide='grid'` en `ngOnInit`/
 * `ngOnDestroy` (mismo mecanismo ya usado en `InventarioDashboardComponent`)
 * para que las 2 tablas de cada `.dashboard-columnas-2` no fuercen su
 * propio scroll horizontal dentro de un `.content` angosto.
 */
@Component({
  selector: 'app-wikidocs-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './wikidocs-dashboard.component.html',
  styleUrl: './wikidocs-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WikidocsDashboardComponent implements OnInit, OnDestroy {
  private readonly sb = inject(SupabaseService).cliente;
  private readonly toast = inject(ToastService);

  protected readonly cargandoResumen = signal(true);
  protected readonly resumen = signal<ResumenDashboard | null>(null);
  protected readonly distribucionSistema = signal<DistribucionSistemaFila[]>([]);
  protected readonly distribucionCategoria = signal<DistribucionCategoriaFila[]>([]);
  protected readonly ultimosActualizados = signal<DocumentoReciente[]>([]);
  protected readonly favoritosRecientes = signal<FavoritoReciente[]>([]);

  ngOnInit(): void {
    // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss) —
    // mismo mecanismo ya usado en InventarioDashboardComponent, para que
    // las 2 tablas de distribución no fuercen su propio scroll horizontal
    // dentro de un `.content` angosto.
    document.documentElement.setAttribute('data-wide', 'grid');
    void this.cargarResumen();
    void this.cargarDistribuciones();
    void this.cargarListas();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private async cargarResumen(): Promise<void> {
    this.cargandoResumen.set(true);
    const { data, error } = await this.sb.schema('wikidocs').rpc('fn_dashboard_resumen');
    this.cargandoResumen.set(false);
    if (error) {
      this.toast.error('No se pudieron cargar los indicadores del Dashboard: ' + error.message);
      return;
    }
    const fila = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (fila) this.resumen.set(filaACamel(fila) as unknown as ResumenDashboard);
  }

  private async cargarDistribuciones(): Promise<void> {
    const [sistema, categoria] = await Promise.all([
      this.sb.schema('wikidocs').rpc('fn_dashboard_distribucion_sistema'),
      this.sb.schema('wikidocs').rpc('fn_dashboard_distribucion_categoria'),
    ]);
    if (sistema.error) {
      this.toast.error('No se pudo cargar la distribución por sistema: ' + sistema.error.message);
    } else {
      this.distribucionSistema.set(
        ((sistema.data ?? []) as Record<string, unknown>[]).map((f) => filaACamel(f) as unknown as DistribucionSistemaFila),
      );
    }
    if (categoria.error) {
      this.toast.error('No se pudo cargar la distribución por categoría: ' + categoria.error.message);
    } else {
      this.distribucionCategoria.set(
        ((categoria.data ?? []) as Record<string, unknown>[]).map((f) => filaACamel(f) as unknown as DistribucionCategoriaFila),
      );
    }
  }

  private async cargarListas(): Promise<void> {
    const [ultimos, favoritos] = await Promise.all([
      this.sb.schema('wikidocs').rpc('fn_documentos_lista_pagina', {
        p_orden_columna: 'fecha_modificacion',
        p_orden_direccion: 'desc',
        p_cantidad: 10,
      }),
      this.sb.schema('wikidocs').rpc('fn_dashboard_favoritos_recientes', { p_cantidad: 10 }),
    ]);
    if (ultimos.error) {
      this.toast.error('No se pudieron cargar los últimos documentos actualizados: ' + ultimos.error.message);
    } else {
      this.ultimosActualizados.set(
        ((ultimos.data ?? []) as Record<string, unknown>[]).map((f) => filaACamel(f) as unknown as DocumentoReciente),
      );
    }
    if (favoritos.error) {
      this.toast.error('No se pudieron cargar los favoritos recientes: ' + favoritos.error.message);
    } else {
      this.favoritosRecientes.set(
        ((favoritos.data ?? []) as Record<string, unknown>[]).map((f) => filaACamel(f) as unknown as FavoritoReciente),
      );
    }
  }
}
