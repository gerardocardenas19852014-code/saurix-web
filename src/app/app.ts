import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { IndicadorAmbienteComponent } from './shared/components/indicador-ambiente/indicador-ambiente.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, IndicadorAmbienteComponent],
  template: '<app-indicador-ambiente /><router-outlet />',
})
export class App {}
