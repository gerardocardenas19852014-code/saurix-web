-- =====================================================================
-- Saurix · Supabase (Postgres 17) · 01 Esquema
-- Un esquema por módulo, nombres en snake_case.
-- Auditoría (fecha_creacion, fecha_modificacion, creado_por,
-- modificado_por, activo) se agrega a TODAS las tablas en 02_seguridad_rls.
-- =====================================================================

create schema if not exists privado;        -- funciones internas (NO se expone en la API)
create schema if not exists seguridad;
create schema if not exists panel_control;
create schema if not exists wikidocs;
create schema if not exists presupuesto;
create schema if not exists proyectos;
create schema if not exists familia;

-- ---------------------------------------------------------------------
-- SEGURIDAD
-- ---------------------------------------------------------------------
create table seguridad.usuario (
  id                     bigint generated always as identity primary key,
  auth_user_id           uuid unique references auth.users(id) on delete set null,
  nombre_usuario         text not null check (char_length(nombre_usuario) >= 4),
  nombre                 text not null check (char_length(nombre) between 3 and 30),
  apellido_paterno       text check (apellido_paterno is null or char_length(apellido_paterno) <= 30),
  apellido_materno       text check (apellido_materno is null or char_length(apellido_materno) <= 30),
  email                  text not null,
  role                   text not null default 'viewer',
  fecha_inicio_vigencia  date not null default current_date,
  fecha_fin_vigencia     date not null default date '2100-12-31',
  ultimo_acceso          timestamptz,
  debe_cambiar_password  boolean not null default false,
  constraint usuario_vigencia_ck check (fecha_fin_vigencia >= fecha_inicio_vigencia)
);
create unique index usuario_nombre_usuario_uk on seguridad.usuario (lower(nombre_usuario));
create unique index usuario_email_uk on seguridad.usuario (lower(email));

create table seguridad.rol (
  id     bigint generated always as identity primary key,
  nombre text not null unique
);
create table seguridad.permiso (
  id     bigint generated always as identity primary key,
  nombre text not null unique
);
create table seguridad.rol_permiso (
  id         bigint generated always as identity primary key,
  rol_id     bigint not null references seguridad.rol(id) on delete cascade,
  permiso_id bigint not null references seguridad.permiso(id) on delete cascade,
  unique (rol_id, permiso_id)
);

create table seguridad.bitacora (
  id          bigint generated always as identity primary key,
  modulo      text not null,
  entidad     text not null,
  accion      text not null,
  registro_id bigint,
  usuario     text not null,
  fecha       timestamptz not null default now(),
  cambios     jsonb not null default '[]'::jsonb
);
create index bitacora_fecha_ix on seguridad.bitacora (fecha desc);

create table seguridad.notificacion (
  id         bigint generated always as identity primary key,
  usuario_id bigint not null references seguridad.usuario(id) on delete cascade,
  titulo     text not null,
  link       text,
  leida      boolean not null default false
);

-- ---------------------------------------------------------------------
-- PANEL DE CONTROL
-- ---------------------------------------------------------------------
create table panel_control.configuracion_apariencia (
  id                        bigint generated always as identity primary key,
  usuario_id                bigint not null unique references seguridad.usuario(id) on delete cascade,
  tema                      text not null default 'claro',
  asistente_ia_activo       boolean not null default true,
  tamano_pagina_grid        integer not null default 10 check (tamano_pagina_grid > 0),
  vista_proyectos_preferida text not null default 'tablero'
);

create table panel_control.valor_lista (
  id       bigint generated always as identity primary key,
  grupo    text not null,
  clave    text not null,
  etiqueta text not null,
  orden    integer not null default 0,
  unique (grupo, clave)
);

