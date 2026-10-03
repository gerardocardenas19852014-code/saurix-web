import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService } from '../../../../core/services/data-client.service';
import { IndexedDbEngineService } from '../../../../core/services/indexeddb-engine.service';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../../shared/services/toast.service';
import {
  CampoOportunidadConfigurable,
  ConfiguracionCamposOportunidad,
  OPORTUNIDAD_CAMPOS_CONFIGURABLES,
  OPORTUNIDAD_ETAPAS_SEED,
  OportunidadEtapaConfig,
  PosicionDiagramaOportunidad,
  ReglaCampoOportunidad,
  parsearConfiguracionCamposOportunidad,
  parsearPosicionDiagramaOportunidad,
  parsearTransicionesPermitidasOportunidad,
  reglaCampoOportunidad,
} from '../oportunidad-etapa.model';

interface OportunidadOpcion {
  id: number;
  etapaId: number;
}

/**
 * Administra las etapas del pipeline de Oportunidades ("Gestor de Etapas",
 * CRM → Catálogos) — calcado de `TablerosComponent` (Gestión de Proyectos →
 * Gestor de Estados), adaptado a Oportunidad: no hay un "proyecto" padre (el
 * pipeline es uno solo), y las antiguas etapas fijas 'Ganada'/'Perdida' del
 * enum que este Gestor reemplaza ahora son dos banderas (`esGanada`/
 * `esPerdida`) que se pueden poner en cualquier etapa.
 *
 * Si el catálogo de etapas está vacío (primera vez que se abre esta
 * pantalla, o base de datos nueva) se siembran automáticamente las 6 etapas
 * originales — ver sembrarSiVacio() — para que una base ya en uso no
 * "pierda" sus columnas del pipeline de la noche a la mañana al pasar del
 * enum fijo a este catálogo editable.
 */
