import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { filaACamel } from '../../../core/services/supabase-data-client.service';
import { ToastService } from '../../../shared/services/toast.service';

type ColorIcono = 'siif' | 'personal' | 'generic';

interface EnlaceModulo {
  ruta: string;
  queryParams?: Record<string, string | number>;
  icono: string;
  color: ColorIcono;
  titulo: string;
  descripcion: string;
}

interface GrupoModulo {
  titulo: string;
  enlaces: EnlaceModulo[];
}

const GRUPOS: GrupoModulo[] = [
  {
    titulo: 'WikiDocs',
    enlaces: [
      {
        ruta: 'documentos',
        icono: '📚',
        color: 'siif',
        titulo: 'Documentos',
        descripcion: 'Todas las páginas de documentación, con adjuntos y descarga en HTML.',
      },
      {
        ruta: 'documentos',
        queryParams: { soloFavoritos: 1 },
        icono: '⭐',
        color: 'siif',
        titulo: 'Favoritos',
        descripcion: 'Tus documentos marcados como favoritos.',
      },
      {
        ruta: 'mapa-trazabilidad',
        icono: '🕸️',
        color: 'siif',
        titulo: 'Mapa de trazabilidad',
        descripcion: 'Explora visualmente las relaciones de un documento con tablas, procesos, módulos y otros documentos.',
      },
    ],
  },
  {
    titulo: 'Catálogos',
    enlaces: [
      {
        ruta: 'tipos-sistema',
        icono: '🗂️',
        color: 'generic',
        titulo: 'Tipo de sistema',
        descripcion: 'Espacios de trabajo raíz de la jerarquía documental (ej. Interno, Cliente).',
      },
      {
        ruta: 'categorias',
        icono: '📖',
        color: 'generic',
        titulo: 'Categoría',
        descripcion: 'Categorías de cada tipo de sistema, para organizar sus secciones.',
      },
      {
        ruta: 'secciones',
        icono: '📑',
        color: 'generic',
        titulo: 'Secciones',
        descripcion: 'Secciones de cada categoría — de aquí cuelgan los documentos.',
      },
      {
        ruta: 'plantillas',
        icono: '🧩',
        color: 'generic',
        titulo: 'Plantillas',
        descripcion: 'Contenido de partida reutilizable al crear un documento nuevo.',
      },
    ],
  },
];

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
 * Landing propia de WikiDocs — mismo patrón que ProyectosLandingComponent,
 * ahora ampliada con el Dashboard pedido en el mandato "Evolución de
 * WikiDocs: Dashboard y Mapa de trazabilidad" (nov-2026): indicadores,
 * distribución por sistema/categoría, últimos documentos actualizados y
 * favoritos recientes, todo calculado server-side vía 5 funciones RPC
 * ligeras (`fn_dashboard_resumen`, `fn_dashboard_distribucion_sistema`,
 * `fn_dashboard_distribucion_categoria`, `fn_dashboard_favoritos_recientes`
 * y la ya existente `fn_documentos_lista_pagina`) — mismo patrón de
 * carga ya usado en `DashboardVentasComponent`. Ninguna de las 5 descarga
 * `contenido` ni hace polling; los catálogos (Tipo de sistema/Categoría/
 * Secciones) nunca se pagina, así que sus distribuciones se traen
 * completas. Los "Accesos rápidos" (antes el único contenido de esta
 * ventana) se conservan tal cual, con 2 tiles nuevos (Favoritos, Mapa de
 * trazabilidad).
 *
 * Corrección funcional 02 al Mandato 89 (nov-2026): se restaura el orden
 * original de bloques en el HTML (menús WikiDocs/Catálogos primero,
 * Dashboard debajo — ver `git show 5e17ce9`, el commit que intercaló el
 * Dashboard ENTRE el encabezado y los menús en vez de agregarlo después) y
 * se agrega `data-wide='grid'` en `ngOnInit`/`ngOnDestroy`, el mismo
 * mecanismo ya homologado en otros Dashboards de Saurix (p.ej.
 * `ProyectosDashboardComponent`, `InventarioDashboardComponent`) para
 * ensanchar `.content` (980px a 1600px, regla ya existente en styles.scss).
 * Sin esto, las 2 tablas de cada `.dashboard-columnas-2` (cada `.grid-table`
 * con `min-width:560px` global) no cabían en los 980px por defecto y cada
 * `.grid-table-scroll` activaba su propio scroll horizontal, de ahí las
 * barras de desplazamiento innecesarias y el espacio lateral desaprovechado
 * reportados. No se tocó ningún CSS global ni se creó ninguna regla nueva:
 * solo se reutiliza el atributo `data-wide` que ya existe en styles.scss,
 * exactamente como lo hacen los demás módulos.
 */
@Component({
  selector: 'app-wikidocs-landing',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './wikidocs-landing.component.html',
  styleUrl: './wikidocs-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WikidocsLandingComponent implements OnInit, OnDestroy {
  private readonly sb = inject(SupabaseService).cliente;
  private readonly toast = inject(ToastService);

  protected readonly grupos = GRUPOS;

  protected readonly cargandoResumen = signal(true);
  protected readonly resumen = signal<ResumenDashboard | null>(null);
  protected readonly distribucionSistema = signal<DistribucionSistemaFila[]>([]);
  protected readonly distribucionCategoria = signal<DistribucionCategoriaFila[]>([]);
  protected readonly ultimosActualizados = signal<DocumentoReciente[]>([]);
  protected readonly favoritosRecientes = signal<FavoritoReciente[]>([]);

  ngOnInit(): void {
    // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss) —
    // Corrección 02 al Mandato 89: mismo patrón ya usado en los Dashboards
    // de Proyectos e Inventario, para que las 2 tablas de distribución no
    // fuercen su propio scroll horizontal dentro de un `.content` angosto.
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
