import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { DataClientService } from '../../../core/services/data-client.service';
import { MiembroFamilia } from '../miembro-familia.model';
import { DocumentoFamilia } from '../documento-familia.model';
import { PolizaSeguroMiembro } from '../poliza-seguro-miembro.model';
import { CitaMedicaMiembro } from '../cita-medica-miembro.model';
import { EventoFamiliar } from '../evento-familiar.model';
import { EventoAgendaFamiliar, eventosFamiliares } from '../familia.util';

const DIAS_VENTANA = 90;

type GrupoResumen = 'vencido' | 'semana' | 'mes' | 'adelante';

interface SeccionResumen {
  clave: GrupoResumen;
  titulo: string;
  items: (EventoAgendaFamiliar & { dias: number })[];
}

/**
 * Dashboard consolidado de Familia: todo lo próximo de TODA la familia en
 * una sola lista priorizada por cercanía — misma fuente de eventos que
 * Calendario (ver familia.util.ts → eventosFamiliares()), pero sin la
 * cuadrícula de mes: pensado para un vistazo rápido al entrar, no para
 * navegar fecha por fecha.
 */
@Component({
  selector: 'app-resumen-familia',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './resumen-familia.component.html',
  styleUrl: './resumen-familia.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResumenFamiliaComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly router = inject(Router);

  protected readonly miembros = signal<MiembroFamilia[]>([]);
  protected readonly documentos = signal<DocumentoFamilia[]>([]);
  protected readonly polizas = signal<PolizaSeguroMiembro[]>([]);
  protected readonly citas = signal<CitaMedicaMiembro[]>([]);
  protected readonly eventos = signal<EventoFamiliar[]>([]);
  protected readonly cargando = signal(false);

  protected readonly totalMiembrosActivos = computed(() => this.miembros().filter((m) => m.activo !== false).length);

  protected readonly secciones = computed<SeccionResumen[]>(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const limite = new Date(hoy.getTime() + DIAS_VENTANA * 86_400_000);

    const todos = eventosFamiliares({
      miembros: this.miembros(),
      documentos: this.documentos(),
      polizas: this.polizas(),
      citas: this.citas(),
      eventos: this.eventos(),
    })
      .filter((e) => e.fecha <= limite)
      .map((e) => ({ ...e, dias: Math.round((e.fecha.getTime() - hoy.getTime()) / 86_400_000) }));

    const grupos: Record<GrupoResumen, { titulo: string; items: (EventoAgendaFamiliar & { dias: number })[] }> = {
      vencido: { titulo: '⚠ Vencido o es hoy', items: [] },
      semana: { titulo: 'Esta semana', items: [] },
      mes: { titulo: 'Este mes', items: [] },
      adelante: { titulo: 'Más adelante', items: [] },
    };
    for (const item of todos) {
      const clave: GrupoResumen = item.dias <= 0 ? 'vencido' : item.dias <= 7 ? 'semana' : item.dias <= 30 ? 'mes' : 'adelante';
      grupos[clave].items.push(item);
    }
    (Object.keys(grupos) as GrupoResumen[]).forEach((k) => grupos[k].items.sort((a, b) => a.dias - b.dias));

    return (Object.keys(grupos) as GrupoResumen[])
      .map((clave) => ({ clave, ...grupos[clave] }))
      .filter((s) => s.items.length > 0);
  });

  protected textoDias(dias: number): string {
    if (dias === 0) return 'hoy';
    if (dias === 1) return 'mañana';
    if (dias === -1) return 'ayer';
    if (dias < 0) return `hace ${Math.abs(dias)} días`;
    return `en ${dias} días`;
  }

  protected onEventoClick(evento: EventoAgendaFamiliar): void {
    if (!evento.miembroId) return;
    void this.router.navigate(['/familia/miembros'], { queryParams: { miembro: evento.miembroId } });
  }

  ngOnInit(): void {
    this.cargando.set(true);
    this.data.list<MiembroFamilia>('MiembroFamilia').subscribe((m) => this.miembros.set(m));
    this.data.list<DocumentoFamilia>('DocumentoFamilia').subscribe((d) => this.documentos.set(d));
    this.data.list<PolizaSeguroMiembro>('PolizaSeguroMiembro').subscribe((p) => this.polizas.set(p));
    this.data.list<CitaMedicaMiembro>('CitaMedicaMiembro').subscribe((c) => this.citas.set(c));
    this.data.list<EventoFamiliar>('EventoFamiliar').subscribe({
      next: (e) => {
        this.eventos.set(e);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
