import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { Permiso, Rol, RolPermiso } from './rol-permiso.model';

/**
 * Pantalla de asignación Rol ↔ Permiso. A diferencia de Usuario.role
 * (un valor simple validado contra el catálogo de Roles, sin UI propia
 * para no ampliar el alcance), Rol/Permiso sí son relacionales de
 * verdad en el backend (RolPermiso), así que aquí se administra esa
 * relación completa: eliges un Rol y activas/desactivas cada Permiso.
 */
@Component({
  selector: 'app-roles-permisos',
  standalone: true,
  templateUrl: './roles-permisos.component.html',
  styleUrl: './roles-permisos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolesPermisosComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);

  protected readonly roles = signal<Rol[]>([]);
  protected readonly permisos = signal<Permiso[]>([]);
  protected readonly asignaciones = signal<RolPermiso[]>([]);
  protected readonly rolSeleccionadoId = signal<number | null>(null);
  protected readonly cargando = signal(false);
  protected readonly guardandoPermisoId = signal<number | null>(null);

  protected readonly permisoIdsAsignados = computed(
    () => new Set(this.asignaciones().map((a) => a.permisoId)),
  );

  ngOnInit(): void {
    this.data.list<Rol>('Rol').subscribe({
      next: (roles) => this.roles.set(roles),
      error: () => this.toast.error('No se pudieron cargar los roles.'),
    });
    this.data.list<Permiso>('Permiso').subscribe({
      next: (permisos) => this.permisos.set(permisos),
      error: () => this.toast.error('No se pudieron cargar los permisos.'),
    });
  }

  seleccionarRol(idTexto: string): void {
    const id = idTexto ? Number(idTexto) : null;
    this.rolSeleccionadoId.set(id);
    this.asignaciones.set([]);
    if (id === null) return;

    this.cargando.set(true);
    this.data.list<RolPermiso>('RolPermiso', { rolId: id }).subscribe({
      next: (asignaciones) => {
        this.asignaciones.set(asignaciones);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  estaAsignado(permisoId: number): boolean {
    return this.permisoIdsAsignados().has(permisoId);
  }

  alternarPermiso(permiso: Permiso, asignar: boolean): void {
    const rolId = this.rolSeleccionadoId();
    if (rolId === null) return;

    this.guardandoPermisoId.set(permiso.id);

    if (asignar) {
      this.data.alta<RolPermiso>('RolPermiso', { rolId, permisoId: permiso.id }).subscribe({
        next: (creado) => {
          this.asignaciones.update((lista) => [...lista, creado]);
          this.guardandoPermisoId.set(null);
        },
        error: () => {
          this.toast.error('No se pudo asignar el permiso.');
          this.guardandoPermisoId.set(null);
        },
      });
      return;
    }

    const existente = this.asignaciones().find((a) => a.permisoId === permiso.id);
    if (!existente) {
      this.guardandoPermisoId.set(null);
      return;
    }

    this.data.baja('RolPermiso', existente.id).subscribe({
      next: () => {
        this.asignaciones.update((lista) => lista.filter((a) => a.id !== existente.id));
        this.guardandoPermisoId.set(null);
      },
      error: () => {
        this.toast.error('No se pudo quitar el permiso.');
        this.guardandoPermisoId.set(null);
      },
    });
  }
}
