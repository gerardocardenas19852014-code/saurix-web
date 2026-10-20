import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataClientService } from '../../../core/services/data-client.service';
import { ToastService } from '../../../shared/services/toast.service';
import { SelectBuscableComponent, OpcionBuscable } from '../../../shared/components/select-buscable/select-buscable.component';
import { TipoListaPrecio } from '../../inventario/tipos-lista-precio/tipo-lista-precio.model';
import { Cliente } from './cliente.model';
import { RegimenFiscal } from '../regimenes-fiscales/regimen-fiscal.model';

/**
 * Formulario de alta/edición de Cliente con datos fiscales — se usa tanto
 * desde el catálogo (ClientesComponent) como desde el propio Cobro (POS),
 * para poder capturar un contacto nuevo sin salir de la pantalla de venta.
 * Mismo estilo que cualquier otro modal de "ventana administradora" del
 * proyecto (ver movimientos-bodega.component.html/productos.component.html):
 * un solo `.edit-form.form-grid-3col` con el domicilio distribuido en
 * renglones de 3 columnas (en vez de un campo por renglón), sin acordeones
 * ni encabezados propios — nada de esto se reinventa, es la misma
 * plantilla que ya usa el resto del sistema.
 *
 * El contacto genérico "Público en General" (Cliente.esGenerico, ver
 * cliente.service.ts) se puede editar aquí mismo (domicilio, correo,
 * teléfono…) pero su nombre y RFC se bloquean, para que nadie lo
 * convierta por accidente en un cliente real.
 */
