import { registerLocaleData } from '@angular/common';
import localeEsMx from '@angular/common/locales/es-MX';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Registra los datos de la localización 'es-MX' (nombres de mes, formatos de
// fecha/hora, etc.) — sin este registro, cualquier uso de DatePipe con esa
// localización (p.ej. `new DatePipe('es-MX')`) revienta en tiempo de
// ejecución con NG0701 "Missing locale data for the locale es-MX".
registerLocaleData(localeEsMx);

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