-- ---------------------------------------------------------------------
-- WIKIDOCS   TipoSistema (1) -> Categoria (N) -> Seccion (N) -> Documento (N)
-- ---------------------------------------------------------------------
create table wikidocs.tipo_sistema (
  id     bigint generated always as identity primary key,
  nombre text not null
);
create table wikidocs.categoria (
  id              bigint generated always as identity primary key,
  tipo_sistema_id bigint not null references wikidocs.tipo_sistema(id),
  nombre          text not null
);
create table wikidocs.seccion (
  id           bigint generated always as identity primary key,
  categoria_id bigint not null references wikidocs.categoria(id),
  nombre       text not null
);
create table wikidocs.documento (
  id         bigint generated always as identity primary key,
  seccion_id bigint not null references wikidocs.seccion(id),
  titulo     text not null,
  contenido  text not null default ''
);
create table wikidocs.documento_favorito (
  id           bigint generated always as identity primary key,
  documento_id bigint not null references wikidocs.documento(id) on delete cascade,
  usuario      text not null,
  unique (documento_id, usuario)
);
create table wikidocs.documento_version (
  id           bigint generated always as identity primary key,
  documento_id bigint not null references wikidocs.documento(id) on delete cascade,
  titulo       text not null,
  contenido    text not null default '',
  usuario      text not null
);
create table wikidocs.plantilla_documento (
  id        bigint generated always as identity primary key,
  nombre    text not null,
  contenido text not null default ''
);
-- Adjuntos: el archivo vive en Storage (bucket "adjuntos"); aquí solo la ruta.
create table wikidocs.documento_adjunto (
  id             bigint generated always as identity primary key,
  documento_id   bigint not null references wikidocs.documento(id) on delete cascade,
  nombre_archivo text not null,
  tipo_contenido text,
  ruta_storage   text not null,
  tamano_bytes   bigint,
  comentario     text
);

-- ---------------------------------------------------------------------
-- PRESUPUESTO
--   Compartidos: categoria_presupuesto, cuenta_presupuesto, presupuesto_anual
--   Personales (creado_por_usuario_id): el resto
-- ---------------------------------------------------------------------
create table presupuesto.categoria_presupuesto (
  id                             bigint generated always as identity primary key,
  nombre                         text not null,
  tipo                           text,
  categoria_presupuesto_padre_id bigint references presupuesto.categoria_presupuesto(id) on delete set null
);
create table presupuesto.cuenta_presupuesto (
  id                 bigint generated always as identity primary key,
  nombre             text not null,
  tipo               text not null,
  limite_credito     numeric(14,2),
  dia_corte          smallint check (dia_corte between 1 and 31),
  dia_pago           smallint check (dia_pago between 1 and 31),
  pago_minimo        numeric(14,2),
  pago_sin_intereses numeric(14,2)
);
create table presupuesto.presupuesto_anual (
  id            bigint generated always as identity primary key,
  anio          smallint not null,
  fecha_alta    date not null default current_date,
  descripcion   text not null default '',
  estatus_clave text not null
);
create table presupuesto.movimiento_recurrente_presupuesto (
  id                       bigint generated always as identity primary key,
  descripcion              text not null,
  tipo                     text not null,
  cuenta_presupuesto_id    bigint not null references presupuesto.cuenta_presupuesto(id),
  categoria_presupuesto_id bigint references presupuesto.categoria_presupuesto(id) on delete set null,
  monto                    numeric(14,2) not null,
  frecuencia               text not null,
  dia_del_mes              smallint not null check (dia_del_mes between 1 and 31),
  aviso_faltante_ciclo     text,
  creado_por_usuario_id    bigint not null references seguridad.usuario(id) on delete cascade
);
create table presupuesto.movimiento_presupuesto (
  id                       bigint generated always as identity primary key,
  fecha                    date not null,
  tipo                     text not null,
  cuenta_presupuesto_id    bigint not null references presupuesto.cuenta_presupuesto(id),
  categoria_presupuesto_id bigint references presupuesto.categoria_presupuesto(id) on delete set null,
  monto                    numeric(14,2) not null,
  descripcion              text not null default '',
  transferencia_id         uuid,
  origen_recurrente_id     bigint references presupuesto.movimiento_recurrente_presupuesto(id) on delete set null,
  proyectado               boolean not null default false,
  creado_por_usuario_id    bigint not null references seguridad.usuario(id) on delete cascade
);
create index movimiento_presupuesto_fecha_ix on presupuesto.movimiento_presupuesto (creado_por_usuario_id, fecha desc);
create index movimiento_presupuesto_transferencia_ix on presupuesto.movimiento_presupuesto (transferencia_id) where transferencia_id is not null;

