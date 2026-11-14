-- ============================================================================
-- SAURIX — Línea base reproducible (Etapa B5.1) — Esquema: presupuesto
-- Generado por introspección de pg_catalog el 2026-11-11. Ver limitaciones en
-- claude/saurix-correccion2-etapa-b5-1-linea-base-2026-11.md, Bloque A.
-- ============================================================================

create schema if not exists presupuesto;

create table presupuesto.categoria_presupuesto (
  id bigint generated always as identity not null,
  nombre text not null,
  tipo text,
  categoria_presupuesto_padre_id bigint,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.cuenta_presupuesto (
  id bigint generated always as identity not null,
  nombre text not null,
  tipo text not null,
  limite_credito numeric(14,2),
  dia_corte smallint,
  dia_pago smallint,
  pago_minimo numeric(14,2),
  pago_sin_intereses numeric(14,2),
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.deuda_presupuesto (
  id bigint generated always as identity not null,
  descripcion text not null,
  monto_original numeric(14,2) not null,
  saldo_actual numeric(14,2) not null,
  fecha_inicio date not null,
  fecha_vencimiento date,
  creado_por_usuario_id bigint not null default privado.usuario_actual_id(),
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.deuda_presupuesto_abono (
  id bigint generated always as identity not null,
  deuda_presupuesto_id bigint not null,
  fecha date not null,
  monto numeric(14,2) not null,
  nota text,
  cuenta_presupuesto_id bigint,
  movimiento_presupuesto_id bigint,
  creado_por_usuario_id bigint not null default privado.usuario_actual_id(),
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.limite_presupuesto (
  id bigint generated always as identity not null,
  categoria_presupuesto_id bigint,
  monto_limite numeric(14,2) not null,
  creado_por_usuario_id bigint not null default privado.usuario_actual_id(),
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.meta_presupuesto (
  id bigint generated always as identity not null,
  nombre text not null,
  monto_objetivo numeric(14,2) not null,
  monto_actual numeric(14,2) not null default 0,
  fecha_limite date,
  creado_por_usuario_id bigint not null default privado.usuario_actual_id(),
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.meta_presupuesto_aporte (
  id bigint generated always as identity not null,
  meta_presupuesto_id bigint not null,
  fecha date not null,
  monto numeric(14,2) not null,
  nota text,
  cuenta_presupuesto_id bigint,
  movimiento_presupuesto_id bigint,
  creado_por_usuario_id bigint not null default privado.usuario_actual_id(),
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.movimiento_presupuesto (
  id bigint generated always as identity not null,
  fecha date not null,
  tipo text not null,
  cuenta_presupuesto_id bigint,
  categoria_presupuesto_id bigint,
  monto numeric(14,2) not null,
  descripcion text not null default ''::text,
  transferencia_id uuid,
  origen_recurrente_id bigint,
  proyectado boolean not null default false,
  creado_por_usuario_id bigint not null default privado.usuario_actual_id(),
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.movimiento_presupuesto_adjunto (
  id bigint generated always as identity not null,
  movimiento_presupuesto_id bigint not null,
  nombre_archivo text not null,
  tipo_contenido text,
  ruta_storage text not null,
  tamano_bytes bigint,
  comentario text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.movimiento_recurrente_presupuesto (
  id bigint generated always as identity not null,
  descripcion text not null,
  tipo text not null,
  cuenta_presupuesto_id bigint,
  categoria_presupuesto_id bigint,
  monto numeric(14,2) not null,
  frecuencia text not null,
  dia_del_mes smallint not null,
  aviso_faltante_ciclo text,
  creado_por_usuario_id bigint not null default privado.usuario_actual_id(),
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.movimiento_recurrente_presupuesto_adjunto (
  id bigint generated always as identity not null,
  movimiento_recurrente_presupuesto_id bigint not null,
  nombre_archivo text not null,
  tipo_contenido text,
  ruta_storage text not null,
  tamano_bytes bigint,
  comentario text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.presupuesto_anual (
  id bigint generated always as identity not null,
  anio smallint not null,
  fecha_alta date not null default CURRENT_DATE,
  descripcion text not null default ''::text,
  estatus_clave text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table presupuesto.proyeccion_ajuste (
  id bigint generated always as identity not null,
  quincena text not null,
  clave text not null,
  monto numeric(14,2) not null,
  creado_por_usuario_id bigint not null default privado.usuario_actual_id(),
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

alter table presupuesto.categoria_presupuesto enable row level security;

alter table presupuesto.cuenta_presupuesto enable row level security;

alter table presupuesto.deuda_presupuesto enable row level security;

alter table presupuesto.deuda_presupuesto_abono enable row level security;

alter table presupuesto.limite_presupuesto enable row level security;

alter table presupuesto.meta_presupuesto enable row level security;

alter table presupuesto.meta_presupuesto_aporte enable row level security;

alter table presupuesto.movimiento_presupuesto enable row level security;

alter table presupuesto.movimiento_presupuesto_adjunto enable row level security;

alter table presupuesto.movimiento_recurrente_presupuesto enable row level security;

alter table presupuesto.movimiento_recurrente_presupuesto_adjunto enable row level security;

alter table presupuesto.presupuesto_anual enable row level security;

alter table presupuesto.proyeccion_ajuste enable row level security;

alter table presupuesto.categoria_presupuesto add constraint categoria_presupuesto_categoria_presupuesto_padre_id_fkey FOREIGN KEY (categoria_presupuesto_padre_id) REFERENCES presupuesto.categoria_presupuesto(id) ON DELETE SET NULL;

alter table presupuesto.categoria_presupuesto add constraint categoria_presupuesto_pkey PRIMARY KEY (id);

alter table presupuesto.categoria_presupuesto add constraint categoria_presupuesto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.cuenta_presupuesto add constraint cuenta_presupuesto_pkey PRIMARY KEY (id);

alter table presupuesto.cuenta_presupuesto add constraint cuenta_presupuesto_dia_corte_check CHECK (((dia_corte >= 1) AND (dia_corte <= 31)));

alter table presupuesto.cuenta_presupuesto add constraint cuenta_presupuesto_dia_pago_check CHECK (((dia_pago >= 1) AND (dia_pago <= 31)));

alter table presupuesto.cuenta_presupuesto add constraint cuenta_presupuesto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.deuda_presupuesto add constraint deuda_presupuesto_pkey PRIMARY KEY (id);

alter table presupuesto.deuda_presupuesto add constraint deuda_presupuesto_creado_por_usuario_id_fkey FOREIGN KEY (creado_por_usuario_id) REFERENCES seguridad.usuario(id) ON DELETE CASCADE;

alter table presupuesto.deuda_presupuesto add constraint deuda_presupuesto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.deuda_presupuesto_abono add constraint deuda_presupuesto_abono_cuenta_presupuesto_id_fkey FOREIGN KEY (cuenta_presupuesto_id) REFERENCES presupuesto.cuenta_presupuesto(id) ON DELETE SET NULL;

alter table presupuesto.deuda_presupuesto_abono add constraint deuda_presupuesto_abono_deuda_presupuesto_id_fkey FOREIGN KEY (deuda_presupuesto_id) REFERENCES presupuesto.deuda_presupuesto(id) ON DELETE CASCADE;

alter table presupuesto.deuda_presupuesto_abono add constraint deuda_presupuesto_abono_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.deuda_presupuesto_abono add constraint deuda_presupuesto_abono_movimiento_presupuesto_id_fkey FOREIGN KEY (movimiento_presupuesto_id) REFERENCES presupuesto.movimiento_presupuesto(id) ON DELETE SET NULL;

alter table presupuesto.deuda_presupuesto_abono add constraint deuda_presupuesto_abono_pkey PRIMARY KEY (id);

alter table presupuesto.deuda_presupuesto_abono add constraint deuda_presupuesto_abono_creado_por_usuario_id_fkey FOREIGN KEY (creado_por_usuario_id) REFERENCES seguridad.usuario(id) ON DELETE CASCADE;

alter table presupuesto.limite_presupuesto add constraint limite_presupuesto_pkey PRIMARY KEY (id);

alter table presupuesto.limite_presupuesto add constraint limite_presupuesto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.limite_presupuesto add constraint limite_presupuesto_creado_por_usuario_id_fkey FOREIGN KEY (creado_por_usuario_id) REFERENCES seguridad.usuario(id) ON DELETE CASCADE;

alter table presupuesto.limite_presupuesto add constraint limite_presupuesto_categoria_presupuesto_id_fkey FOREIGN KEY (categoria_presupuesto_id) REFERENCES presupuesto.categoria_presupuesto(id) ON DELETE CASCADE;

alter table presupuesto.meta_presupuesto add constraint meta_presupuesto_creado_por_usuario_id_fkey FOREIGN KEY (creado_por_usuario_id) REFERENCES seguridad.usuario(id) ON DELETE CASCADE;

alter table presupuesto.meta_presupuesto add constraint meta_presupuesto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.meta_presupuesto add constraint meta_presupuesto_pkey PRIMARY KEY (id);

alter table presupuesto.meta_presupuesto_aporte add constraint meta_presupuesto_aporte_cuenta_presupuesto_id_fkey FOREIGN KEY (cuenta_presupuesto_id) REFERENCES presupuesto.cuenta_presupuesto(id) ON DELETE SET NULL;

alter table presupuesto.meta_presupuesto_aporte add constraint meta_presupuesto_aporte_creado_por_usuario_id_fkey FOREIGN KEY (creado_por_usuario_id) REFERENCES seguridad.usuario(id) ON DELETE CASCADE;

alter table presupuesto.meta_presupuesto_aporte add constraint meta_presupuesto_aporte_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.meta_presupuesto_aporte add constraint meta_presupuesto_aporte_meta_presupuesto_id_fkey FOREIGN KEY (meta_presupuesto_id) REFERENCES presupuesto.meta_presupuesto(id) ON DELETE CASCADE;

alter table presupuesto.meta_presupuesto_aporte add constraint meta_presupuesto_aporte_movimiento_presupuesto_id_fkey FOREIGN KEY (movimiento_presupuesto_id) REFERENCES presupuesto.movimiento_presupuesto(id) ON DELETE SET NULL;

alter table presupuesto.meta_presupuesto_aporte add constraint meta_presupuesto_aporte_pkey PRIMARY KEY (id);

alter table presupuesto.movimiento_presupuesto add constraint movimiento_presupuesto_creado_por_usuario_id_fkey FOREIGN KEY (creado_por_usuario_id) REFERENCES seguridad.usuario(id) ON DELETE CASCADE;

alter table presupuesto.movimiento_presupuesto add constraint movimiento_presupuesto_origen_recurrente_id_fkey FOREIGN KEY (origen_recurrente_id) REFERENCES presupuesto.movimiento_recurrente_presupuesto(id) ON DELETE SET NULL;

alter table presupuesto.movimiento_presupuesto add constraint movimiento_presupuesto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.movimiento_presupuesto add constraint movimiento_presupuesto_cuenta_presupuesto_id_fkey FOREIGN KEY (cuenta_presupuesto_id) REFERENCES presupuesto.cuenta_presupuesto(id);

alter table presupuesto.movimiento_presupuesto add constraint movimiento_presupuesto_pkey PRIMARY KEY (id);

alter table presupuesto.movimiento_presupuesto add constraint movimiento_presupuesto_categoria_presupuesto_id_fkey FOREIGN KEY (categoria_presupuesto_id) REFERENCES presupuesto.categoria_presupuesto(id) ON DELETE SET NULL;

alter table presupuesto.movimiento_presupuesto_adjunto add constraint movimiento_presupuesto_adjunto_movimiento_presupuesto_id_fkey FOREIGN KEY (movimiento_presupuesto_id) REFERENCES presupuesto.movimiento_presupuesto(id) ON DELETE CASCADE;

alter table presupuesto.movimiento_presupuesto_adjunto add constraint movimiento_presupuesto_adjunto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.movimiento_presupuesto_adjunto add constraint movimiento_presupuesto_adjunto_pkey PRIMARY KEY (id);

alter table presupuesto.movimiento_recurrente_presupuesto add constraint movimiento_recurrente_presupuesto_creado_por_usuario_id_fkey FOREIGN KEY (creado_por_usuario_id) REFERENCES seguridad.usuario(id) ON DELETE CASCADE;

alter table presupuesto.movimiento_recurrente_presupuesto add constraint movimiento_recurrente_presupuesto_pkey PRIMARY KEY (id);

alter table presupuesto.movimiento_recurrente_presupuesto add constraint movimiento_recurrente_presupuesto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.movimiento_recurrente_presupuesto add constraint movimiento_recurrente_presupuesto_dia_del_mes_check CHECK (((dia_del_mes >= 1) AND (dia_del_mes <= 31)));

alter table presupuesto.movimiento_recurrente_presupuesto add constraint movimiento_recurrente_presupuesto_cuenta_presupuesto_id_fkey FOREIGN KEY (cuenta_presupuesto_id) REFERENCES presupuesto.cuenta_presupuesto(id);

alter table presupuesto.movimiento_recurrente_presupuesto add constraint movimiento_recurrente_presupuesto_categoria_presupuesto_id_fkey FOREIGN KEY (categoria_presupuesto_id) REFERENCES presupuesto.categoria_presupuesto(id) ON DELETE SET NULL;

alter table presupuesto.movimiento_recurrente_presupuesto_adjunto add constraint movimiento_recurrente_presupu_movimiento_recurrente_presup_fkey FOREIGN KEY (movimiento_recurrente_presupuesto_id) REFERENCES presupuesto.movimiento_recurrente_presupuesto(id) ON DELETE CASCADE;

alter table presupuesto.movimiento_recurrente_presupuesto_adjunto add constraint movimiento_recurrente_presupuesto_adjunto_pkey PRIMARY KEY (id);

alter table presupuesto.movimiento_recurrente_presupuesto_adjunto add constraint movimiento_recurrente_presupuesto_adjunto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.presupuesto_anual add constraint presupuesto_anual_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.presupuesto_anual add constraint presupuesto_anual_pkey PRIMARY KEY (id);

alter table presupuesto.proyeccion_ajuste add constraint proyeccion_ajuste_creado_por_usuario_id_fkey FOREIGN KEY (creado_por_usuario_id) REFERENCES seguridad.usuario(id) ON DELETE CASCADE;

alter table presupuesto.proyeccion_ajuste add constraint proyeccion_ajuste_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table presupuesto.proyeccion_ajuste add constraint proyeccion_ajuste_pkey PRIMARY KEY (id);

CREATE INDEX categoria_presupuesto_categoria_presupuesto_padre_id_ix ON presupuesto.categoria_presupuesto USING btree (categoria_presupuesto_padre_id);

CREATE INDEX categoria_presupuesto_empresa_id_ix ON presupuesto.categoria_presupuesto USING btree (empresa_id);

CREATE INDEX cuenta_presupuesto_empresa_id_ix ON presupuesto.cuenta_presupuesto USING btree (empresa_id);

CREATE INDEX deuda_presupuesto_creado_por_usuario_id_ix ON presupuesto.deuda_presupuesto USING btree (creado_por_usuario_id);

CREATE INDEX deuda_presupuesto_empresa_id_ix ON presupuesto.deuda_presupuesto USING btree (empresa_id);

CREATE INDEX deuda_presupuesto_abono_creado_por_usuario_id_ix ON presupuesto.deuda_presupuesto_abono USING btree (creado_por_usuario_id);

CREATE INDEX deuda_presupuesto_abono_movimiento_presupuesto_id_ix ON presupuesto.deuda_presupuesto_abono USING btree (movimiento_presupuesto_id);

CREATE INDEX deuda_presupuesto_abono_empresa_id_ix ON presupuesto.deuda_presupuesto_abono USING btree (empresa_id);

CREATE INDEX deuda_presupuesto_abono_deuda_presupuesto_id_ix ON presupuesto.deuda_presupuesto_abono USING btree (deuda_presupuesto_id);

CREATE INDEX deuda_presupuesto_abono_cuenta_presupuesto_id_ix ON presupuesto.deuda_presupuesto_abono USING btree (cuenta_presupuesto_id);

CREATE INDEX limite_presupuesto_creado_por_usuario_id_ix ON presupuesto.limite_presupuesto USING btree (creado_por_usuario_id);

CREATE INDEX limite_presupuesto_empresa_id_ix ON presupuesto.limite_presupuesto USING btree (empresa_id);

CREATE INDEX limite_presupuesto_categoria_presupuesto_id_ix ON presupuesto.limite_presupuesto USING btree (categoria_presupuesto_id);

CREATE INDEX meta_presupuesto_creado_por_usuario_id_ix ON presupuesto.meta_presupuesto USING btree (creado_por_usuario_id);

CREATE INDEX meta_presupuesto_empresa_id_ix ON presupuesto.meta_presupuesto USING btree (empresa_id);

CREATE INDEX meta_presupuesto_aporte_creado_por_usuario_id_ix ON presupuesto.meta_presupuesto_aporte USING btree (creado_por_usuario_id);

CREATE INDEX meta_presupuesto_aporte_cuenta_presupuesto_id_ix ON presupuesto.meta_presupuesto_aporte USING btree (cuenta_presupuesto_id);

CREATE INDEX meta_presupuesto_aporte_meta_presupuesto_id_ix ON presupuesto.meta_presupuesto_aporte USING btree (meta_presupuesto_id);

CREATE INDEX meta_presupuesto_aporte_movimiento_presupuesto_id_ix ON presupuesto.meta_presupuesto_aporte USING btree (movimiento_presupuesto_id);

CREATE INDEX meta_presupuesto_aporte_empresa_id_ix ON presupuesto.meta_presupuesto_aporte USING btree (empresa_id);

CREATE INDEX movimiento_presupuesto_categoria_presupuesto_id_ix ON presupuesto.movimiento_presupuesto USING btree (categoria_presupuesto_id);

CREATE INDEX movimiento_presupuesto_origen_recurrente_id_ix ON presupuesto.movimiento_presupuesto USING btree (origen_recurrente_id);

CREATE INDEX movimiento_presupuesto_transferencia_ix ON presupuesto.movimiento_presupuesto USING btree (transferencia_id) WHERE (transferencia_id IS NOT NULL);

CREATE INDEX movimiento_presupuesto_cuenta_presupuesto_id_ix ON presupuesto.movimiento_presupuesto USING btree (cuenta_presupuesto_id);

CREATE INDEX movimiento_presupuesto_fecha_ix ON presupuesto.movimiento_presupuesto USING btree (creado_por_usuario_id, fecha DESC);

CREATE INDEX movimiento_presupuesto_empresa_id_ix ON presupuesto.movimiento_presupuesto USING btree (empresa_id);

CREATE INDEX movimiento_presupuesto_adjunto_movimiento_presupuesto_id_ix ON presupuesto.movimiento_presupuesto_adjunto USING btree (movimiento_presupuesto_id);

CREATE INDEX movimiento_presupuesto_adjunto_empresa_id_ix ON presupuesto.movimiento_presupuesto_adjunto USING btree (empresa_id);

CREATE INDEX movimiento_recurrente_presupuesto_creado_por_usuario_id_ix ON presupuesto.movimiento_recurrente_presupuesto USING btree (creado_por_usuario_id);

CREATE INDEX movimiento_recurrente_presupuesto_cuenta_presupuesto_id_ix ON presupuesto.movimiento_recurrente_presupuesto USING btree (cuenta_presupuesto_id);

CREATE INDEX movimiento_recurrente_presupuesto_categoria_presupuesto_id_ix ON presupuesto.movimiento_recurrente_presupuesto USING btree (categoria_presupuesto_id);

CREATE INDEX movimiento_recurrente_presupuesto_empresa_id_ix ON presupuesto.movimiento_recurrente_presupuesto USING btree (empresa_id);

CREATE INDEX movimiento_recurrente_presupuesto_adjunto_empresa_id_ix ON presupuesto.movimiento_recurrente_presupuesto_adjunto USING btree (empresa_id);

CREATE INDEX movimiento_recurrente_presupuesto_adjunto_movimiento_recurrente ON presupuesto.movimiento_recurrente_presupuesto_adjunto USING btree (movimiento_recurrente_presupuesto_id);

CREATE INDEX presupuesto_anual_empresa_id_ix ON presupuesto.presupuesto_anual USING btree (empresa_id);

CREATE INDEX proyeccion_ajuste_empresa_id_ix ON presupuesto.proyeccion_ajuste USING btree (empresa_id);

CREATE INDEX proyeccion_ajuste_creado_por_usuario_id_ix ON presupuesto.proyeccion_ajuste USING btree (creado_por_usuario_id);

create policy solo_mi_empresa on presupuesto.categoria_presupuesto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on presupuesto.categoria_presupuesto as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on presupuesto.categoria_presupuesto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy solo_mi_empresa on presupuesto.cuenta_presupuesto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on presupuesto.cuenta_presupuesto as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on presupuesto.cuenta_presupuesto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy modulo_habilitado on presupuesto.deuda_presupuesto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy personal_todo on presupuesto.deuda_presupuesto as permissive for ALL to authenticated
  using ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)))
  with check ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)));

create policy solo_mi_empresa on presupuesto.deuda_presupuesto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on presupuesto.deuda_presupuesto_abono as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy personal_todo on presupuesto.deuda_presupuesto_abono as permissive for ALL to authenticated
  using ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)))
  with check ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)));

create policy solo_mi_empresa on presupuesto.deuda_presupuesto_abono as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on presupuesto.limite_presupuesto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on presupuesto.limite_presupuesto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy personal_todo on presupuesto.limite_presupuesto as permissive for ALL to authenticated
  using ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)))
  with check ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)));

