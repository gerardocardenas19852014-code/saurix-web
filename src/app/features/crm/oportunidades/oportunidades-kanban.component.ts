import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DataClientService } from '../../../core/services/data-client.service';
import { IndexedDbEngineService } from '../../../core/services/indexeddb-engine.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ActividadesCrmComponent } from '../../../shared/components/actividades-crm/actividades-crm.component';
import { ToastService } from '../../../shared/services/toast.service';
import { Cliente } from '../../comercio/clientes/cliente.model';
import { MotivoPerdida, Oportunidad } from './oportunidad.model';
import {
  OPORTUNIDAD_CAMPOS_CONFIGURABLES,
  OPORTUNIDAD_ETAPAS_SEED,
  OportunidadEtapaConfig,
  parsearConfiguracionCamposOportunidad,
  puedeMoverAOportunidad,
  reglaCampoOportunidad,
} from './oportunidad-etapa.model';

/**
 * Pipeline de oportunidades — tablero Kanban con etapas configurables
 * (CRM → Oportunidades → Gestor de Etapas), mismo mecanismo que
 * `Proyectos.Kanban`/`TableroColumna` (ver `puedeMoverAOportunidad` y
 * `aplicarConfiguracionCampos`): movimiento entre etapas restringible por
 * flujo, y campos del formulario editables/obligatorios configurables por
 * etapa. Hasta 2026-10-02 las etapas eran un enum fijo de 6 valores y el
 * movimiento era libre en cualquier dirección — ver oportunidad-etapa.model.ts
 * para la semilla con esas mismas 6 etapas originales.
 *
 * Única regla que sigue siendo fija (no configurable): soltar/guardar una
 * oportunidad en una etapa marcada `esPerdida` exige indicar un motivo
 * (catálogo MotivoPerdida) — al arrastrar una tarjeta hasta ahí se abre el
 * modal de edición con la etapa ya puesta, en vez de moverla de una vez,
 * para pedir ese dato antes de confirmar.
 */