create table presupuesto.movimiento_presupuesto_adjunto (
  id                        bigint generated always as identity primary key,
  movimiento_presupuesto_id bigint not null references presupuesto.movimiento_presupuesto(id) on delete cascade,
  nombre_archivo            text not null,
  tipo_contenido            text,
  ruta_storage              text not null,
  tamano_bytes              bigint,
  comentario                text
);
create table presupuesto.movimiento_recurrente_presupuesto_adjunto (
  id                                   bigint generated always as identity primary key,
  movimiento_recurrente_presupuesto_id bigint not null references presupuesto.movimiento_recurrente_presupuesto(id) on delete cascade,
  nombre_archivo                       text not null,
  tipo_contenido                       text,
  ruta_storage                         text not null,
  tamano_bytes                         bigint,
  comentario                           text
);
create table presupuesto.deuda_presupuesto (
  id                    bigint generated always as identity primary key,
  descripcion           text not null,
  monto_original        numeric(14,2) not null,
  saldo_actual          numeric(14,2) not null,
  fecha_inicio          date not null,
  fecha_vencimiento     date,
  creado_por_usuario_id bigint not null references seguridad.usuario(id) on delete cascade
);
create table presupuesto.deuda_presupuesto_abono (
  id                        bigint generated always as identity primary key,
  deuda_presupuesto_id      bigint not null references presupuesto.deuda_presupuesto(id) on delete cascade,
  fecha                     date not null,
  monto                     numeric(14,2) not null,
  nota                      text,
  cuenta_presupuesto_id     bigint references presupuesto.cuenta_presupuesto(id) on delete set null,
  movimiento_presupuesto_id bigint references presupuesto.movimiento_presupuesto(id) on delete set null,
  creado_por_usuario_id     bigint not null references seguridad.usuario(id) on delete cascade
);
create table presupuesto.meta_presupuesto (
  id                    bigint generated always as identity primary key,
  nombre                text not null,
  monto_objetivo        numeric(14,2) not null,
  monto_actual          numeric(14,2) not null default 0,
  fecha_limite          date,
  creado_por_usuario_id bigint not null references seguridad.usuario(id) on delete cascade
);
create table presupuesto.meta_presupuesto_aporte (
  id                        bigint generated always as identity primary key,
  meta_presupuesto_id       bigint not null references presupuesto.meta_presupuesto(id) on delete cascade,
  fecha                     date not null,
  monto                     numeric(14,2) not null,
  nota                      text,
  cuenta_presupuesto_id     bigint references presupuesto.cuenta_presupuesto(id) on delete set null,
  movimiento_presupuesto_id bigint references presupuesto.movimiento_presupuesto(id) on delete set null,
  creado_por_usuario_id     bigint not null references seguridad.usuario(id) on delete cascade
);
-- categoria_presupuesto_id NULL = tope general mensual
create table presupuesto.limite_presupuesto (
  id                       bigint generated always as identity primary key,
  categoria_presupuesto_id bigint references presupuesto.categoria_presupuesto(id) on delete cascade,
  monto_limite             numeric(14,2) not null,
  creado_por_usuario_id    bigint not null references seguridad.usuario(id) on delete cascade
);
create table presupuesto.proyeccion_ajuste (
  id                    bigint generated always as identity primary key,
  quincena              text not null,
  clave                 text not null,
  monto                 numeric(14,2) not null,
  creado_por_usuario_id bigint not null references seguridad.usuario(id) on delete cascade
);
create table presupuesto.aviso_tarjeta_ciclo (
  id                    bigint generated always as identity primary key,
  cuenta_presupuesto_id bigint not null references presupuesto.cuenta_presupuesto(id) on delete cascade,
  usuario_id            bigint not null references seguridad.usuario(id) on delete cascade,
  tipo_aviso            text not null check (tipo_aviso in ('uso','pago')),
  ciclo                 text not null,
  unique (cuenta_presupuesto_id, usuario_id, tipo_aviso, ciclo)
);

