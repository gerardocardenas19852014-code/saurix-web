import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  readonly visible = input<boolean>(false);
  readonly titulo = input<string>('Confirmar');
  readonly mensaje = input<string>('¿Estás seguro?');
  /** Texto del botón de acción (rojo). Antes era fijo "Eliminar" — se
   *  agregó este input, con ese mismo valor por default, para poder
   *  reutilizar el componente en el aviso de "cambios sin guardar" del
   *  shell (ShellComponent) sin tocar ninguno de los usos existentes. */
  readonly textoConfirmar = input<string>('Eliminar');

  readonly confirmar = output<void>();
  readonly cancelar = output<void>();
}
