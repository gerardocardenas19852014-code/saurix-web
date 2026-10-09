import { Injectable } from '@angular/core';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/**
 * Cliente único de Supabase para toda la app (base de datos, Auth y
 * Storage). La llave es la "publishable": es pública por diseño; lo que
 * protege los datos son las reglas RLS definidas en supabase/migrations.
 * La sesión de Auth la guarda el propio cliente en localStorage y la
 * renueva sola.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly cliente: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'saurix.supabase.auth',
    },
  });
}