-- ---------------------------------------------------------------------
-- GESTIÓN DE PROYECTOS
-- ---------------------------------------------------------------------
create table proyectos.proyecto (
  id         bigint generated always as identity primary key,
  nombre     text not null,
  clave      text not null unique,
  codigo_hex text not null default '#4f46e5'
);
create table proyectos.ticket_tipo (
  id     bigint generated always as identity primary key,
  nombre text not null,
  clave  text not null unique,
  icono  text
);
create table proyectos.ticket_prioridad (
  id             bigint generated always as identity primary key,
  nombre         text not null,
  clave          text not null unique,
  codigo_hex     text not null default '#888888',
  vigencia_horas integer not null default 0,
  aviso_horas    integer not null default 0,
  critica        boolean not null default false
);
create table proyectos.ticket_prioridad_notificar (
  id                  bigint generated always as identity primary key,
  ticket_prioridad_id bigint not null references proyectos.ticket_prioridad(id) on delete cascade,
  usuario_id          bigint not null references seguridad.usuario(id) on delete cascade,
  unique (ticket_prioridad_id, usuario_id)
);
create table proyectos.ticket_modulo (
  id     bigint generated always as identity primary key,
  nombre text not null,
  clave  text not null unique,
  icono  text
);
create table proyectos.tablero_columna (
  id                           bigint generated always as identity primary key,
  proyecto_id                  bigint not null references proyectos.proyecto(id) on delete cascade,
  clave                        text not null,
  nombre                       text not null,
  orden                        integer not null default 0,
  permite_actividades          boolean not null default true,
  permite_anexos               boolean not null default true,
  permite_asociados            boolean not null default true,
  configuracion_campos_json    text,
  transiciones_permitidas_json text,
  posicion_diagrama_json       text,
  unique (proyecto_id, clave)
);
create table proyectos.sprint (
  id          bigint generated always as identity primary key,
  proyecto_id bigint not null references proyectos.proyecto(id) on delete cascade,
  nombre      text not null,
  objetivo    text,
  fecha_inicio date,
  fecha_fin    date,
  estado      text not null default 'planeado' check (estado in ('planeado','activo','cerrado')),
  orden       integer
);
create table proyectos.ticket (
  id                       bigint generated always as identity primary key,
  proyecto_id              bigint not null references proyectos.proyecto(id) on delete cascade,
  tablero_columna_id       bigint not null references proyectos.tablero_columna(id),
  ticket_tipo_id           bigint not null references proyectos.ticket_tipo(id),
  ticket_prioridad_id      bigint not null references proyectos.ticket_prioridad(id),
  ticket_modulo_id         bigint references proyectos.ticket_modulo(id) on delete set null,
  asignado_usuario_id      bigint references seguridad.usuario(id) on delete set null,
  reportado_por_usuario_id bigint not null references seguridad.usuario(id),
  numero_ticket            text not null,
  folio_interno            text,
  titulo                   text not null,
  descripcion              text,
  planeado                 boolean not null default false,
  tiempo_estimado_min      integer,
  fecha_fin_analisis       date,
  fecha_fin_desarrollo     date,
  fecha_fin_cliente        date,
  fecha_inicio             date,
  fecha_fin                date,
  solucion                 text,
  sla_aviso_nivel          text check (sla_aviso_nivel in ('warning','expired')),
  ticket_padre_id          bigint references proyectos.ticket(id) on delete set null,
  sprint_id                bigint references proyectos.sprint(id) on delete set null
);
create index ticket_numero_ix on proyectos.ticket (proyecto_id, numero_ticket);

create table proyectos.ticket_comentario (
  id         bigint generated always as identity primary key,
  ticket_id  bigint not null references proyectos.ticket(id) on delete cascade,
  texto      text not null,
  creado_por bigint
);
create table proyectos.ticket_actividad (
  id         bigint generated always as identity primary key,
  ticket_id  bigint not null references proyectos.ticket(id) on delete cascade,
  texto      text not null,
  tiempo_min integer not null default 0,
  creado_por bigint
);
create table proyectos.ticket_etiqueta (
  id        bigint generated always as identity primary key,
  ticket_id bigint not null references proyectos.ticket(id) on delete cascade,
  texto     text not null
);
create table proyectos.ticket_adjunto (
  id             bigint generated always as identity primary key,
  ticket_id      bigint not null references proyectos.ticket(id) on delete cascade,
  nombre_archivo text not null,
  tipo_contenido text,
  ruta_storage   text not null,
  tamano_bytes   bigint,
  comentario     text
);
create table proyectos.ticket_historial_estado (
  id                          bigint generated always as identity primary key,
  ticket_id                   bigint not null references proyectos.ticket(id) on delete cascade,
  tablero_columna_anterior_id bigint references proyectos.tablero_columna(id) on delete set null,
  tablero_columna_nueva_id    bigint references proyectos.tablero_columna(id) on delete set null,
  usuario_id                  bigint references seguridad.usuario(id) on delete set null
);
create table proyectos.ticket_dependencia (
  id                    bigint generated always as identity primary key,
  ticket_id             bigint not null references proyectos.ticket(id) on delete cascade,
  ticket_relacionado_id bigint not null references proyectos.ticket(id) on delete cascade,
  tipo                  text not null default 'relacionado'
                        check (tipo in ('relacionado','bloquea','bloqueado_por','duplica','duplicado_por')),
  check (ticket_id <> ticket_relacionado_id)
);
create table proyectos.ticket_seguidor (
  id         bigint generated always as identity primary key,
  ticket_id  bigint not null references proyectos.ticket(id) on delete cascade,
  usuario_id bigint not null references seguridad.usuario(id) on delete cascade,
  unique (ticket_id, usuario_id)
);

