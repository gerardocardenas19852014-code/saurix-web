import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DataClientService } from '../../../core/services/data-client.service';
import { MiembroFamilia } from '../miembro-familia.model';
import { calcularEdad } from '../familia.util';
import { colorAvatar, iniciales } from '../../proyectos/kanban/avatar.util';

const ENTIDAD_MIEMBRO = 'MiembroFamilia';

/** Un nodo del árbol: una persona, su cónyuge (si tiene) y sus hijos ya
 *  construidos recursivamente — ver construirArbol() más abajo. */
interface NodoArbol {
  persona: MiembroFamilia;
  conyuge: MiembroFamilia | null;
  hijos: NodoArbol[];
}

/**
 * Árbol genealógico visual, construido a partir de padreId/madreId/
 * conyugeId de cada MiembroFamilia (ver miembro-familia.model.ts y la
 * sub-pestaña "Relaciones" en miembros.component.ts, donde se capturan).
 *
 * Es un cálculo heurístico, no una jerarquía estricta de base de datos: una
 * "raíz" es cualquier miembro sin padre ni madre capturados. Si esa raíz
 * tiene cónyuge, se dibujan juntos como pareja y los hijos de cualquiera de
 * los dos cuelgan de esa pareja. Un miembro ya dibujado (como cónyuge de
 * alguien, o como hijo de una rama) no se vuelve a dibujar en otra rama —
 * por eso el orden en que se recorren las raíces puede decidir en qué rama
 * aparece alguien con relaciones capturadas por ambos lados; quien no
 * quede conectado a ninguna raíz (relación incompleta, o ciclo) cae en
 * "Sin relación capturada" al final, para que nadie desaparezca del todo.
 */
@Component({
  selector: 'app-arbol-familiar',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './arbol-familiar.component.html',
  styleUrl: './arbol-familiar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArbolFamiliarComponent implements OnInit {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);

  protected readonly colorAvatar = colorAvatar;
  protected readonly iniciales = iniciales;
  protected readonly calcularEdad = calcularEdad;

  protected readonly miembros = signal<MiembroFamilia[]>([]);
  protected readonly cargando = signal(false);

  protected nombreCompleto(m: MiembroFamilia): string {
    return [m.nombre, m.apellidoPaterno, m.apellidoMaterno].filter(Boolean).join(' ');
  }

  private construirArbol(miembros: MiembroFamilia[]): { raices: NodoArbol[]; sueltos: MiembroFamilia[] } {
    const porId = new Map(miembros.map((m) => [Number(m.id), m]));
    const visitados = new Set<number>();

    const hijosDe = (id: number, conyugeId: number | null): MiembroFamilia[] =>
      miembros
        .filter(
          (m) =>
            !visitados.has(Number(m.id)) &&
            (Number(m.padreId) === id ||
              Number(m.madreId) === id ||
              (conyugeId != null && (Number(m.padreId) === conyugeId || Number(m.madreId) === conyugeId))),
        )
        .sort((a, b) => (a.fechaNacimiento || '').localeCompare(b.fechaNacimiento || ''));

    const construirNodo = (persona: MiembroFamilia): NodoArbol => {
      visitados.add(Number(persona.id));
      const conyuge = persona.conyugeId ? (porId.get(Number(persona.conyugeId)) ?? null) : null;
      if (conyuge) visitados.add(Number(conyuge.id));
      const hijos = hijosDe(Number(persona.id), conyuge ? Number(conyuge.id) : null).map((h) => construirNodo(h));
      return { persona, conyuge, hijos };
    };

    const candidatasRaiz = miembros
      .filter((m) => !m.padreId && !m.madreId)
      .sort((a, b) => (a.fechaNacimiento || '').localeCompare(b.fechaNacimiento || ''));

    const raices: NodoArbol[] = [];
    for (const candidata of candidatasRaiz) {
      if (visitados.has(Number(candidata.id))) continue; // ya quedó como cónyuge de otra raíz
      raices.push(construirNodo(candidata));
    }

    const sueltos = miembros.filter((m) => !visitados.has(Number(m.id)));
    return { raices, sueltos };
  }

  protected readonly arbol = computed(() => this.construirArbol(this.miembros().filter((m) => m.activo !== false)));

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargando.set(true);
    this.data.list<MiembroFamilia>(ENTIDAD_MIEMBRO).subscribe({
      next: (m) => {
        this.miembros.set(m);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