create policy solo_mi_empresa on presupuesto.meta_presupuesto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on presupuesto.meta_presupuesto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy personal_todo on presupuesto.meta_presupuesto as permissive for ALL to authenticated
  using ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)))
  with check ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)));

create policy solo_mi_empresa on presupuesto.meta_presupuesto_aporte as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy personal_todo on presupuesto.meta_presupuesto_aporte as permissive for ALL to authenticated
  using ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)))
  with check ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)));

create policy modulo_habilitado on presupuesto.meta_presupuesto_aporte as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy modulo_habilitado on presupuesto.movimiento_presupuesto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy personal_todo on presupuesto.movimiento_presupuesto as permissive for ALL to authenticated
  using ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)))
  with check ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)));

create policy solo_mi_empresa on presupuesto.movimiento_presupuesto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on presupuesto.movimiento_presupuesto_adjunto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on presupuesto.movimiento_presupuesto_adjunto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy personal_todo on presupuesto.movimiento_presupuesto_adjunto as permissive for ALL to authenticated
  using ((EXISTS ( SELECT 1
   FROM presupuesto.movimiento_presupuesto m
  WHERE ((m.id = movimiento_presupuesto_adjunto.movimiento_presupuesto_id) AND (m.creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id))))))
  with check ((EXISTS ( SELECT 1
   FROM presupuesto.movimiento_presupuesto m
  WHERE ((m.id = movimiento_presupuesto_adjunto.movimiento_presupuesto_id) AND (m.creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id))))));

