import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

type ColorIcono = 'siif' | 'personal' | 'generic';

interface EnlaceConfig {
  ruta: string;
  icono: string;
  color: ColorIcono;
  titulo: string;
  descripcion: string;
  grupo: string;
}

interface GrupoConfig {
  titulo: string;
  enlaces: EnlaceConfig[];
}

// Panel de Control reúne la configuración general de la app (Apariencia,
// Conexiones) junto con las pantallas de configuración propias de cada
// módulo (p.ej. el Gestor de Estados de Gestión de Proyectos). Cada módulo
// que necesite una pantalla de configuración similar agrega aquí su propio
// grupo, para que siempre quede claro a qué módulo pertenece cada una.
const GRUPOS: GrupoConfig[] = [
  {
    titulo: 'General',
    enlaces: [
      {
        ruta: 'apariencia',
        icono: '🎨',
        color: 'generic',
        titulo: 'Apariencia',
        descripcion: 'Tema, asistente de IA y tamaño de página, por usuario.',
        grupo: 'General',
      },
      {
        ruta: 'conexiones',
        icono: '🔌',
        color: 'generic',
        titulo: 'Conexiones',
        descripcion: 'Orígenes de datos y conexiones externas de la app.',
        grupo: 'General',
      },
      {
        ruta: 'respaldo',
        icono: '💾',
        color: 'generic',
        titulo: 'Respaldo y restauración',
        descripcion: 'Descarga toda tu información o restáurala en otro dispositivo.',
        grupo: 'General',
      },
    ],
  },
  {
    titulo: 'Gestión de Proyectos',
    enlaces: [
      {
        ruta: 'gestion-proyectos/gestor-estados',
        icono: '🧭',
        color: 'siif',
        titulo: 'Gestor de Estados',
        descripcion: 'Columnas del tablero Kanban de cada proyecto, con permisos y campos configurables por columna.',
        grupo: 'Gestión de Proyectos',
      },
    ],
  },
];

@Component({
  selector: 'app-panel-control-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './panel-control-landing.component.html',
  styleUrl: './panel-control-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelControlLandingComponent {
  protected readonly grupos = GRUPOS;
}