@Component({
  selector: 'app-oportunidades-kanban',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ConfirmDialogComponent, ActividadesCrmComponent],
  templateUrl: './oportunidades-kanban.component.html',
  styleUrl: './oportunidades-kanban.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OportunidadesKanbanComponent implements OnInit, OnDestroy {
  private readonly data = inject(DataClientService);
  private readonly engine = inject(IndexedDbEngineService);
  protected readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly etapas = signal<OportunidadEtapaConfig[]>([]);
  protected readonly mapaEtapas = computed(() => new Map(this.etapas().map((e) => [e.id, e])));

  protected readonly oportunidades = signal<Oportunidad[]>([]);
  protected readonly clientes = signal<Cliente[]>([]);
  protected readonly motivos = signal<MotivoPerdida[]>([]);
  protected readonly cargando = signal(false);

  private readonly mapaClientes = computed(() => new Map(this.clientes().map((c) => [c.id, c])));
  protected readonly mapaMotivos = computed(() => new Map(this.motivos().map((m) => [m.id, m])));

  protected readonly columnasPorEtapa = computed(() => {
    const mapa = new Map<number, Oportunidad[]>(this.etapas().map((etapa) => [etapa.id, []]));
    for (const op of this.oportunidades()) mapa.get(op.etapaId)?.push(op);
    return mapa;
  });

  /** Suma del valor estimado de las oportunidades todavía abiertas (en una etapa que no es
   *  ni esGanada ni esPerdida) — se muestra como referencia rápida arriba del tablero. */
  protected readonly totalPipelineAbierto = computed(() => {
    const mapa = this.mapaEtapas();
    return this.oportunidades()
      .filter((op) => {
        const etapa = mapa.get(op.etapaId);
        return etapa && !etapa.esGanada && !etapa.esPerdida;
      })
      .reduce((suma, op) => suma + (op.valorEstimado ?? 0), 0);
  });

  protected readonly oportunidadArrastrando = signal<Oportunidad | null>(null);

  protected readonly modalAbierto = signal(false);
  protected readonly oportunidadEnEdicion = signal<Oportunidad | null>(null);
  protected readonly oportunidadAEliminar = signal<Oportunidad | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    clienteId: [0],
    valorEstimado: [0],
    etapaId: [0],
    fechaCierreEstimada: [''],
    motivoPerdidaId: [0],
    notas: [''],
  });

  ngOnInit(): void {
    // Catálogo/listado atrapado en el ancho de lectura de 980px — usa el
    // ancho "wide" del layout para aprovechar mejor el espacio (ver
    // html[data-wide='grid'] en styles.scss, mismo patrón que Movimientos /
    // Categorías de presupuesto).
    document.documentElement.setAttribute('data-wide', 'grid');
    this.data.list<Cliente>('Cliente').subscribe((clientes) => this.clientes.set(clientes));
    this.data.list<MotivoPerdida>('MotivoPerdida').subscribe((motivos) => this.motivos.set(motivos));

    // El selector de Etapa vive DENTRO del mismo formulario de edición (a diferencia de
    // Ticket, donde la columna es contexto externo) — reaccionar a sus cambios aquí cubre
    // tanto el form.reset() de nuevo()/editar() como que el usuario cambie la etapa a mano
    // mientras el modal está abierto, sin tener que llamar aplicarConfiguracionCampos() en
    // cada sitio por separado.
    this.form.controls.etapaId.valueChanges.subscribe(() => this.aplicarConfiguracionCampos());

    this.cargar();
  }

  /** Siembra las 6 etapas originales (antes el enum fijo OportunidadEtapa) la primera vez
   *  que este catálogo está vacío, antes de poder cargar nada más. */
  cargar(): void {
    this.cargando.set(true);
    this.data.list<OportunidadEtapaConfig>('OportunidadEtapaConfig').subscribe({
      next: (etapas) => {
        if (!etapas.length) {
          this.engine.seedSiVacio('OportunidadEtapaConfig', OPORTUNIDAD_ETAPAS_SEED).then(() => this.cargar());
          return;
        }
        const etapasOrdenadas = etapas.sort((a, b) => a.orden - b.orden);
        this.etapas.set(etapasOrdenadas);

        this.data.list<Oportunidad>('Oportunidad').subscribe({
          next: (oportunidades) => {
            this.oportunidades.set(oportunidades);
            this.migrarEtapasLegado(oportunidades, etapasOrdenadas);
            this.cargando.set(false);
          },
          error: () => this.cargando.set(false),
        });
      },
      error: () => this.cargando.set(false),
    });
  }

  /** Compatibilidad con oportunidades creadas antes de este Gestor de Etapas: tenían un
   *  campo `etapa` de texto (p. ej. 'Prospección') en vez de `etapaId`. Se resuelve por
   *  nombre contra las etapas recién sembradas/cargadas y se guarda — solo pasa una vez
   *  por oportunidad, nunca se vuelve a intentar una vez que ya tiene etapaId. */
  private migrarEtapasLegado(oportunidades: Oportunidad[], etapas: OportunidadEtapaConfig[]): void {
    if (!etapas.length) return;
    for (const op of oportunidades) {
      if (op.etapaId) continue;
      const nombreLegado = (op as unknown as { etapa?: string }).etapa;
      const etapa = nombreLegado ? etapas.find((e) => e.nombre === nombreLegado) : undefined;
      if (!etapa) continue;
      this.data.modificacion<Oportunidad>('Oportunidad', { ...op, etapaId: etapa.id }).subscribe({
        next: () => {
          this.oportunidades.update((lista) => lista.map((o) => (o.id === op.id ? { ...o, etapaId: etapa.id } : o)));
        },
      });
    }
  }

  protected nombreCliente(clienteId: number | null): string {
    if (!clienteId) return 'Sin cliente asignado';
    return this.mapaClientes().get(clienteId)?.nombre ?? '—';
  }

  protected formatearMoneda(valor: number | null): string {
    if (!valor) return '';
    return '$' + valor.toLocaleString('es-MX');
  }

  /** Etapa actualmente seleccionada en el formulario abierto — se usa en la plantilla para
   *  decidir si mostrar "Motivo de la pérdida", igual que antes con `form.value.etapa`. */
  protected etapaSeleccionada(): OportunidadEtapaConfig | undefined {
    return this.mapaEtapas().get(Number(this.form.controls.etapaId.value));
  }

  /** Aplica, sobre `this.form`, las reglas editable/obligatorio configuradas para la etapa
   *  actualmente seleccionada (CRM → Oportunidades → Gestor de Etapas → "⚙ Campos"). El
   *  campo "Motivo de la pérdida" siempre queda editable y obligatorio cuando la etapa es
   *  de cierre perdido, sin importar esa configuración — es una regla fija del negocio. */
  private aplicarConfiguracionCampos(): void {
    const etapa = this.mapaEtapas().get(Number(this.form.controls.etapaId.value));
    const config = parsearConfiguracionCamposOportunidad(etapa?.configuracionCamposJson);

    for (const campo of OPORTUNIDAD_CAMPOS_CONFIGURABLES) {
      const reglaBase = reglaCampoOportunidad(config, campo.clave);
      const motivoForzado = campo.clave === 'motivoPerdidaId' && !!etapa?.esPerdida;
      const editable = reglaBase.editable || motivoForzado;
      const obligatorio = reglaBase.obligatorio || motivoForzado;

      const control = this.form.controls[campo.clave];
      if (editable) control.enable({ emitEvent: false });
      else control.disable({ emitEvent: false });
      control.setValidators(obligatorio ? [Validators.required] : []);
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  nuevo(): void {
    this.oportunidadEnEdicion.set(null);
    const etapaInicial = this.etapas()[0]?.id ?? 0;
    this.form.reset({
      id: 0,
      nombre: '',
      clienteId: 0,
      valorEstimado: 0,
      etapaId: etapaInicial,
      fechaCierreEstimada: '',
      motivoPerdidaId: 0,
      notas: '',
    });
    this.aplicarConfiguracionCampos();
    this.modalAbierto.set(true);
  }

  editar(oportunidad: Oportunidad, etapaForzada?: OportunidadEtapaConfig): void {
    this.oportunidadEnEdicion.set(oportunidad);
    this.form.reset({
      id: oportunidad.id,
      nombre: oportunidad.nombre,
      clienteId: oportunidad.clienteId ?? 0,
      valorEstimado: oportunidad.valorEstimado ?? 0,
      etapaId: etapaForzada?.id ?? oportunidad.etapaId,
      fechaCierreEstimada: oportunidad.fechaCierreEstimada ?? '',
      motivoPerdidaId: oportunidad.motivoPerdidaId ?? 0,
      notas: oportunidad.notas ?? '',
    });
    this.aplicarConfiguracionCampos();
    this.modalAbierto.set(true);
  }

  guardar(): void {
    const valor = this.form.getRawValue();
    const etapa = this.mapaEtapas().get(Number(valor.etapaId));
    const existente = this.oportunidadEnEdicion();

    // El selector de Etapa vive dentro de este mismo formulario (a diferencia de Ticket, que
    // no tiene un <select> de columna) — sin este chequeo, "Editar" dejaba saltarse por
    // completo la restricción de flujo que sí respetan onDrop()/esDestinoValido() al
    // arrastrar, igual que el bug ya corregido en Proyectos.Kanban.mover() en su momento.
    if (existente && Number(existente.etapaId) !== Number(valor.etapaId)) {
      const origen = this.mapaEtapas().get(existente.etapaId);
      if (origen && !puedeMoverAOportunidad(origen, Number(valor.etapaId))) {
        this.toast.advertencia(`No se puede mover de "${origen.nombre}" a "${etapa?.nombre ?? ''}".`);
        return;
      }
    }

    if (etapa?.esPerdida && !valor.motivoPerdidaId) {
      this.toast.advertencia('Selecciona el motivo de la pérdida antes de guardar.');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const payload = {
      id: valor.id,
      nombre: valor.nombre,
      clienteId: valor.clienteId || null,
      valorEstimado: valor.valorEstimado || null,
      etapaId: Number(valor.etapaId),
      fechaCierreEstimada: valor.fechaCierreEstimada || null,
      motivoPerdidaId: etapa?.esPerdida ? valor.motivoPerdidaId : null,
      notas: valor.notas || null,
    };

    const esEdicion = this.oportunidadEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Oportunidad>('Oportunidad', payload)
      : this.data.alta<Oportunidad>('Oportunidad', payload);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Oportunidad actualizada.' : 'Oportunidad creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
    });
  }

  pedirEliminar(oportunidad: Oportunidad): void {
    this.oportunidadAEliminar.set(oportunidad);
  }

  confirmarEliminar(): void {
    const oportunidad = this.oportunidadAEliminar();
    if (!oportunidad) return;

    this.data.baja('Oportunidad', oportunidad.id).subscribe({
      next: () => {
        this.toast.exito('Oportunidad eliminada.');
        this.oportunidadAEliminar.set(null);
        this.cargar();
      },
    });
  }

  onDragStart(oportunidad: Oportunidad): void {
    this.oportunidadArrastrando.set(oportunidad);
  }

  onDragEnd(): void {
    this.oportunidadArrastrando.set(null);
  }

  onDragOver(evento: DragEvent): void {
    if (!this.oportunidadArrastrando()) return;
    evento.preventDefault();
  }

  /** Resalta como destino válido solo las etapas a las que la oportunidad arrastrada sí
   *  puede moverse — misma lógica de permisos (`puedeMoverAOportunidad`) que aplica onDrop(). */
  esDestinoValido(etapa: OportunidadEtapaConfig): boolean {
    const oportunidad = this.oportunidadArrastrando();
    if (!oportunidad) return false;
    const origen = this.mapaEtapas().get(oportunidad.etapaId);
    if (!origen) return false;
    return puedeMoverAOportunidad(origen, etapa.id);
  }

  onDrop(evento: DragEvent, etapaDestino: OportunidadEtapaConfig): void {
    evento.preventDefault();
    const oportunidad = this.oportunidadArrastrando();
    this.oportunidadArrastrando.set(null);
    if (!oportunidad || oportunidad.etapaId === etapaDestino.id) return;

    const origen = this.mapaEtapas().get(oportunidad.etapaId);
    if (!origen) return;

    if (!puedeMoverAOportunidad(origen, etapaDestino.id)) {
      this.toast.advertencia(`No se puede mover de "${origen.nombre}" a "${etapaDestino.nombre}".`);
      return;
    }

    if (etapaDestino.esPerdida) {
      // Pedir el motivo antes de mover de verdad — se abre el modal de edición
      // ya con la etapa forzada en vez de cambiarla de inmediato.
      this.editar(oportunidad, etapaDestino);
      return;
    }

    this.data.modificacion<Oportunidad>('Oportunidad', { ...oportunidad, etapaId: etapaDestino.id }).subscribe({
      next: () => this.cargar(),
    });
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }
}