@Component({
  selector: 'app-cliente-form-modal',
  standalone: true,
  imports: [ReactiveFormsModule, SelectBuscableComponent],
  templateUrl: './cliente-form-modal.component.html',
  styleUrl: './cliente-form-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClienteFormModalComponent {
  readonly visible = input<boolean>(false);
  readonly clienteEnEdicion = input<Cliente | null>(null);

  readonly guardado = output<Cliente>();
  readonly cancelado = output<void>();

  protected readonly listasPrecio = signal<TipoListaPrecio[]>([]);

  /** Incluye "Precio general" (valor 0) porque, igual que Producto.proveedorId,
   *  asignarle una lista predeterminada al cliente es opcional. */
  protected readonly opcionesListaPrecio = signal<OpcionBuscable[]>([{ valor: 0, etiqueta: 'Precio general' }]);

  /** Incluye "Sin régimen capturado" (valor '') porque regimenFiscalClave es
   *  opcional — ver catálogo editable en Ventas / Administración / Regímenes
   *  fiscales (RegimenesFiscalesComponent), ya no es un arreglo fijo en código. */
  protected readonly opcionesRegimenFiscal = signal<OpcionBuscable[]>([{ valor: '', etiqueta: 'Sin régimen capturado' }]);

  private readonly data = inject(DataClientService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly form = this.fb.nonNullable.group({
    id: [0],
    nombre: ['', Validators.required],
    rfc: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(13)]],
    esExtranjero: [false],
    regimenFiscalClave: [''],
    pais: ['México'],
    codigoPostal: [''],
    colonia: [''],
    calle: [''],
    numeroExterior: [''],
    numeroInterior: [''],
    estado: [''],
    municipio: [''],
    localidad: [''],
    correo: ['', Validators.email],
    telefono: [''],
    listaPrecioPredeterminadaId: [0],
    activo: [true],
  });

  protected get esGenerico(): boolean {
    return this.clienteEnEdicion()?.esGenerico === true;
  }

  constructor() {
    // Carga única del catálogo de listas de precio — este componente no se
    // vuelve a crear cada vez que se abre el modal (solo cambia `visible`),
    // así que basta con pedirlo una sola vez.
    // error: no-op a propósito — el DataClientService ya muestra su propio
    // toast ante una falla (ver SupabaseDataClientService.conToast) y este
    // catálogo es solo "nice to have" (el combo queda con su única opción
    // por defecto); sin este callback, un error aquí quedaba como excepción
    // no manejada (ver conToast: além del toast, siempre re-lanza).
    this.data.list<TipoListaPrecio>('TipoListaPrecio').subscribe({
      next: (listas) => {
        this.opcionesListaPrecio.set([
          { valor: 0, etiqueta: 'Precio general' },
          ...listas.filter((l) => l.activo !== false).map((l) => ({ valor: l.id, etiqueta: l.nombre })),
        ]);
      },
      error: () => {},
    });

    this.data.list<RegimenFiscal>('RegimenFiscal').subscribe({
      next: (regimenes) => {
        this.opcionesRegimenFiscal.set([
          { valor: '', etiqueta: 'Sin régimen capturado' },
          ...regimenes
            .filter((r) => r.activo !== false)
            .map((r) => ({ valor: r.clave, etiqueta: r.clave + ' — ' + r.nombre })),
        ]);
      },
      error: () => {},
    });

    // País solo es editable para un contacto extranjero — para uno nacional
    // se deja fijo en "México" (combo deshabilitado).
    this.form.controls.esExtranjero.valueChanges.subscribe((esExtranjero) => {
      if (esExtranjero) {
        this.form.controls.pais.enable();
        if (this.form.controls.pais.value === 'México') this.form.controls.pais.setValue('');
      } else {
        this.form.controls.pais.setValue('México');
        this.form.controls.pais.disable();
      }
    });

    // Reinicia el formulario cada vez que se abre el modal (visible pasa a
    // true) o cambia a quién se está editando — mismo criterio que un
    // ngOnChanges, pero con inputs basados en signal (input()).
    effect(() => {
      const cliente = this.clienteEnEdicion();
      if (!this.visible()) return;

      if (cliente) {
        this.form.reset({
          id: cliente.id,
          nombre: cliente.nombre,
          rfc: cliente.rfc,
          esExtranjero: cliente.esExtranjero,
          regimenFiscalClave: cliente.regimenFiscalClave ?? '',
          pais: cliente.pais || 'México',
          codigoPostal: cliente.codigoPostal ?? '',
          colonia: cliente.colonia ?? '',
          calle: cliente.calle ?? '',
          numeroExterior: cliente.numeroExterior ?? '',
          numeroInterior: cliente.numeroInterior ?? '',
          estado: cliente.estado ?? '',
          municipio: cliente.municipio ?? '',
          localidad: cliente.localidad ?? '',
          correo: cliente.correo ?? '',
          telefono: cliente.telefono ?? '',
          listaPrecioPredeterminadaId: cliente.listaPrecioPredeterminadaId ?? 0,
          activo: cliente.activo !== false,
        });
      } else {
        this.form.reset({
          id: 0,
          nombre: '',
          rfc: '',
          esExtranjero: false,
          regimenFiscalClave: '',
          pais: 'México',
          codigoPostal: '',
          colonia: '',
          calle: '',
          numeroExterior: '',
          numeroInterior: '',
          estado: '',
          municipio: '',
          localidad: '',
          correo: '',
          telefono: '',
          listaPrecioPredeterminadaId: 0,
          activo: true,
        });
      }

      if (!this.form.controls.esExtranjero.value) this.form.controls.pais.disable();

      if (cliente?.esGenerico) {
        this.form.controls.rfc.disable();
        this.form.controls.nombre.disable();
      } else {
        this.form.controls.rfc.enable();
        this.form.controls.nombre.enable();
      }
    });
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const valor = this.form.getRawValue();
    const payload = {
      ...valor,
      rfc: valor.rfc.toUpperCase().trim(),
      regimenFiscalClave: valor.regimenFiscalClave || null,
      pais: valor.pais || 'México',
      codigoPostal: valor.codigoPostal || null,
      colonia: valor.colonia || null,
      calle: valor.calle || null,
      numeroExterior: valor.numeroExterior || null,
      numeroInterior: valor.numeroInterior || null,
      estado: valor.estado || null,
      municipio: valor.municipio || null,
      localidad: valor.localidad || null,
      correo: valor.correo || null,
      telefono: valor.telefono || null,
      listaPrecioPredeterminadaId: valor.listaPrecioPredeterminadaId ? Number(valor.listaPrecioPredeterminadaId) : null,
      esGenerico: this.clienteEnEdicion()?.esGenerico ?? false,
    };
    const esEdicion = this.clienteEnEdicion() !== null;
    const peticion = esEdicion
      ? this.data.modificacion<Cliente>('Cliente', payload)
      : this.data.alta<Cliente>('Cliente', payload);

    peticion.subscribe({
      next: (cliente) => {
        this.toast.exito(esEdicion ? 'Cliente actualizado.' : 'Cliente creado.');
        this.guardado.emit(cliente);
      },
    });
  }

  cancelar(): void {
    this.cancelado.emit();
  }
}
