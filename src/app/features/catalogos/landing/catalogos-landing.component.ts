import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type ColorIcono = 'siif' | 'personal' | 'generic';

interface EnlaceCatalogo {
  ruta: string;
  icono: string;
  color: ColorIcono;
  titulo: string;
  descripcion: string;
  grupo: string;
}

const GRUPO_ICONOS: Record<string, string> = {
  General: '🧩',
  'Presupuesto Personal': '💰',
  'Gestión de Proyectos': '📋',
};

// Los catálogos de WikiDocs (Tipo de sistema, Categoría, Secciones) viven
// dentro del propio módulo WikiDocs.
const CATALOGOS: EnlaceCatalogo[] = [
  {
    ruta: 'listas-valores',
    icono: '🧩',
    color: 'generic',
    titulo: 'Listas de valores',
    descripcion: 'Combos de tipo/estado usados por otras pantallas (tipo de cuenta, tipo de movimiento, frecuencia, proveedor de conexión, etc.), 100% configurables.',
    grupo: 'General',
  },
  {
    ruta: 'categorias-presupuesto',
    icono: '🏷️',
    color: 'personal',
    titulo: 'Categorías de presupuesto',
    descripcion: 'Categorías de ingreso/gasto, con subcategorías a 2 niveles.',
    grupo: 'Presupuesto Personal',
  },
  {
    ruta: 'cuentas-presupuesto',
    icono: '🏦',
    color: 'personal',
    titulo: 'Cuentas de presupuesto',
    descripcion: 'Efectivo, banco, tarjeta y ahorro; para tarjetas incluye límite y fechas de corte/pago.',
    grupo: 'Presupuesto Personal',
  },
  {
    ruta: 'tipos-ticket',
    icono: '🏳️',
    color: 'generic',
    titulo: 'Tipos de ticket',
    descripcion: 'Clasificación de tickets (incidencia, requerimiento, mejora, etc.) del módulo de Gestión de Proyectos.',
    grupo: 'Gestión de Proyectos',
  },
  {
    ruta: 'prioridades',
    icono: '🚦',
    color: 'generic',
    titulo: 'Prioridades',
    descripcion: 'Niveles de prioridad de ticket con su SLA (vigencia y aviso en horas) y usuarios a notificar.',
    grupo: 'Gestión de Proyectos',
  },
  {
    ruta: 'modulos',
    icono: '🧭',
    color: 'generic',
    titulo: 'Módulos',
    descripcion: 'Módulo o área del sistema al que pertenece un ticket (Frontend, Backend, Base de datos, etc.).',
    grupo: 'Gestión de Proyectos',
  },
];

interface GrupoCatalogo {
  clave: string;
  titulo: string;
  icono: string;
  enlaces: EnlaceCatalogo[];
}

/**
 * Landing de Catálogos: buscador + lista agrupada, igual patrón que la
 * sección "§ Catálogos" del prototipo de referencia (.catalog-search,
 * .catalog-group, .catalog-list-item). Los grupos inician colapsados y
 * se auto-expanden mientras hay texto en el buscador.
 */
@Component({
  selector: 'app-catalogos-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './catalogos-landing.component.html',
  styleUrl: './catalogos-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogosLandingComponent {
  protected readonly busqueda = signal('');
  private readonly expandidosManual = signal<Record<string, boolean>>({});

  protected readonly filtrados = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    if (!texto) return CATALOGOS;
    return CATALOGOS.filter(
      (c) => c.titulo.toLowerCase().includes(texto) || c.descripcion.toLowerCase().includes(texto),
    );
  });

  protected readonly grupos = computed<GrupoCatalogo[]>(() => {
    const orden: string[] = [];
    const mapa = new Map<string, EnlaceCatalogo[]>();
    for (const enlace of this.filtrados()) {
      if (!mapa.has(enlace.grupo)) {
        orden.push(enlace.grupo);
        mapa.set(enlace.grupo, []);
      }
      mapa.get(enlace.grupo)!.push(enlace);
    }
    return orden.map((clave) => ({
      clave,
      titulo: clave,
      icono: GRUPO_ICONOS[clave] ?? '🗂️',
      enlaces: mapa.get(clave)!,
    }));
  });

  estaExpandido(grupo: GrupoCatalogo): boolean {
    const manual = this.expandidosManual()[grupo.clave];
    if (manual !== undefined) return manual;
    return this.busqueda().trim().length > 0;
  }

  alternarGrupo(clave: string): void {
    const actual = this.expandidosManual()[clave] ?? this.busqueda().trim().length > 0;
    this.expandidosManual.update((estado) => ({ ...estado, [clave]: !actual }));
  }
}