-- ---------------------------------------------------------------------
-- FAMILIA
-- ---------------------------------------------------------------------
create table familia.miembro_familia (
  id                           bigint generated always as identity primary key,
  nombre                       text not null,
  apellido_paterno             text,
  apellido_materno             text,
  parentesco_clave             text,
  fecha_nacimiento             date,
  sexo                         text,
  entidad_nacimiento           text,
  tipo_sangre                  text,
  telefono                     text,
  foto_ruta                    text,          -- ruta en Storage (antes: base64 en "foto")
  rfc                          text,
  curp                         text,
  alergias                     text,
  condiciones_cronicas         text,
  medicamentos                 text,
  numero_seguro_social         text,
  contacto_emergencia_nombre   text,
  contacto_emergencia_telefono text,
  aseguradora                  text,
  numero_poliza                text,
  padre_id                     bigint references familia.miembro_familia(id) on delete set null,
  madre_id                     bigint references familia.miembro_familia(id) on delete set null,
  conyuge_id                   bigint references familia.miembro_familia(id) on delete set null
);
create table familia.documento_familia (
  id                   bigint generated always as identity primary key,
  miembro_familia_id   bigint not null references familia.miembro_familia(id) on delete cascade,
  tipo_documento_clave text not null,
  fecha_vencimiento    date,
  notas                text
);
create table familia.documento_familia_adjunto (
  id                   bigint generated always as identity primary key,
  documento_familia_id bigint not null references familia.documento_familia(id) on delete cascade,
  nombre_archivo       text not null,
  tipo_contenido       text,
  ruta_storage         text not null,
  tamano_bytes         bigint,
  comentario           text
);
create table familia.vacuna_miembro (
  id                 bigint generated always as identity primary key,
  miembro_familia_id bigint not null references familia.miembro_familia(id) on delete cascade,
  nombre             text not null,
  fecha_aplicacion   date,
  dosis              text,
  notas              text
);
create table familia.vacuna_miembro_adjunto (
  id                bigint generated always as identity primary key,
  vacuna_miembro_id bigint not null references familia.vacuna_miembro(id) on delete cascade,
  nombre_archivo    text not null,
  tipo_contenido    text,
  ruta_storage      text not null,
  tamano_bytes      bigint,
  comentario        text
);
create table familia.cita_medica_miembro (
  id                 bigint generated always as identity primary key,
  miembro_familia_id bigint not null references familia.miembro_familia(id) on delete cascade,
  motivo             text not null,
  especialidad       text,
  fecha              date,
  lugar              text,
  notas              text,
  completada         boolean not null default false
);
create table familia.cita_medica_miembro_adjunto (
  id                     bigint generated always as identity primary key,
  cita_medica_miembro_id bigint not null references familia.cita_medica_miembro(id) on delete cascade,
  nombre_archivo         text not null,
  tipo_contenido         text,
  ruta_storage           text not null,
  tamano_bytes           bigint,
  comentario             text
);
create table familia.poliza_seguro_miembro (
  id                    bigint generated always as identity primary key,
  miembro_familia_id    bigint not null references familia.miembro_familia(id) on delete cascade,
  tipo                  text,
  aseguradora           text,
  numero_poliza         text,
  fecha_vigencia_inicio date,
  fecha_vigencia_fin    date,
  notas                 text,
  suma_asegurada        numeric(14,2)
);
create table familia.medicion_crecimiento (
  id                 bigint generated always as identity primary key,
  miembro_familia_id bigint not null references familia.miembro_familia(id) on delete cascade,
  fecha              date not null,
  peso_kg            numeric(6,2),
  estatura_cm        numeric(6,2),
  notas              text
);
create table familia.contacto_emergencia_miembro (
  id                 bigint generated always as identity primary key,
  miembro_familia_id bigint not null references familia.miembro_familia(id) on delete cascade,
  nombre             text not null,
  relacion           text,
  telefono           text,
  notas              text
);
create table familia.evento_familiar (
  id                 bigint generated always as identity primary key,
  miembro_familia_id bigint references familia.miembro_familia(id) on delete set null,
  titulo             text not null,
  fecha              date not null,
  notas              text
);
create table familia.tarea_hogar (
  id                 bigint generated always as identity primary key,
  titulo             text not null,
  miembro_familia_id bigint references familia.miembro_familia(id) on delete set null,
  frecuencia         text not null default 'unica' check (frecuencia in ('unica','diaria','semanal','mensual')),
  completada         boolean not null default false,
  fecha_limite       date,
  notas              text
);
create table familia.tramite_estado (
  id     bigint generated always as identity primary key,
  nombre text not null,
  orden  integer not null default 0
);
create table familia.tramite_familiar (
  id                 bigint generated always as identity primary key,
  titulo             text not null,
  miembro_familia_id bigint references familia.miembro_familia(id) on delete set null,
  tramite_estado_id  bigint not null references familia.tramite_estado(id),
  fecha_limite       date,
  notas              text
);
