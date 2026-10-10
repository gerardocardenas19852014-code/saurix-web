import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DataClientService } from '../../../core/services/data-client.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { MiembroFamilia } from '../miembro-familia.model';
import { DocumentoFamilia } from '../documento-familia.model';
import { PolizaSeguroMiembro } from '../poliza-seguro-miembro.model';
import { CitaMedicaMiembro } from '../cita-medica-miembro.model';
import { EventoFamiliar } from '../evento-familiar.model';
import { EventoAgendaFamiliar, eventosFamiliares } from '../familia.util';

const ENTIDAD_EVENTO = 'EventoFamiliar';

interface CeldaCalendarioFamiliar {
  /** null = celda de relleno antes del día 1 o después del último día del mes. */
  fecha: Date | null;
  eventos: EventoAgendaFamiliar[];
  esHoy: boolean;
}

/**
 * Vista de mes con todos los "eventos" de la familia juntos: cumpleaños,
 * documentos/pólizas por vencer, citas médicas pendientes y eventos
 * manuales — misma fuente que Resumen (ver familia.util.ts →
 * eventosFamiliares()), mismo patrón de cuadrícula que Presupuesto →
 * Calendario de pagos (ver calendario.component.ts).
 */
@Component({
  selector: 'app-calendario-familiar',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, ConfirmDialogComponent, RouterLink],
  templateUrl: './calendario-familiar.component.html',
  styleUrl: './calendario-familiar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarioFamiliarComponent implements OnInit {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly fb = inject(FormBuilder);
  protected readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly miembros = signal<MiembroFamilia[]>([]);
  protected readonly documentos = signal<DocumentoFamilia[]>([]);
  protected readonly polizas = signal<PolizaSeguroMiembro[]>([]);
  protected readonly citas = signal<CitaMedicaMiembro[]>([]);
  protected readonly eventos = signal<EventoFamiliar[]>([]);
  protected readonly cargando = signal(false);

  protected readonly mesGridBase = signal<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  protected readonly miembrosActivos = computed(() => this.miembros().filter((m) => m.activo !== false));

  protected readonly etiquetaMesGrid = computed(() => {
    const texto = this.mesGridBase().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  });

  irMesAnterior(): void {
    const b = this.mesGridBase();
    this.mesGridBase.set(new Date(b.getFullYear(), b.getMonth() - 1, 1));
  }

  irMesSiguiente(): void {
    const b = this.mesGridBase();
    this.mesGridBase.set(new Date(b.getFullYear(), b.getMonth() + 1, 1));
  }

  irMesHoy(): void {
    const hoy = new Date();
    this.mesGridBase.set(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  }

  /** Eventos del año que se está mostrando — se recalcula el cumpleaños de
   *  cada quien para ESE año (ver eventosFamiliares) para que aparezcan en
   *  cualquier mes que el usuario navegue, no solo el próximo. */
  protected readonly eventosDelAnio = computed<EventoAgendaFamiliar[]>(() =>
    eventosFamiliares(
      {
        miembros: this.miembros(),
        documentos: this.documentos(),
        polizas: this.polizas(),
        citas: this.citas(),
        eventos: this.eventos(),
      },
      this.mesGridBase().getFullYear(),
    ),
  );

  /** Clic en un evento de la cuadrícula: los calculados (cumpleaños,
   *  documento, póliza, cita) llevan a la ficha del miembro correspondiente;
   *  los manuales (EventoFamiliar) abren su modal de edición aquí mismo. */
  protected onEventoClick(evento: EventoAgendaFamiliar): void {
    if (evento.tipo === 'evento') {
      this.editarEventoDesdeAgenda(evento);
      return;
    }
    if (!evento.miembroId) return;
    const ruta = evento.tipo === 'cumpleanos' ? '/familia/miembros' : '/familia/miembros';
    void this.router.navigate([ruta], { queryParams: { miembro: evento.miembroId } });
  }

  protected readonly celdasGrid = computed<CeldaCalendarioFamiliar[]>(() => {
    const base = this.mesGridBase();
    const anio = base.getFullYear();
    const mes = base.getMonth();
    const primerDiaSemana = new Date(anio, mes, 1).getDay();
    const diasEnMes = new Date(anio, mes + 1, 0).getDate();
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const porFecha = new Map<string, EventoAgendaFamiliar[]>();
    for (const evento of this.eventosDelAnio()) {
      const clave = evento.fecha.toISOString().slice(0, 10);
      if (!porFecha.has(clave)) porFecha.set(clave, []);
      porFecha.get(clave)!.push(evento);
    }

    const celdas: CeldaCalendarioFamiliar[] = [];
    for (let i = 0; i < primerDiaSemana; i++) celdas.push({ fecha: null, eventos: [], esHoy: false });
    for (let dia = 1; dia <= diasEnMes; dia++) {
      const fecha = new Date(anio, mes, dia);
      const clave = fecha.toISOString().slice(0, 10);
      celdas.push({ fecha, eventos: porFecha.get(clave) ?? [], esHoy: fecha.getTime() === hoy.getTime() });
    }
    return celdas;
  });

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.cargando.set(true);
    this.data.list<MiembroFamilia>('MiembroFamilia').subscribe((m) => this.miembros.set(m));
    this.data.list<DocumentoFamilia>('DocumentoFamilia').subscribe((d) => this.documentos.set(d));
    this.data.list<PolizaSeguroMiembro>('PolizaSeguroMiembro').subscribe((p) => this.polizas.set(p));
    this.data.list<CitaMedicaMiembro>('CitaMedicaMiembro').subscribe((c) => this.citas.set(c));
    this.data.list<EventoFamiliar>(ENTIDAD_EVENTO).subscribe({
      next: (e) => {
        this.eventos.set(e);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  // ── Eventos manuales ───────────────────────────────────────────────
  protected readonly modalEventoAbierto = signal(false);
  protected readonly eventoEnEdicion = signal<EventoFamiliar | null>(null);
  protected readonly eventoAEliminar = signal<EventoFamiliar | null>(null);

  protected readonly formEvento = this.fb.nonNullable.group({
    id: [0],
    miembroFamiliaId: [0],
    titulo: ['', Validators.required],
    fecha: ['', Validators.required],
    notas: [''],
    activo: [true],
  });

  nuevoEvento(fecha?: Date): void {
    this.eventoEnEdicion.set(null);
    this.formEvento.reset({
      id: 0,
      miembroFamiliaId: 0,
      titulo: '',
      fecha: fecha ? fecha.toISOString().slice(0, 10) : '',
      notas: '',
      activo: true,
    });
    this.modalEventoAbierto.set(true);
  }

  editarEventoDesdeAgenda(evento: EventoAgendaFamiliar): void {
    if (evento.tipo !== 'evento') return; // solo los eventos manuales son editables aquí
    const original = this.eventos().find(
      (e) => e.titulo === evento.titulo && e.fecha === evento.fecha.toISOString().slice(0, 10),
    );
    if (!original) return;
    this.eventoEnEdicion.set(original);
    this.formEvento.reset({ ...original, miembroFamiliaId: original.miembroFamiliaId ?? 0 });
    this.modalEventoAbierto.set(true);
  }

  cerrarModalEvento(): void {
    this.toast.info('Cambios descartados.');
    this.modalEventoAbierto.set(false);
  }

  guardarEvento(): void {
    if (this.formEvento.invalid) {
      this.formEvento.markAllAsTouched();
      this.toast.error('Captura el título y la fecha del evento.');
      return;
    }
    const bruto = this.formEvento.getRawValue();
    const valor = { ...bruto, miembroFamiliaId: bruto.miembroFamiliaId ? Number(bruto.miembroFamiliaId) : null };
    const esEdicion = this.eventoEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<EventoFamiliar>(ENTIDAD_EVENTO, valor)
      : this.data.alta<EventoFamiliar>(ENTIDAD_EVENTO, valor);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Evento actualizado.' : 'Evento agregado.');
        this.modalEventoAbierto.set(false);
        this.data.list<EventoFamiliar>(ENTIDAD_EVENTO).subscribe((e) => this.eventos.set(e));
      },
      error: () => this.toast.error('No se pudo guardar el evento. Intenta de nuevo.'),
    });
  }

  pedirEliminarEventoDesdeAgenda(evento: EventoAgendaFamiliar): void {
    if (evento.tipo !== 'evento') return;
    const original = this.eventos().find(
      (e) => e.titulo === evento.titulo && e.fecha === evento.fecha.toISOString().slice(0, 10),
    );
    if (original) this.eventoAEliminar.set(original);
  }

  /** Botón "Eliminar" dentro del modal de edición: el evento ya está
   *  cargado en eventoEnEdicion(), así que no hace falta volver a buscarlo
   *  por título+fecha (eso es solo para el camino "clic en la cuadrícula"). */
  pedirEliminarEventoEnEdicion(): void {
    const evento = this.eventoEnEdicion();
    if (evento) {
      this.modalEventoAbierto.set(false);
      this.eventoAEliminar.set(evento);
    }
  }

  confirmarEliminarEvento(): void {
    const evento = this.eventoAEliminar();
    if (!evento) return;
    this.data.baja(ENTIDAD_EVENTO, evento.id).subscribe({
      next: () => {
        this.toast.exito('Evento eliminado.');
        this.eventoAEliminar.set(null);
        this.data.list<EventoFamiliar>(ENTIDAD_EVENTO).subscribe((e) => this.eventos.set(e));
      },
      error: () => this.toast.error('No se pudo eliminar. Intenta de nuevo.'),
    });
  }
}
