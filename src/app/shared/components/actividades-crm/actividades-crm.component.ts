import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../services/toast.service';
import { ACTIVIDAD_TIPOS, ActividadCrm, ActividadRelacionadoTipo, ActividadTipo } from './actividad-crm.model';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Timeline de actividades (llamadas/reuniones/tareas/notas) reutilizable —
 * se incrusta dentro del modal de edición de cualquier entidad del CRM que
 * la necesite (Lead, Oportunidad, Cliente, Caso), pasándole de qué registro
 * se trata vía `[relacionadoTipo]`/`[relacionadoId]`. Mismo criterio que
 * `app-adjuntos-panel`: un solo componente reutilizado, nunca una copia por
 * pantalla.
 */
@Component({
  selector: 'app-actividades-crm',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './actividades-crm.component.html',
  styleUrl: './actividades-crm.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActividadesCrmComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly relacionadoTipo = input.required<ActividadRelacionadoTipo>();
  readonly relacionadoId = input.required<number>();

  protected readonly tipos = ACTIVIDAD_TIPOS;
  protected readonly actividades = signal<ActividadCrm[]>([]);
  protected readonly cargando = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    tipo: ['Nota' as ActividadTipo],
    titulo: ['', Validators.required],
    descripcion: [''],
    fecha: [hoyISO()],
  });

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.data
      .list<ActividadCrm>('ActividadCrm', {
        relacionadoTipo: this.relacionadoTipo(),
        relacionadoId: this.relacionadoId(),
      })
      .subscribe({
        next: (actividades) => {
          this.actividades.set([...actividades].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '')));
          this.cargando.set(false);
        },
        error: () => this.cargando.set(false),
      });
  }

  protected iconoTipo(tipo: ActividadTipo): string {
    switch (tipo) {
      case 'Llamada':
        return '📞';
      case 'Reunión':
        return '🤝';
      case 'Tarea':
        return '✅';
      default:
        return '📝';
    }
  }

  agregar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valor = this.form.getRawValue();
    this.data
      .alta<ActividadCrm>('ActividadCrm', {
        relacionadoTipo: this.relacionadoTipo(),
        relacionadoId: this.relacionadoId(),
        tipo: valor.tipo,
        titulo: valor.titulo,
        descripcion: valor.descripcion || null,
        fecha: valor.fecha || hoyISO(),
        // Una 'Nota' se registra ya completada (es solo una anotación); el
        // resto de tipos nace pendiente y se marca completada aparte.
        completada: valor.tipo === 'Nota',
      })
      .subscribe({
        next: () => {
          this.toast.exito('Actividad registrada.');
          this.form.reset({ tipo: 'Nota', titulo: '', descripcion: '', fecha: hoyISO() });
          this.cargar();
        },
      });
  }

  alternarCompletada(actividad: ActividadCrm): void {
    this.data
      .modificacion<ActividadCrm>('ActividadCrm', { ...actividad, completada: !actividad.completada })
      .subscribe({ next: () => this.cargar() });
  }

  eliminar(actividad: ActividadCrm): void {
    this.data.baja('ActividadCrm', actividad.id).subscribe({
      next: () => {
        this.toast.exito('Actividad eliminada.');
        this.cargar();
      },
    });
  }
}
