import { ApplicationConfig, LOCALE_ID, inject, isDevMode, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { DataClientService } from './core/services/data-client.service';
import { IndexedDbDataClientService } from './core/services/indexeddb-data-client.service';
import { SupabaseDataClientService } from './core/services/supabase-data-client.service';
import { fuenteDatosActual } from './core/services/fuente-datos';
import { SeedService } from './core/services/seed.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    // La app y su audiencia son de habla hispana (México) — con esto los pipes
    // `date`/`number`/`currency` usan esa localización por defecto en toda la
    // app (nombres de mes en español, etc.), y coincide con la localización
    // registrada en main.ts para los DatePipe instanciados a mano.
    { provide: LOCALE_ID, useValue: 'es-MX' },
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([errorInterceptor])),

    // ── Fuente de datos activa ──────────────────────────────────────────
    // Se elige en la pantalla de login (ver core/services/fuente-datos.ts):
    //   'supabase'  → base de datos en la nube (Supabase), compartida entre
    //                 dispositivos, con login de Supabase Auth.
    //   'indexeddb' → todo local en este navegador, sin backend (modo anterior).
    // Ningún componente cambia: todos dependen solo de DataClientService.
    {
      provide: DataClientService,
      useClass: fuenteDatosActual() === 'supabase' ? SupabaseDataClientService : IndexedDbDataClientService,
    },

    // IndexedDB: garantiza el usuario 'root' y las listas de valores.
    // Supabase: restaura la sesión guardada antes de que arranque la app.
    provideAppInitializer(() => inject(SeedService).ejecutar()),

    // PWA: service worker de solo caché de app shell/estáticos (sin manejo de
    // push todavía — eso queda pendiente, ver claude/esquema-tablas-saurix.md).
    // Deshabilitado en `ng serve` (isDevMode()) porque solo existe en builds de
    // producción (`ng build`); registrarlo también se retrasa 'registerWhenStable:30000'
    // para no competir con la carga inicial de la app.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
