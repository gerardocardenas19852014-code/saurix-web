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
 *
 * "+ Nuevo rol" (auditoría de rendimiento, nov-2026): antes de esto no
 * existía NINGUNA pantalla para dar de alta un Rol — por eso
 * seguridad.rol estaba vacío y el <select> de Rol en Usuarios dependiía
 * por completo del valor "sintético" que inyecta rolesSeleccionables()
 * (ver usuarios-list.component.ts). RLS (solo_mi_empresa + catalogo_admin_*,
 * ver pg_policies) ya exige ser admin/superadmin para alta/baja/edición y
 * ya acota por empresa mediante el DEFAULT de empresa_id — esta pantalla
 * no necesita repetir esa validación, solo ofrecer el formulario.
 */
@Component({
  selector: 'app-roles-permisos',
  standalone: true,
  templateUrl: './roles-permisos.component.html',
  styleUrl: './roles-permisos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RolesPermisosComponent implements OnInit {
  // Pantalla a ancho completo (html[data-wide='grid'] en styles.scss).
  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-wide');
  }

  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);

  protected readonly roles = signal<Rol[]>([]);
  protected readonly permisos = signal<Permiso[]>([]);
  protected readonly asignaciones = signal<RolPermiso[]>([]);
  protected readonly rolSeleccionadoId = signal<number | null>(null);
  protected readonly cargando = signal(false);
  protected readonly guardandoPermisoId = signal<number | null>(null);

  protected readonly nombreNuevoRol = signal('');
  protected readonly creandoRol = signal(false);
  protected readonly cambiandoActivoRolId = signal<number | null>(null);

  protected readonly permisoIdsAsignados = computed(
    () => new Set(this.asignaciones().map((a) => a.permisoId)),
  );

  ngOnInit(): void {
    document.documentElement.setAttribute('data-wide', 'grid'); // ancho completo
    this.data.list<Rol>('Rol').subscribe({
      next: (roles) => this.roles.set(roles),
      error: () => this.toast.error('No se pudieron cargar los roles.'),
    });
    this.data.list<Permiso>('Permiso').subscribe({
      next: (permisos) => this.permisos.set(permisos),
      error: () => this.toast.error('No se pudieron cargar los permisos.'),
    });
  }

  /** Da de alta un Rol nuevo en el catálogo de la empresa (empresa_id lo
   *  pone solo el DEFAULT de la columna —ver privado.empresa_actual_id()—,
   *  nunca se manda desde aquí). RLS rechaza el intento si quien llama no
   *  es admin/superadmin, igual que ya pasa en cualquier otro catálogo. */
  agregarRol(): void {
    const nombre = this.nombreNuevoRol().trim();
    if (!nombre) return;
    if (this.roles().some((r) => r.nombre.toLowerCase() === nombre.toLowerCase())) {
      this.toast.advertencia('Ya existe un rol con ese nombre.');
      return;
    }
    this.creandoRol.set(true);
    this.data.alta<Rol>('Rol', { nombre, activo: true }).subscribe({
      next: (creado) => {
        this.roles.update((lista) => [...lista, creado]);
        this.nombreNuevoRol.set('');
        this.creandoRol.set(false);
        this.toast.exito('Rol creado.');
      },
      error: () => this.creandoRol.set(false),
    });
  }

  /** Activar/desactivar un rol existente (p.ej. uno que ya no se use, sin
   *  borrarlo — borrar podría chocar con usuarios que ya lo tienen asignado
   *  o con sus permisos en RolPermiso). Un rol inactivo sigue
   *  mostrándose para quien ya lo tenía (ver rolesSeleccionables() en
   *  usuarios-list.component.ts), pero deja de ofrecerse para nuevas altas. */
  alternarActivoRol(rol: Rol): void {
    this.cambiandoActivoRolId.set(rol.id);
    this.data.modificacion<Rol>('Rol', { ...rol, activo: !rol.activo }).subscribe({
      next: (actualizado) => {
        this.roles.update((lista) => lista.map((r) => (r.id === actualizado.id ? actualizado : r)));
        this.cambiandoActivoRolId.set(null);
      },
      error: () => this.cambiandoActivoRolId.set(null),
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