create policy solo_mi_empresa on presupuesto.movimiento_recurrente_presupuesto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy personal_todo on presupuesto.movimiento_recurrente_presupuesto as permissive for ALL to authenticated
  using ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)))
  with check ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)));

create policy modulo_habilitado on presupuesto.movimiento_recurrente_presupuesto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy solo_mi_empresa on presupuesto.movimiento_recurrente_presupuesto_adjunto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy personal_todo on presupuesto.movimiento_recurrente_presupuesto_adjunto as permissive for ALL to authenticated
  using ((EXISTS ( SELECT 1
   FROM presupuesto.movimiento_recurrente_presupuesto m
  WHERE ((m.id = movimiento_recurrente_presupuesto_adjunto.movimiento_recurrente_presupuesto_id) AND (m.creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id))))))
  with check ((EXISTS ( SELECT 1
   FROM presupuesto.movimiento_recurrente_presupuesto m
  WHERE ((m.id = movimiento_recurrente_presupuesto_adjunto.movimiento_recurrente_presupuesto_id) AND (m.creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id))))));

create policy modulo_habilitado on presupuesto.movimiento_recurrente_presupuesto_adjunto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy solo_mi_empresa on presupuesto.presupuesto_anual as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on presupuesto.presupuesto_anual as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy compartida_todo on presupuesto.presupuesto_anual as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on presupuesto.proyeccion_ajuste as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('presupuesto'::text) AS modulo_habilitado));

create policy personal_todo on presupuesto.proyeccion_ajuste as permissive for ALL to authenticated
  using ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)))
  with check ((creado_por_usuario_id = ( SELECT privado.usuario_actual_id() AS usuario_actual_id)));

create policy solo_mi_empresa on presupuesto.proyeccion_ajuste as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.categoria_presupuesto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.cuenta_presupuesto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.deuda_presupuesto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.deuda_presupuesto_abono FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.limite_presupuesto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.meta_presupuesto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.meta_presupuesto_aporte FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.movimiento_presupuesto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.movimiento_presupuesto_adjunto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.movimiento_recurrente_presupuesto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.movimiento_recurrente_presupuesto_adjunto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.presupuesto_anual FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON presupuesto.proyeccion_ajuste FOR EACH ROW EXECUTE FUNCTION privado.auditoria();
