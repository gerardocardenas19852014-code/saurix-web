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

  readonly confirmar = output<void>();
  readonly cancelar = output<void>();
}
