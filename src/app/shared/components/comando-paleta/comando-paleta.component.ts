import { ChangeDetectionStrategy, Component, ElementRef, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DESTINOS, DestinoPaleta } from '../../utils/navegacion-destinos.util';

/** Paleta de comandos (Ctrl/Cmd+K) para saltar de una pantalla a otra sin
 *  pasar por la barra lateral — a pedido del usuario, alcance acotado a
 *  NAVEGACIÓN entre pantallas (no busca datos dentro de cada módulo). Se
 *  abre/cierra sola (su propio HostListener global), así que en el shell
 *  solo hace falta poner <app-comando-paleta /> una vez. El fondo usa la
 *  misma clase ".modal-overlay" que el resto de los modales de la app, así
 *  que Escape la cierra gratis vía el listener centralizado que ya existe
 *  en ShellComponent (cerrarModalConEscape) — no hace falta duplicar esa
 *  lógica aquí. */
@Component({
  selector: 'app-comando-paleta',
  standalone: true,
  templateUrl: './comando-paleta.component.html',
  styleUrl: './comando-paleta.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComandoPaletaComponent {
  private readonly router = inject(Router);

  @ViewChild('inputBuscador') private inputBuscadorRef?: ElementRef<HTMLInputElement>;

  protected readonly abierta = signal(false);
  protected readonly consulta = signal('');
  protected readonly indiceActivo = signal(0);

  protected readonly resultados = computed<DestinoPaleta[]>(() => {
    const termino = this.normalizar(this.consulta());
    const lista = !termino
      ? DESTINOS
      : DESTINOS.filter((d) => this.normalizar(`${d.grupo} ${d.label}`).includes(termino));
    return lista.slice(0, 30);
  });

  private normalizar(texto: string): string {
    return texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  @HostListener('document:keydown', ['$event'])
  protected manejarTecla(evento: KeyboardEvent): void {
    const esAtajoAbrir = (evento.key === 'k' || evento.key === 'K') && (evento.ctrlKey || evento.metaKey);
    if (esAtajoAbrir) {
      evento.preventDefault();
      this.abrir();
      return;
    }

    if (!this.abierta()) return;

    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      this.moverIndice(1);
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      this.moverIndice(-1);
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      this.irAResultado(this.indiceActivo());
    }
  }

  protected abrir(): void {
    this.abierta.set(true);
    this.consulta.set('');
    this.indiceActivo.set(0);
    setTimeout(() => this.inputBuscadorRef?.nativeElement.focus(), 0);
  }

  protected cerrar(): void {
    this.abierta.set(false);
  }

  protected onConsultaCambia(valor: string): void {
    this.consulta.set(valor);
    this.indiceActivo.set(0);
  }

  private moverIndice(delta: number): void {
    const total = this.resultados().length;
    if (total === 0) return;
    this.indiceActivo.update((i) => (i + delta + total) % total);
  }

  protected irAResultado(indice: number): void {
    const destino = this.resultados()[indice];
    if (!destino) return;
    void this.router.navigateByUrl(destino.ruta);
    this.cerrar();
  }
}
