import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ColumnaTabla, DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../../shared/services/toast.service';
import { ValorLista } from '../../catalogos/valor-lista/valor-lista.model';
import { ConfiguracionConexion } from './conexion.model';

const GRUPO_PROVEEDOR = 'ConfiguracionConexionProveedor';

/**
 * Configuración de conexiones de base de datos. Nombres de campo
 * inferidos del resumen de esquema (Proveedor/Servidor/Puerto/BaseDatos
 * + credenciales) — no se tuvo el DTO exacto de PlataformaSaurix.Web a
 * la vista, así que si el Controller real usa otros nombres, ajustar
 * conexion.model.ts y este componente.
 *
 * La lista de proveedores ya no está fija en el código: viene del catálogo
 * "Listas de valores" (Catálogos → grupo ConfiguracionConexionProveedor).
 */
@Component({
  selector: 'app-conexiones',
  standalone: true,
  imports: [ReactiveFormsModule, DataTableComponent, ConfirmDialogComponent],
  templateUrl: './conexiones.component.html',
  styleUrl: './conexiones.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConexionesComponent implements OnInit {
  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly conexiones = signal<ConfiguracionConexion[]>([]);
  protected readonly cargando = signal(false);
  protected readonly proveedores = signal<ValorLista[]>([]);

  protected readonly modalAbierto = signal(false);
  protected readonly conexionEnEdicion = signal<ConfiguracionConexion | null>(null);
  protected readonly conexionAEliminar = signal<ConfiguracionConexion | null>(null);

  protected readonly columnas: ColumnaTabla<ConfiguracionConexion>[] = [
    { campo: 'nombre', etiqueta: 'Nombre' },
    { campo: 'proveedor', etiqueta: 'Proveedor' },
    { campo: 'servidor', etiqueta: 'Servidor' },
    { campo: 'baseDatos', etiqueta: 'Base de datos' },
  ];

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    proveedor: ['SqlServer', Validators.required],
    servidor: ['', Validators.required],
    puerto: [1433, Validators.required],
    baseDatos: ['', Validators.required],
    usuarioConexion: ['', Validators.required],
    passwordConexion: [''],
  });

  ngOnInit(): void {
    this.cargar();
    this.data.list<ValorLista>('ValorLista', { grupo: GRUPO_PROVEEDOR }).subscribe((valores) =>
      this.proveedores.set([...valores].sort((a, b) => a.orden - b.orden)),
    );
  }

  cargar(): void {
    this.cargando.set(true);
    this.data.list<ConfiguracionConexion>('ConfiguracionConexion').subscribe({
      next: (conexiones) => {
        this.conexiones.set(conexiones);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  nueva(): void {
    this.conexionEnEdicion.set(null);
    this.form.reset({
      id: 0,
      nombre: '',
      proveedor: 'SqlServer',
      servidor: '',
      puerto: 1433,
      baseDatos: '',
      usuarioConexion: '',
      passwordConexion: '',
    });
    this.modalAbierto.set(true);
  }

  editar(conexion: ConfiguracionConexion): void {
    this.conexionEnEdicion.set(conexion);
    this.form.reset({ ...conexion, passwordConexion: '' });
    this.modalAbierto.set(true);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const esEdicion = this.conexionEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<ConfiguracionConexion>('ConfiguracionConexion', valor)
      : this.data.alta<ConfiguracionConexion>('ConfiguracionConexion', valor);

    peticion.subscribe({
      next: () => {
        this.toast.exito(esEdicion ? 'Conexión actualizada.' : 'Conexión creada.');
        this.modalAbierto.set(false);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo guardar la conexión. Intenta de nuevo.'),
    });
  }

  pedirEliminar(conexion: ConfiguracionConexion): void {
    this.conexionAEliminar.set(conexion);
  }

  confirmarEliminar(): void {
    const conexion = this.conexionAEliminar();
    if (!conexion) return;

    this.data.baja('ConfiguracionConexion', conexion.id).subscribe({
      next: () => {
        this.toast.exito('Conexión eliminada.');
        this.conexionAEliminar.set(null);
        this.cargar();
      },
      error: () => this.toast.error('No se pudo eliminar la conexión. Intenta de nuevo.'),
    });
  }
}
