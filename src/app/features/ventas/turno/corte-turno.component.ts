import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { formatMoneda } from '../ventas.util';
import { ResumenTurno } from './turno-caja.model';
import { TurnoCajaService } from './turno-caja.service';

/** Corte de caja — reporte de cómo va el turno SIN cerrarlo (se puede
 *  seguir vendiendo después de verlo). Mismo resumen que Cierre, solo que
 *  aquí no se pide el conteo físico ni se cambia el estado del turno. */
@Component({
  selector: 'app-corte-turno',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './corte-turno.component.html',
  styleUrl: './corte-turno.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CorteTurnoComponent implements OnInit {
  protected readonly formatMoneda = formatMoneda;

  private readonly auth = inject(AuthService);
  private readonly turnoCajaService = inject(TurnoCajaService);

  protected readonly cargando = signal(true);
  protected readonly resumen = signal<ResumenTurno | null>(null);

  async ngOnInit(): Promise<void> {
    const usuario = this.auth.usuarioActual();
    if (!usuario) return;

    const turno = await this.turnoCajaService.turnoAbierto(usuario.id);
    if (turno) {
      this.resumen.set(await this.turnoCajaService.resumen(turno));
    }
    this.cargando.set(false);
  }
}
