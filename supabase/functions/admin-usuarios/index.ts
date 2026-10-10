// Saurix · Edge Function "admin-usuarios"
// Operaciones de cuentas que requieren la llave de servicio (nunca va al navegador):
//   crear       { perfil, password }            → solo admin
//   sincronizar { usuarioId, email?, password? } → admin, o el propio usuario
//   eliminar    { usuarioId }                    → solo admin
//   crear_empresa { clave, nombre }              → solo superadmin
// Un admin solo opera sobre usuarios de su empresa; el superadmin puede
// crear usuarios en cualquier empresa pasando `empresaId` en `crear`.
// `perfil` viene en snake_case con las columnas de seguridad.usuario.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const COLUMNAS_PERFIL = [
  'nombre_usuario', 'nombre', 'apellido_paterno', 'apellido_materno', 'email', 'role',
  'fecha_inicio_vigencia', 'fecha_fin_vigencia', 'debe_cambiar_password', 'activo',
];

function respuesta(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function falla(mensaje: string, status = 400): Response {
  return respuesta({ error: mensaje }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return falla('Método no permitido.', 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const seguridad = admin.schema('seguridad');

  // ── ¿Quién llama? ────────────────────────────────────────────────────
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: sesion, error: errSesion } = await admin.auth.getUser(jwt);
  if (errSesion || !sesion?.user) return falla('Sesión no válida.', 401);

  const { data: yo } = await seguridad
    .from('usuario')
    .select('id, role, activo, fecha_inicio_vigencia, fecha_fin_vigencia, empresa_id, es_superadmin, empresa_activa_id')
    .eq('auth_user_id', sesion.user.id)
    .maybeSingle();
  const hoy = new Date().toISOString().slice(0, 10);
  const vigente = !!yo && yo.activo && hoy >= yo.fecha_inicio_vigencia && hoy <= yo.fecha_fin_vigencia;
  if (!vigente) return falla('Tu usuario no está activo o vigente.', 403);
  const esSuperadmin = yo.es_superadmin === true;
  const esAdmin = yo.role === 'admin' || esSuperadmin;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return falla('Cuerpo inválido.');
  }
  const accion = cuerpo.accion as string;

  // ── crear_empresa ────────────────────────────────────────────────────
  if (accion === 'crear_empresa') {
    if (!esSuperadmin) return falla('Solo el superadministrador puede crear empresas.', 403);
    const clave = String(cuerpo.clave ?? '').trim();
    const nombre = String(cuerpo.nombre ?? '').trim();
    if (!clave || !nombre) return falla('Clave y nombre son obligatorios.');
    const { data, error } = await seguridad
      .from('empresa')
      .insert({ clave, nombre, creado_por: yo.id })
      .select()
      .single();
    if (error) return falla(error.code === '23505' ? 'Ya existe una empresa con esa clave.' : error.message);
    return respuesta({ empresa: data });
  }

  // ── crear ────────────────────────────────────────────────────────────
  if (accion === 'crear') {
    if (!esAdmin) return falla('Solo un administrador puede crear usuarios.', 403);
    const perfilEntrada = (cuerpo.perfil ?? {}) as Record<string, unknown>;
    const password = String(cuerpo.password ?? '');
    const email = String(perfilEntrada.email ?? '').trim();
    const nombreUsuario = String(perfilEntrada.nombre_usuario ?? '').trim();
    if (!email || !nombreUsuario) return falla('Usuario y correo son obligatorios.');
    if (password.length < 6) return falla('La contraseña es demasiado corta.');
    // Superadmin: la empresa indicada, o en la que está trabajando (modo soporte).
    const empresaId = esSuperadmin
      ? Number(cuerpo.empresaId ?? yo.empresa_activa_id ?? yo.empresa_id)
      : yo.empresa_id;

    const { data: duplicado } = await seguridad
      .from('usuario')
      .select('id')
      .or(`nombre_usuario.ilike.${nombreUsuario},email.ilike.${email}`)
      .limit(1);
    if (duplicado && duplicado.length) return falla('Ya existe un usuario con ese nombre o correo.', 409);

    const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre_usuario: nombreUsuario, nombre: perfilEntrada.nombre, empresa_id: empresaId },
    });
    if (errCrear || !creado?.user) return falla(errCrear?.message ?? 'No se pudo crear la cuenta.');

    const perfil: Record<string, unknown> = {};
    for (const c of COLUMNAS_PERFIL) if (c in perfilEntrada) perfil[c] = perfilEntrada[c];
    perfil.creado_por = yo.id;
    perfil.empresa_id = empresaId;

    const { data: fila, error: errPerfil } = await seguridad
      .from('usuario')
      .update(perfil)
      .eq('auth_user_id', creado.user.id)
      .select()
      .single();
    if (errPerfil) {
      await admin.auth.admin.deleteUser(creado.user.id);
      return falla(errPerfil.message);
    }
    return respuesta({ usuario: fila });
  }

  // Las otras dos acciones operan sobre un usuario existente.
  const usuarioId = Number(cuerpo.usuarioId);
  const { data: objetivo } = await seguridad
    .from('usuario')
    .select('id, auth_user_id, email, empresa_id')
    .eq('id', usuarioId)
    .maybeSingle();
  if (!objetivo || (!esSuperadmin && objetivo.empresa_id !== yo.empresa_id)) {
    return falla('Usuario no encontrado.', 404);
  }

  // ── sincronizar (correo y/o contraseña de la cuenta de acceso) ──────
  if (accion === 'sincronizar') {
    if (!esAdmin && objetivo.id !== yo.id) return falla('No puedes modificar la cuenta de otro usuario.', 403);
    if (!objetivo.auth_user_id) return falla('Este usuario no tiene cuenta de acceso.');
    const cambios: { email?: string; password?: string; email_confirm?: boolean } = {};
    if (typeof cuerpo.email === 'string' && cuerpo.email.trim() && cuerpo.email.trim() !== objetivo.email) {
      cambios.email = cuerpo.email.trim();
      cambios.email_confirm = true;
    }
    if (typeof cuerpo.password === 'string' && cuerpo.password) {
      if (cuerpo.password.length < 6) return falla('La contraseña es demasiado corta.');
      cambios.password = cuerpo.password;
    }
    if (Object.keys(cambios).length) {
      const { error } = await admin.auth.admin.updateUserById(objetivo.auth_user_id, cambios);
      if (error) return falla(error.message);
    }
    return respuesta({ ok: true });
  }

  // ── eliminar ─────────────────────────────────────────────────────────
  if (accion === 'eliminar') {
    if (!esAdmin) return falla('Solo un administrador puede eliminar usuarios.', 403);
    if (objetivo.id === yo.id) return falla('No puedes eliminar tu propio usuario.');
    const { error: errBorrar } = await seguridad.from('usuario').delete().eq('id', objetivo.id);
    if (errBorrar) {
      return falla(
        errBorrar.code === '23503'
          ? 'No se puede eliminar: el usuario tiene registros relacionados. Desactívalo en su lugar.'
          : errBorrar.message,
      );
    }
    if (objetivo.auth_user_id) await admin.auth.admin.deleteUser(objetivo.auth_user_id);
    return respuesta({ ok: true });
  }

  return falla('Acción no reconocida.');
});
