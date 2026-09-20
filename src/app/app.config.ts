import { ApplicationConfig, inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { DataClientService } from './core/services/data-client.service';
import { IndexedDbDataClientService } from './core/services/indexeddb-data-client.service';
import { SeedService } from './core/services/seed.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([errorInterceptor])),

    // ── Fuente de datos activa ──────────────────────────────────────────
    // Por ahora la app guarda todo localmente con IndexedDB (sin backend).
    // Cuando PlataformaSaurix (.NET) esté disponible, cambia esta línea a:
    //   { provide: DataClientService, useClass: HttpDataClientService }
    // (importando HttpDataClientService desde './core/services/http-data-client.service')
    // y toda la app pasará a consumir los servicios reales sin tocar
    // ningún componente ni pantalla.
    { provide: DataClientService, useClass: IndexedDbDataClientService },

    // Garantiza que exista el usuario 'root'/'a' antes de que arranque la app.
    provideAppInitializer(() => inject(SeedService).ejecutar()),
  ],
};
