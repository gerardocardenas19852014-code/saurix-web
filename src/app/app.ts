import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { IndicadorAmbienteComponent } from './shared/components/indicador-ambiente/indicador-ambiente.component';
import { ActualizacionDisponibleComponent } from './shared/components/actualizacion-disponible/actualizacion-disponible.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, IndicadorAmbienteComponent, ActualizacionDisponibleComponent],
  template: '<app-indicador-ambiente /><app-actualizacion-disponible /><router-outlet />',
})
export class App {}