@Component({
  selector: 'app-gestor-etapas',
  standalone: true,
  imports: [ReactiveFormsModule, ConfirmDialogComponent],
  templateUrl: './gestor-etapas.component.html',
  styleUrl: './gestor-etapas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GestorEtapasComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly engine = inject(IndexedDbEngineService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly etapas = signal<OportunidadEtapaConfig[]>([]);
  protected readonly oportunidades = signal<OportunidadOpcion[]>([]);
  protected readonly cargando = signal(false);

  protected readonly conteoPorEtapa = computed(() => {
    const mapa = new Map<number, number>();
    for (const op of this.oportunidades()) {
      mapa.set(op.etapaId, (mapa.get(op.etapaId) ?? 0) + 1);
    }
    return mapa;
  });

  protected readonly modalAbierto = signal(false);
  protected readonly etapaEnEdicion = signal<OportunidadEtapaConfig | null>(null);
  protected readonly etapaAEliminar = signal<OportunidadEtapaConfig | null>(null);

  /** "☰ Lista" (la tabla de siempre) vs "🔀 Diagrama de flujo" (cajas + flechas, estilo Jira). */
  protected readonly vistaGestor = signal<'lista' | 'diagrama'>('lista');

  /** "⚙ Campos" — configura, por etapa, qué campos de la oportunidad son editables/obligatorios en esa etapa. */
  protected readonly camposConfigurables = OPORTUNIDAD_CAMPOS_CONFIGURABLES;
  protected readonly etapaCamposEnEdicion = signal<OportunidadEtapaConfig | null>(null);
  protected readonly configuracionCamposEdit = signal<ConfiguracionCamposOportunidad>({});

  /** "🔀 Flujo" — restringe, por etapa, a qué otras etapas se puede mover una oportunidad
   *  (arrastrándola en el tablero). `null` = sin restricción (se puede mover a cualquiera). */
  protected readonly etapaFlujoEnEdicion = signal<OportunidadEtapaConfig | null>(null);
  protected readonly transicionesEdit = signal<Set<number> | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    clave: ['', Validators.required],
    nombre: ['', Validators.required],
    orden: [1, Validators.required],
    esGanada: [false],
    esPerdida: [false],
  });

  ngOnInit(): void {
    this.cargar();
  }

  /** Siembra las 6 etapas originales (antes el enum fijo OportunidadEtapa) la primera vez
   *  que este catálogo está vacío, y recién entonces recarga la lista mostrada. */
  private sembrarSiVacioYRecargar(): void {
    this.engine.seedSiVacio('OportunidadEtapaConfig', OPORTUNIDAD_ETAPAS_SEED).then(() => {
      this.data.list<OportunidadEtapaConfig>('OportunidadEtapaConfig').subscribe({
        next: (etapas) => {
          this.etapas.set(etapas.sort((a, b) => a.orden - b.orden));
          this.sincronizarPosiciones();
          this.cargando.set(false);
        },
        error: () => this.cargando.set(false),
      });
    });
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<OportunidadEtapaConfig>('OportunidadEtapaConfig').subscribe({
      next: (etapas) => {
        if (!etapas.length) {
          this.sembrarSiVacioYRecargar();
          return;
        }
        this.etapas.set(etapas.sort((a, b) => a.orden - b.orden));
        this.sincronizarPosiciones();
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
    this.data.list<OportunidadOpcion>('Oportunidad').subscribe((oportunidades) => this.oportunidades.set(oportunidades));
  }

  cambiarVistaGestor(vista: 'lista' | 'diagrama'): void {
    this.vistaGestor.set(vista);
  }

  nueva(): void {
    this.etapaEnEdicion.set(null);
    const siguienteOrden = this.etapas().length + 1;
    this.form.reset({ id: 0, clave: '', nombre: '', orden: siguienteOrden, esGanada: false, esPerdida: false });
    this.modalAbierto.set(true);
  }

  editar(etapa: OportunidadEtapaConfig): void {
    this.etapaEnEdicion.set(etapa);
    this.form.reset({
      id: etapa.id,
      clave: etapa.clave,
      nombre: etapa.nombre,
      orden: etapa.orden,
      esGanada: etapa.esGanada,
      esPerdida: etapa.esPerdida,
    });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const existente = this.etapaEnEdicion();
    const payload = {
      ...valor,
      configuracionCamposJson: existente?.configuracionCamposJson ?? null,
      transicionesPermitidasJson: existente?.transicionesPermitidasJson ?? null,
      posicionDiagramaJson: existente?.posicionDiagramaJson ?? null,
      activo: existente?.activo ?? true,
    };

    const esEdicion = existente !== null;
    const peticion = esEdicion
      ? this.data.modificacion<OportunidadEtapaConfig>('OportunidadEtapaConfig', payload)
      : this.data.alta<OportunidadEtapaConfig>('OportunidadEtapaConfig', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Etapa actualizada.' : 'Etapa creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  /** Intercambia el `orden` de una etapa con el de su vecina (▲ -1 / ▼ +1) y recarga.
   *  Son dos escrituras independientes (el motor de datos no tiene transacciones) — si la
   *  segunda falla después de que la primera ya se aplicó, las dos etapas quedarían con
   *  el mismo `orden`; por eso ambas tienen manejo de error, que avisa y recarga para que la
   *  lista siempre refleje el estado real de la base en vez de quedarse con datos viejos. */
  moverOrden(etapa: OportunidadEtapaConfig, direccion: -1 | 1): void {
    const etapas = this.etapas();
    const indiceActual = etapas.findIndex((e) => e.id === etapa.id);
    const indiceDestino = indiceActual + direccion;
    if (indiceActual === -1 || indiceDestino < 0 || indiceDestino >= etapas.length) return;

    const vecina = etapas[indiceDestino];
    const avisarErrorYRecargar = () => {
      this.toast.error('No se pudo reordenar la etapa. Intenta de nuevo.');
      this.cargar();
    };
    this.data.modificacion<OportunidadEtapaConfig>('OportunidadEtapaConfig', { ...etapa, orden: vecina.orden }).subscribe({
      next: () => {
        this.data.modificacion<OportunidadEtapaConfig>('OportunidadEtapaConfig', { ...vecina, orden: etapa.orden }).subscribe({
          next: () => this.cargar(),
          error: avisarErrorYRecargar,
        });
      },
      error: avisarErrorYRecargar,
    });
  }

  pedirEliminar(etapa: OportunidadEtapaConfig): void {
    // IndexedDB no valida integridad referencial: si se borra una etapa con
    // oportunidades adentro, esas oportunidades quedan con un etapaId que ya
    // no existe y desaparecen del tablero (y de cualquier otra vista) sin aviso.
    const enUso = this.conteoPorEtapa().get(etapa.id) ?? 0;
    if (enUso > 0) {
      this.toast.advertencia(
        `No se puede eliminar: hay ${enUso} oportunidad${enUso === 1 ? '' : 'es'} en esta etapa. Muévelas primero a otra etapa.`,
      );
      return;
    }
    this.etapaAEliminar.set(etapa);
  }

  confirmarEliminar(): void {
    const etapa = this.etapaAEliminar();
    if (!etapa) return;

    this.data.baja('OportunidadEtapaConfig', etapa.id).subscribe({
      next: () => {
        this.toast.exito('Etapa eliminada.');
        this.etapaAEliminar.set(null);
        this.cargar();
      },
    });
  }

  // ---------------- "⚙ Campos" (ConfiguracionCamposJson por etapa) ----------------

  abrirCampos(etapa: OportunidadEtapaConfig): void {
    this.etapaCamposEnEdicion.set(etapa);
    this.configuracionCamposEdit.set(parsearConfiguracionCamposOportunidad(etapa.configuracionCamposJson));
  }

  cerrarCampos(): void {
    this.etapaCamposEnEdicion.set(null);
  }

  cancelarCampos(): void {
    this.toast.info('Cambios descartados.');
    this.cerrarCampos();
  }

  reglaDe(campo: CampoOportunidadConfigurable): ReglaCampoOportunidad {
    return reglaCampoOportunidad(this.configuracionCamposEdit(), campo);
  }

  toggleEditable(campo: CampoOportunidadConfigurable, marcado: boolean): void {
    this.configuracionCamposEdit.update((cfg) => {
      const actual = reglaCampoOportunidad(cfg, campo);
      // Si se desmarca "editable", no tiene sentido dejarlo "obligatorio" a la vez.
      return { ...cfg, [campo]: { editable: marcado, obligatorio: marcado ? actual.obligatorio : false } };
    });
  }

  toggleObligatorio(campo: CampoOportunidadConfigurable, marcado: boolean): void {
    this.configuracionCamposEdit.update((cfg) => ({ ...cfg, [campo]: { editable: true, obligatorio: marcado } }));
  }

  guardarCampos(): void {
    const etapa = this.etapaCamposEnEdicion();
    if (!etapa) return;

    const configuracionCamposJson = JSON.stringify(this.configuracionCamposEdit());
    this.data.modificacion<OportunidadEtapaConfig>('OportunidadEtapaConfig', { ...etapa, configuracionCamposJson }).subscribe({
      next: () => {
        this.toast.exito('Configuración de campos guardada.');
        this.cerrarCampos();
        this.cargar();
      },
    });
  }

  // ---------------- "🔀 Flujo" (TransicionesPermitidasJson por etapa) ----------------

  /** Las demás etapas del pipeline — candidatas a ser destino permitido desde `etapa`. */
  otrasEtapas(etapa: OportunidadEtapaConfig): OportunidadEtapaConfig[] {
    return this.etapas().filter((e) => e.id !== etapa.id);
  }

  abrirFlujo(etapa: OportunidadEtapaConfig): void {
    this.etapaFlujoEnEdicion.set(etapa);
    const permitidas = parsearTransicionesPermitidasOportunidad(etapa.transicionesPermitidasJson);
    this.transicionesEdit.set(permitidas === null ? null : new Set(permitidas));
  }

  cerrarFlujo(): void {
    this.etapaFlujoEnEdicion.set(null);
  }

  cancelarFlujo(): void {
    this.toast.info('Cambios descartados.');
    this.cerrarFlujo();
  }

  /** Activa/desactiva la restricción: sin restricción (null) ↔ un set (vacío al activarla). */
  activarRestriccion(activar: boolean): void {
    this.transicionesEdit.set(activar ? new Set<number>() : null);
  }

  toggleTransicion(etapaId: number, marcado: boolean): void {
    this.transicionesEdit.update((set) => {
      const nuevo = new Set(set ?? []);
      if (marcado) {
        nuevo.add(etapaId);
      } else {
        nuevo.delete(etapaId);
      }
      return nuevo;
    });
  }

  guardarFlujo(): void {
    const etapa = this.etapaFlujoEnEdicion();
    if (!etapa) return;

    const set = this.transicionesEdit();
    const transicionesPermitidasJson = set === null ? null : JSON.stringify(Array.from(set));
    this.data.modificacion<OportunidadEtapaConfig>('OportunidadEtapaConfig', { ...etapa, transicionesPermitidasJson }).subscribe({
      next: () => {
        this.toast.exito('Flujo de etapa guardado.');
        this.cerrarFlujo();
        this.cargar();
      },
    });
  }

  // ---------------- "🔀 Diagrama de flujo" (cajas arrastrables + flechas, estilo Jira) ----------------

  /** Tamaño fijo de cada caja del diagrama, usado tanto para dibujarlas como para calcular
   *  dónde una flecha debe "salir"/"entrar" en el borde del rectángulo (ver puntoEnBorde). */
  protected readonly ANCHO_CAJA = 168;
  protected readonly ALTO_CAJA = 56;

  protected readonly posiciones = signal<Map<number, PosicionDiagramaOportunidad>>(new Map());
  protected readonly modoAgregarTransicion = signal(false);
  protected readonly origenTransicion = signal<OportunidadEtapaConfig | null>(null);
  private arrastre: { etapaId: number; offsetX: number; offsetY: number } | null = null;

  /** Tamaño mínimo del lienzo — generoso a propósito para que el área de trabajo se sienta
   *  amplia desde el principio y no solo del tamaño justo de las cajas actuales. */
  protected readonly anchoLienzo = computed(() => {
    let max = 1400;
    for (const pos of this.posiciones().values()) max = Math.max(max, pos.x + this.ANCHO_CAJA + 80);
    return max;
  });

  protected readonly altoLienzo = computed(() => {
    let max = 640;
    for (const pos of this.posiciones().values()) max = Math.max(max, pos.y + this.ALTO_CAJA + 80);
    return max;
  });

  /** Una línea con flecha por cada transición permitida (etapas SIN restricción configurada
   *  no dibujan flechas — mostrarlas todas contra todas ensuciaría el diagrama; se marcan con
   *  el candado 🔓 en su caja en su lugar). */
  protected readonly lineasTransicion = computed(() => {
    const etapas = this.etapas();
    const posiciones = this.posiciones();
    const lineas: { origenId: number; destinoId: number; path: string }[] = [];
    for (const etapa of etapas) {
      const permitidas = parsearTransicionesPermitidasOportunidad(etapa.transicionesPermitidasJson);
      if (permitidas === null) continue;
      const origenPos = posiciones.get(etapa.id);
      if (!origenPos) continue;
      for (const destinoId of permitidas) {
        const destino = etapas.find((e) => Number(e.id) === Number(destinoId));
        const destinoPos = destino ? posiciones.get(destino.id) : undefined;
        if (!destino || !destinoPos) continue;
        lineas.push({ origenId: etapa.id, destinoId: destino.id, path: this.calcularPath(origenPos, destinoPos) });
      }
    }
    return lineas;
  });

  /** Recalcula el mapa de posiciones: usa la guardada (posicionDiagramaJson) cuando existe, o
   *  si no, una cuadrícula automática de 5 columnas — se llama cada vez que cargar() trae
   *  etapas nuevas, para que una etapa recién creada aparezca en un lugar razonable. */
  private sincronizarPosiciones(): void {
    const mapa = new Map<number, PosicionDiagramaOportunidad>();
    this.etapas().forEach((etapa, indice) => {
      const guardada = parsearPosicionDiagramaOportunidad(etapa.posicionDiagramaJson);
      const fila = Math.floor(indice / 5);
      const col = indice % 5;
      mapa.set(etapa.id, guardada ?? { x: 50 + col * (this.ANCHO_CAJA + 90), y: 50 + fila * (this.ALTO_CAJA + 110) });
    });
    this.posiciones.set(mapa);
  }

  posicionDe(etapaId: number): PosicionDiagramaOportunidad {
    return this.posiciones().get(etapaId) ?? { x: 0, y: 0 };
  }

  esRestringida(etapa: OportunidadEtapaConfig): boolean {
    return parsearTransicionesPermitidasOportunidad(etapa.transicionesPermitidasJson) !== null;
  }

  toggleModoTransicion(): void {
    this.modoAgregarTransicion.update((v) => !v);
    this.origenTransicion.set(null);
  }

  /** Clic en una caja: fuera del modo "+ Agregar transición" no hace nada (arrastrar ya se
   *  maneja en onCajaMouseDown/onDiagramaMouseMove). Dentro del modo, el primer clic marca el
   *  origen y el segundo (en otra caja) crea la transición; clic de nuevo en la misma cancela. */
  onCajaClick(etapa: OportunidadEtapaConfig): void {
    if (!this.modoAgregarTransicion()) return;
    const origen = this.origenTransicion();
    if (!origen) {
      this.origenTransicion.set(etapa);
      return;
    }
    if (Number(origen.id) === Number(etapa.id)) {
      this.origenTransicion.set(null);
      return;
    }
    this.agregarTransicion(origen, etapa);
    this.origenTransicion.set(null);
  }

  onCajaMouseDown(evento: MouseEvent, etapa: OportunidadEtapaConfig): void {
    if (this.modoAgregarTransicion()) return;
    evento.preventDefault();
    const pos = this.posicionDe(etapa.id);
    this.arrastre = { etapaId: etapa.id, offsetX: evento.clientX - pos.x, offsetY: evento.clientY - pos.y };
  }

  onDiagramaMouseMove(evento: MouseEvent): void {
    if (!this.arrastre) return;
    const { etapaId, offsetX, offsetY } = this.arrastre;
    const x = Math.max(0, evento.clientX - offsetX);
    const y = Math.max(0, evento.clientY - offsetY);
    this.posiciones.update((mapa) => {
      const nuevo = new Map(mapa);
      nuevo.set(etapaId, { x, y });
      return nuevo;
    });
  }

  /** Al soltar, persiste la posición final — mientras se arrastra solo se actualiza el signal
   *  en memoria (onDiagramaMouseMove) para que se sienta fluido sin pegarle a la BD en cada pixel. */
  onDiagramaMouseUp(): void {
    if (!this.arrastre) return;
    const etapaId = this.arrastre.etapaId;
    this.arrastre = null;
    const etapa = this.etapas().find((e) => e.id === etapaId);
    const posicion = this.posiciones().get(etapaId);
    if (!etapa || !posicion) return;
    const posicionDiagramaJson = JSON.stringify(posicion);
    this.data.modificacion<OportunidadEtapaConfig>('OportunidadEtapaConfig', { ...etapa, posicionDiagramaJson }).subscribe({
      error: () => this.toast.error('No se pudo guardar la posición de la etapa.'),
    });
  }

  /** El candado 🔓/🔒 de la caja: activa/desactiva la restricción de flujo directo desde el
   *  diagrama (mismo dato que el checklist "🔀 Flujo" — al activarla empieza sin transiciones
   *  permitidas, igual que activarRestriccion() en ese modal). */
  toggleRestriccionDiagrama(etapa: OportunidadEtapaConfig): void {
    const restringidaActual = this.esRestringida(etapa);
    const transicionesPermitidasJson = restringidaActual ? null : JSON.stringify([]);
    this.data.modificacion<OportunidadEtapaConfig>('OportunidadEtapaConfig', { ...etapa, transicionesPermitidasJson }).subscribe({
      next: () => {
        this.toast.exito(
          restringidaActual
            ? `"${etapa.nombre}" ya se puede mover a cualquier etapa.`
            : `"${etapa.nombre}" restringida — dibuja flechas para permitir transiciones.`,
        );
        this.cargar();
      },
      error: () => this.toast.error('No se pudo actualizar la restricción.'),
    });
  }

  private agregarTransicion(origen: OportunidadEtapaConfig, destino: OportunidadEtapaConfig): void {
    const actuales = parsearTransicionesPermitidasOportunidad(origen.transicionesPermitidasJson);
    if (actuales === null) {
      this.toast.advertencia(
        `"${origen.nombre}" no tiene restricciones — ya se puede mover a "${destino.nombre}". Actívale el candado 🔒 primero si quieres limitarla.`,
      );
      return;
    }
    if (actuales.includes(Number(destino.id))) return;
    const transicionesPermitidasJson = JSON.stringify([...actuales, Number(destino.id)]);
    this.data.modificacion<OportunidadEtapaConfig>('OportunidadEtapaConfig', { ...origen, transicionesPermitidasJson }).subscribe({
      next: () => {
        this.toast.exito(`Transición agregada: ${origen.nombre} → ${destino.nombre}.`);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo agregar la transición.'),
    });
  }

  /** Clic en una flecha del diagrama para eliminarla. */
  quitarTransicion(origenId: number, destinoId: number): void {
    const origen = this.etapas().find((e) => Number(e.id) === Number(origenId));
    if (!origen) return;
    const actuales = parsearTransicionesPermitidasOportunidad(origen.transicionesPermitidasJson) ?? [];
    const transicionesPermitidasJson = JSON.stringify(actuales.filter((id) => Number(id) !== Number(destinoId)));
    this.data.modificacion<OportunidadEtapaConfig>('OportunidadEtapaConfig', { ...origen, transicionesPermitidasJson }).subscribe({
      next: () => {
        this.toast.info('Transición eliminada.');
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar la transición.'),
    });
  }

  private calcularPath(origen: PosicionDiagramaOportunidad, destino: PosicionDiagramaOportunidad): string {
    const cx1 = origen.x + this.ANCHO_CAJA / 2;
    const cy1 = origen.y + this.ALTO_CAJA / 2;
    const cx2 = destino.x + this.ANCHO_CAJA / 2;
    const cy2 = destino.y + this.ALTO_CAJA / 2;
    const p1 = this.puntoEnBorde(cx1, cy1, cx2, cy2);
    const p2 = this.puntoEnBorde(cx2, cy2, cx1, cy1);
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  }

  /** Punto donde la línea entre (cx,cy) y (haciaX,haciaY) sale del rectángulo de la caja
   *  centrado en (cx,cy) — así la flecha nace y termina en el borde de la caja, no en su centro. */
  private puntoEnBorde(cx: number, cy: number, haciaX: number, haciaY: number): PosicionDiagramaOportunidad {
    const dx = haciaX - cx;
    const dy = haciaY - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const hw = this.ANCHO_CAJA / 2;
    const hh = this.ALTO_CAJA / 2;
    const escalaX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const escalaY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const escala = Math.min(escalaX, escalaY);
    return { x: cx + dx * escala, y: cy + dy * escala };
  }
}
