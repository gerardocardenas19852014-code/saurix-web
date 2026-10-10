import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { MiembroFamilia } from '../miembro-familia.model';
import { ParienteReferencia } from '../pariente-referencia.model';
import { calcularEdad } from '../familia.util';
import { colorAvatar, iniciales } from '../../proyectos/kanban/avatar.util';

const ENTIDAD_MIEMBRO = 'MiembroFamilia';
const ENTIDAD_PARIENTE_REFERENCIA = 'ParienteReferencia';

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
 *
 * Además de los MiembroFamilia reales, cada persona del árbol puede tener
 * "familiares de referencia" (ParienteReferencia) colgados: parientes sin
 * ficha completa (típicamente ya fallecidos, o externos) que solo sirven
 * para completar el árbol visualmente — no entran al cálculo recursivo de
 * arriba, se muestran como chips debajo de la pareja correspondiente.
 */
@Component({
  selector: 'app-arbol-familiar',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, ReactiveFormsModule, ConfirmDialogComponent],
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
  private readonly fb = inject(FormBuilder);
  protected readonly toast = inject(ToastService);

  protected readonly colorAvatar = colorAvatar;
  protected readonly iniciales = iniciales;
  protected readonly calcularEdad = calcularEdad;

  protected readonly miembros = signal<MiembroFamilia[]>([]);
  protected readonly parientesReferencia = signal<ParienteReferencia[]>([]);
  protected readonly cargando = signal(false);

  protected nombreCompleto(m: MiembroFamilia): string {
    return [m.nombre, m.apellidoPaterno, m.apellidoMaterno].filter(Boolean).join(' ');
  }

  /** Familiares de referencia de un miembro puntual, para pintarlos como
   *  chips debajo de su nodo en el árbol. */
  protected referenciasDe(miembroId: number): ParienteReferencia[] {
    return this.parientesReferencia()
      .filter((p) => p.activo !== false && Number(p.miembroFamiliaId) === Number(miembroId))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-MX'));
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
    this.cargarReferencias();
  }

  private cargarReferencias(): void {
    this.data.list<ParienteReferencia>(ENTIDAD_PARIENTE_REFERENCIA).subscribe({
      next: (p) => this.parientesReferencia.set(p),
      error: () => this.parientesReferencia.set([]),
    });
  }

  // ── Nuevo / editar familiar de referencia ────────────────────────────
  protected readonly modalAbierto = signal(false);
  protected readonly enEdicion = signal<ParienteReferencia | null>(null);
  protected readonly aEliminar = signal<ParienteReferencia | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    miembroFamiliaId: [0, Validators.required],
    nombre: ['', Validators.required],
    parentesco: ['', Validators.required],
    fechaNacimiento: [''],
    fallecido: [false],
    fechaFallecimiento: [''],
    notas: [''],
    activo: [true],
  });

  /** Abre el modal ya listo para agregar un familiar de referencia de ese
   *  miembro puntual — se llama desde el botón "+" que aparece junto a cada
   *  persona del árbol. */
  nuevoPara(miembroId: number): void {
    this.enEdicion.set(null);
    this.form.reset({
      id: 0,
      miembroFamiliaId: miembroId,
      nombre: '',
      parentesco: '',
      fechaNacimiento: '',
      fallecido: false,
      fechaFallecimiento: '',
      notas: '',
      activo: true,
    });
    this.modalAbierto.set(true);
  }

  editar(p: ParienteReferencia): void {
    this.enEdicion.set(p);
    this.form.reset({ ...p });
    this.modalAbierto.set(true);
  }

  cerrarModal(): void {
    this.toast.info('Cambios descartados.');
    this.modalAbierto.set(false);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error('Captura al menos el nombre y el parentesco.');
      return;
    }
    const valor = this.form.getRawValue();
    const esEdicion = this.enEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<ParienteReferencia>(ENTIDAD_PARIENTE_REFERENCIA, valor)
      : this.data.alta<ParienteReferencia>(ENTIDAD_PARIENTE_REFERENCIA, valor);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Familiar actualizado.' : 'Familiar agregado al árbol.');
        this.modalAbierto.set(false);
        this.cargarReferencias();
      },
      error: () => this.toast.error('No se pudo guardar. Intenta de nuevo.'),
    });
  }

  pedirEliminar(p: ParienteReferencia): void {
    this.aEliminar.set(p);
  }

  confirmarEliminar(): void {
    const p = this.aEliminar();
    if (!p) return;
    this.data.baja(ENTIDAD_PARIENTE_REFERENCIA, p.id).subscribe({
      next: () => {
        this.toast.exito('Familiar eliminado del árbol.');
        this.aEliminar.set(null);
        this.cargarReferencias();
      },
      error: () => this.toast.error('No se pudo eliminar. Intenta de nuevo.'),
    });
  }
}
