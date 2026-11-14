-- ============================================================================
-- SAURIX — Línea base reproducible (Etapa B5.1, corregida en Corrección 1,
-- 2026-11-11) — Esquema: inventario. NOVENO archivo a ejecutar — DESPUÉS de
-- 02_seguridad.sql (FK hacia seguridad.empresa/usuario) y ANTES de
-- 10_ventas.sql (ventas tiene FK hacia inventario.producto/bodega/
-- tipo_lista_precio, y además varias funciones `language sql` de ventas
-- referencian tablas de inventario — si inventario no existe aún, esas
-- funciones de ventas fallarían al crearse, no solo al ejecutarse). Ver
-- 13_procedimiento_reconstruccion.md para el orden completo.
-- Generado por introspección de pg_catalog el 2026-11-11 (pg_get_functiondef,
-- pg_get_constraintdef, pg_get_indexdef, pg_get_triggerdef, pg_policies).
-- No se dispone de pg_dump/psql con credenciales de conexión en este entorno;
-- esta extracción NO debe asumirse equivalente a un pg_dump --schema-only
-- completo sin verificarlo. Ver limitaciones y alcance en el informe:
-- claude/saurix-correccion2-etapa-b5-1-linea-base-2026-11.md, Bloque A.
--
-- CORRECCIÓN 1 (2026-11-11): la función inventario.fn_trigger_procesar_foto_producto()
-- ya NO tiene la URL ni la clave anon codificadas (hardcoded). Ahora usa
-- privado.fn_config_imagenes_requerida() (01_privado.sql), igual que las 2
-- funciones equivalentes de 02_seguridad.sql — ver el detalle completo en
-- claude/saurix-b5-1-correccion1-validacion-linea-base-2026-11.md, Bloque B.
-- ============================================================================

create schema if not exists inventario;

create table inventario.bodega (
  id bigint not null,
  nombre text not null,
  clave text not null,
  direccion text,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.categoria_producto (
  id bigint not null,
  nombre text not null,
  clave text not null,
  descripcion text,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.conteo_fisico (
  id bigint not null,
  bodega_id bigint not null,
  usuario_id bigint not null,
  fecha timestamp with time zone default now() not null,
  total_productos integer default 0 not null,
  total_diferencias integer default 0 not null,
  notas text,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.conteo_fisico_detalle (
  id bigint not null,
  conteo_fisico_id bigint not null,
  producto_id bigint not null,
  sistema numeric(14,2) not null,
  contado numeric(14,2) not null,
  diferencia numeric(14,2) not null,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.existencia_bodega (
  id bigint not null,
  producto_id bigint not null,
  bodega_id bigint not null,
  existencia numeric(14,2) default 0 not null,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null,
  ubicacion text
);

create table inventario.existencia_producto_resumen (
  producto_id bigint not null,
  empresa_id bigint not null,
  existencia_total numeric default 0 not null
);

create table inventario.importacion_producto (
  id uuid not null,
  empresa_id bigint default privado.empresa_actual_id() not null,
  creado_por bigint default privado.usuario_actual_id(),
  fecha_creacion timestamp with time zone default now() not null,
  total_filas integer not null,
  productos_creados integer not null
);

create table inventario.lote_producto (
  id bigint not null,
  producto_id bigint not null,
  bodega_id bigint,
  lote text not null,
  fecha_caducidad date,
  cantidad numeric(14,2),
  notas text,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.movimiento_inventario (
  id bigint not null,
  producto_id bigint not null,
  bodega_origen_id bigint,
  bodega_destino_id bigint,
  cantidad numeric(14,2) not null,
  fecha date default CURRENT_DATE not null,
  nota text,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null,
  orden_compra_id bigint,
  costo_unitario numeric(14,2),
  en_transito boolean default false not null,
  fecha_recepcion timestamp with time zone,
  operacion_masiva_id uuid
);

create table inventario.nivel_minimo_bodega (
  id bigint not null,
  producto_id bigint not null,
  bodega_id bigint not null,
  nivel_minimo numeric(14,2) not null,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.orden_compra (
  id bigint not null,
  folio text not null,
  proveedor_id bigint not null,
  bodega_destino_id bigint not null,
  estado text default 'pendiente'::text not null,
  fecha date default CURRENT_DATE not null,
  fecha_entrega_estimada date,
  notas text,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.orden_compra_item (
  id bigint not null,
  orden_compra_id bigint not null,
  producto_id bigint not null,
  cantidad numeric(14,2) not null,
  costo_unitario numeric(14,2) default 0 not null,
  cantidad_recibida numeric(14,2) default 0 not null,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null,
  unidad_id bigint,
  factor_conversion numeric(14,4) default 1 not null
);

create table inventario.precio_lista (
  id bigint not null,
  tipo_lista_precio_id bigint not null,
  producto_id bigint not null,
  precio numeric(14,2) default 0 not null,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.producto (
  id bigint not null,
  nombre text not null,
  codigo text,
  categoria_producto_id bigint not null,
  unidad_medida_id bigint not null,
  descripcion text,
  costo numeric(14,2) default 0 not null,
  precio_unitario numeric(14,2) default 0 not null,
  existencia numeric(14,2),
  nivel_minimo numeric(14,2),
  proveedor_id bigint,
  foto text,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null,
  unidad_compra_id bigint,
  factor_conversion_compra numeric(14,4),
  nivel_maximo numeric(14,2),
  maneja_lotes boolean default false not null,
  destacado boolean default false not null,
  foto_thumb_url text,
  foto_detalle_url text,
  foto_version bigint default 0 not null,
  importacion_id uuid
);

create table inventario.producto_opcion_grupo (
  id bigint not null,
  producto_id bigint not null,
  nombre text not null,
  tipo_seleccion text default 'unica'::text not null,
  requerido boolean default true not null,
  minimo integer default 1 not null,
  maximo integer default 1 not null,
  orden integer default 0 not null,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.producto_opcion_valor (
  id bigint not null,
  grupo_id bigint not null,
  nombre text not null,
  precio_adicional numeric(14,2) default 0 not null,
  orden integer default 0 not null,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.producto_proveedor (
  id bigint not null,
  producto_id bigint not null,
  proveedor_id bigint not null,
  precio_compra numeric(14,2) default 0 not null,
  tiempo_entrega_dias integer,
  preferido boolean default false not null,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.producto_valor_resumen (
  producto_id bigint not null,
  empresa_id bigint not null,
  categoria_id bigint,
  costo numeric default 0 not null,
  precio_unitario numeric default 0 not null,
  existencia numeric default 0 not null,
  valor_costo numeric default 0 not null,
  valor_venta numeric default 0 not null,
  es_sin_existencia boolean default false not null,
  es_stock_bajo boolean default false not null,
  es_sobre_stock boolean default false not null
);

create table inventario.proveedor (
  id bigint not null,
  nombre text not null,
  contacto text,
  telefono text,
  correo text,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.tipo_lista_precio (
  id bigint not null,
  nombre text not null,
  clave text not null,
  descripcion text,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

create table inventario.ultimo_movimiento_producto (
  producto_id bigint not null,
  empresa_id bigint not null,
  ultima_fecha date not null
);

create table inventario.unidad_medida (
  id bigint not null,
  nombre text not null,
  clave text not null,
  fecha_creacion timestamp with time zone default now() not null,
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean default true not null,
  empresa_id bigint default privado.empresa_actual_id() not null
);

alter table inventario.bodega enable row level security;

alter table inventario.categoria_producto enable row level security;

alter table inventario.conteo_fisico enable row level security;

alter table inventario.conteo_fisico_detalle enable row level security;

alter table inventario.existencia_bodega enable row level security;

alter table inventario.existencia_producto_resumen enable row level security;

alter table inventario.importacion_producto enable row level security;

alter table inventario.lote_producto enable row level security;

alter table inventario.movimiento_inventario enable row level security;

alter table inventario.nivel_minimo_bodega enable row level security;

alter table inventario.orden_compra enable row level security;

alter table inventario.orden_compra_item enable row level security;

alter table inventario.precio_lista enable row level security;

alter table inventario.producto enable row level security;

alter table inventario.producto_opcion_grupo enable row level security;

alter table inventario.producto_opcion_valor enable row level security;

alter table inventario.producto_proveedor enable row level security;

alter table inventario.producto_valor_resumen enable row level security;

alter table inventario.proveedor enable row level security;

alter table inventario.tipo_lista_precio enable row level security;

alter table inventario.ultimo_movimiento_producto enable row level security;

alter table inventario.unidad_medida enable row level security;

alter table inventario.bodega add constraint bodega_pkey PRIMARY KEY (id);

alter table inventario.bodega add constraint bodega_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.categoria_producto add constraint categoria_producto_pkey PRIMARY KEY (id);

alter table inventario.categoria_producto add constraint categoria_producto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.conteo_fisico add constraint conteo_fisico_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES seguridad.usuario(id) ON DELETE CASCADE;

alter table inventario.conteo_fisico add constraint conteo_fisico_pkey PRIMARY KEY (id);

alter table inventario.conteo_fisico add constraint conteo_fisico_bodega_id_fkey FOREIGN KEY (bodega_id) REFERENCES inventario.bodega(id) ON DELETE CASCADE;

alter table inventario.conteo_fisico add constraint conteo_fisico_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.conteo_fisico_detalle add constraint conteo_fisico_detalle_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.conteo_fisico_detalle add constraint conteo_fisico_detalle_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.conteo_fisico_detalle add constraint conteo_fisico_detalle_conteo_fisico_id_fkey FOREIGN KEY (conteo_fisico_id) REFERENCES inventario.conteo_fisico(id) ON DELETE CASCADE;

alter table inventario.conteo_fisico_detalle add constraint conteo_fisico_detalle_pkey PRIMARY KEY (id);

alter table inventario.existencia_bodega add constraint existencia_bodega_pkey PRIMARY KEY (id);

alter table inventario.existencia_bodega add constraint existencia_bodega_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.existencia_bodega add constraint existencia_bodega_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.existencia_bodega add constraint existencia_bodega_producto_id_bodega_id_key UNIQUE (producto_id, bodega_id);

alter table inventario.existencia_bodega add constraint existencia_bodega_bodega_id_fkey FOREIGN KEY (bodega_id) REFERENCES inventario.bodega(id) ON DELETE CASCADE;

alter table inventario.existencia_producto_resumen add constraint existencia_producto_resumen_pkey PRIMARY KEY (producto_id);

alter table inventario.existencia_producto_resumen add constraint existencia_producto_resumen_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.importacion_producto add constraint importacion_producto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.importacion_producto add constraint importacion_producto_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES seguridad.usuario(id);

alter table inventario.importacion_producto add constraint importacion_producto_pkey PRIMARY KEY (id);

alter table inventario.lote_producto add constraint lote_producto_pkey PRIMARY KEY (id);

alter table inventario.lote_producto add constraint lote_producto_bodega_id_fkey FOREIGN KEY (bodega_id) REFERENCES inventario.bodega(id);

alter table inventario.lote_producto add constraint lote_producto_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.lote_producto add constraint lote_producto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.movimiento_inventario add constraint movimiento_inventario_orden_compra_id_fkey FOREIGN KEY (orden_compra_id) REFERENCES inventario.orden_compra(id) ON DELETE SET NULL;

alter table inventario.movimiento_inventario add constraint movimiento_inventario_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.movimiento_inventario add constraint movimiento_inventario_pkey PRIMARY KEY (id);

alter table inventario.movimiento_inventario add constraint movimiento_inventario_bodega_origen_id_fkey FOREIGN KEY (bodega_origen_id) REFERENCES inventario.bodega(id) ON DELETE SET NULL;

alter table inventario.movimiento_inventario add constraint movimiento_inventario_check CHECK (((bodega_origen_id IS NOT NULL) OR (bodega_destino_id IS NOT NULL)));

alter table inventario.movimiento_inventario add constraint movimiento_inventario_bodega_destino_id_fkey FOREIGN KEY (bodega_destino_id) REFERENCES inventario.bodega(id) ON DELETE SET NULL;

alter table inventario.movimiento_inventario add constraint movimiento_inventario_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.nivel_minimo_bodega add constraint nivel_minimo_bodega_producto_id_bodega_id_key UNIQUE (producto_id, bodega_id);

alter table inventario.nivel_minimo_bodega add constraint nivel_minimo_bodega_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.nivel_minimo_bodega add constraint nivel_minimo_bodega_bodega_id_fkey FOREIGN KEY (bodega_id) REFERENCES inventario.bodega(id) ON DELETE CASCADE;

alter table inventario.nivel_minimo_bodega add constraint nivel_minimo_bodega_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.nivel_minimo_bodega add constraint nivel_minimo_bodega_pkey PRIMARY KEY (id);

alter table inventario.orden_compra add constraint orden_compra_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'recibida_parcial'::text, 'recibida_completa'::text, 'cancelada'::text])));

alter table inventario.orden_compra add constraint orden_compra_bodega_destino_id_fkey FOREIGN KEY (bodega_destino_id) REFERENCES inventario.bodega(id) ON DELETE CASCADE;

alter table inventario.orden_compra add constraint orden_compra_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.orden_compra add constraint orden_compra_pkey PRIMARY KEY (id);

alter table inventario.orden_compra add constraint orden_compra_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES inventario.proveedor(id) ON DELETE CASCADE;

alter table inventario.orden_compra_item add constraint orden_compra_item_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.orden_compra_item add constraint orden_compra_item_unidad_id_fkey FOREIGN KEY (unidad_id) REFERENCES inventario.unidad_medida(id);

alter table inventario.orden_compra_item add constraint orden_compra_item_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.orden_compra_item add constraint orden_compra_item_pkey PRIMARY KEY (id);

alter table inventario.orden_compra_item add constraint orden_compra_item_orden_compra_id_fkey FOREIGN KEY (orden_compra_id) REFERENCES inventario.orden_compra(id) ON DELETE CASCADE;

alter table inventario.precio_lista add constraint precio_lista_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.precio_lista add constraint precio_lista_tipo_lista_precio_id_producto_id_key UNIQUE (tipo_lista_precio_id, producto_id);

alter table inventario.precio_lista add constraint precio_lista_tipo_lista_precio_id_fkey FOREIGN KEY (tipo_lista_precio_id) REFERENCES inventario.tipo_lista_precio(id) ON DELETE CASCADE;

alter table inventario.precio_lista add constraint precio_lista_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.precio_lista add constraint precio_lista_pkey PRIMARY KEY (id);

alter table inventario.producto add constraint producto_importacion_id_fkey FOREIGN KEY (importacion_id) REFERENCES inventario.importacion_producto(id);

alter table inventario.producto add constraint producto_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.producto add constraint producto_categoria_producto_id_fkey FOREIGN KEY (categoria_producto_id) REFERENCES inventario.categoria_producto(id);

alter table inventario.producto add constraint producto_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES inventario.proveedor(id) ON DELETE SET NULL;

alter table inventario.producto add constraint producto_unidad_compra_id_fkey FOREIGN KEY (unidad_compra_id) REFERENCES inventario.unidad_medida(id);

alter table inventario.producto add constraint producto_unidad_medida_id_fkey FOREIGN KEY (unidad_medida_id) REFERENCES inventario.unidad_medida(id);

alter table inventario.producto add constraint producto_pkey PRIMARY KEY (id);

alter table inventario.producto_opcion_grupo add constraint producto_opcion_grupo_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.producto_opcion_grupo add constraint producto_opcion_grupo_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.producto_opcion_grupo add constraint producto_opcion_grupo_tipo_seleccion_check CHECK ((tipo_seleccion = ANY (ARRAY['unica'::text, 'multiple'::text])));

alter table inventario.producto_opcion_grupo add constraint producto_opcion_grupo_pkey PRIMARY KEY (id);

alter table inventario.producto_opcion_valor add constraint producto_opcion_valor_pkey PRIMARY KEY (id);

alter table inventario.producto_opcion_valor add constraint producto_opcion_valor_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.producto_opcion_valor add constraint producto_opcion_valor_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES inventario.producto_opcion_grupo(id) ON DELETE CASCADE;

alter table inventario.producto_proveedor add constraint producto_proveedor_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.producto_proveedor add constraint producto_proveedor_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.producto_proveedor add constraint producto_proveedor_pkey PRIMARY KEY (id);

alter table inventario.producto_proveedor add constraint producto_proveedor_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES inventario.proveedor(id) ON DELETE CASCADE;

alter table inventario.producto_proveedor add constraint producto_proveedor_producto_id_proveedor_id_key UNIQUE (producto_id, proveedor_id);

alter table inventario.producto_valor_resumen add constraint producto_valor_resumen_pkey PRIMARY KEY (producto_id);

alter table inventario.producto_valor_resumen add constraint producto_valor_resumen_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.proveedor add constraint proveedor_pkey PRIMARY KEY (id);

alter table inventario.proveedor add constraint proveedor_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.tipo_lista_precio add constraint tipo_lista_precio_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.tipo_lista_precio add constraint tipo_lista_precio_pkey PRIMARY KEY (id);

alter table inventario.ultimo_movimiento_producto add constraint ultimo_movimiento_producto_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE CASCADE;

alter table inventario.ultimo_movimiento_producto add constraint ultimo_movimiento_producto_pkey PRIMARY KEY (producto_id);

alter table inventario.unidad_medida add constraint unidad_medida_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table inventario.unidad_medida add constraint unidad_medida_pkey PRIMARY KEY (id);

CREATE INDEX bodega_empresa_id_ix ON inventario.bodega USING btree (empresa_id);

CREATE UNIQUE INDEX bodega_empresa_clave_uk ON inventario.bodega USING btree (empresa_id, clave);

CREATE UNIQUE INDEX categoria_producto_empresa_clave_uk ON inventario.categoria_producto USING btree (empresa_id, clave);

CREATE INDEX categoria_producto_empresa_id_ix ON inventario.categoria_producto USING btree (empresa_id);

CREATE INDEX conteo_fisico_bodega_id_ix ON inventario.conteo_fisico USING btree (bodega_id);

CREATE INDEX conteo_fisico_empresa_id_ix ON inventario.conteo_fisico USING btree (empresa_id);

CREATE INDEX conteo_fisico_empresa_fecha_ix ON inventario.conteo_fisico USING btree (empresa_id, fecha DESC, id DESC);

CREATE INDEX conteo_fisico_usuario_id_ix ON inventario.conteo_fisico USING btree (usuario_id);

CREATE INDEX conteo_fisico_detalle_conteo_fisico_id_ix ON inventario.conteo_fisico_detalle USING btree (conteo_fisico_id);

CREATE INDEX conteo_fisico_detalle_producto_id_ix ON inventario.conteo_fisico_detalle USING btree (producto_id);

CREATE INDEX conteo_fisico_detalle_empresa_id_ix ON inventario.conteo_fisico_detalle USING btree (empresa_id);

CREATE INDEX existencia_bodega_bodega_id_ix ON inventario.existencia_bodega USING btree (bodega_id);

CREATE INDEX existencia_bodega_empresa_producto_ix ON inventario.existencia_bodega USING btree (empresa_id, producto_id);

CREATE INDEX existencia_bodega_empresa_bodega_ix ON inventario.existencia_bodega USING btree (empresa_id, bodega_id);

CREATE INDEX existencia_bodega_empresa_id_ix ON inventario.existencia_bodega USING btree (empresa_id);

CREATE INDEX existencia_producto_resumen_empresa_ix ON inventario.existencia_producto_resumen USING btree (empresa_id);

CREATE INDEX existencia_producto_resumen_empresa_producto_ix ON inventario.existencia_producto_resumen USING btree (empresa_id, producto_id);

CREATE INDEX lote_producto_bodega_id_ix ON inventario.lote_producto USING btree (bodega_id);

CREATE INDEX lote_producto_lote_trgm_ix ON inventario.lote_producto USING gin (lote gin_trgm_ops);

CREATE INDEX lote_producto_empresa_id_ix ON inventario.lote_producto USING btree (empresa_id);

CREATE INDEX lote_producto_fecha_caducidad_ix ON inventario.lote_producto USING btree (fecha_caducidad);

CREATE INDEX lote_producto_empresa_activo_fecha_ix ON inventario.lote_producto USING btree (empresa_id, activo, fecha_caducidad);

CREATE INDEX lote_producto_producto_id_ix ON inventario.lote_producto USING btree (producto_id);

CREATE INDEX movimiento_inventario_producto_id_ix ON inventario.movimiento_inventario USING btree (producto_id);

CREATE INDEX movimiento_inventario_empresa_id_ix ON inventario.movimiento_inventario USING btree (empresa_id);

CREATE INDEX movimiento_inventario_orden_compra_id_ix ON inventario.movimiento_inventario USING btree (orden_compra_id);

CREATE INDEX movimiento_inventario_empresa_fecha_id_ix ON inventario.movimiento_inventario USING btree (empresa_id, fecha DESC, id DESC);

CREATE INDEX movimiento_inventario_empresa_producto_fecha_ix ON inventario.movimiento_inventario USING btree (empresa_id, producto_id, fecha DESC);

CREATE INDEX movimiento_inventario_bodega_origen_id_ix ON inventario.movimiento_inventario USING btree (bodega_origen_id);

CREATE INDEX movimiento_inventario_bodega_destino_id_ix ON inventario.movimiento_inventario USING btree (bodega_destino_id);

CREATE INDEX movimiento_inventario_operacion_masiva_id_ix ON inventario.movimiento_inventario USING btree (operacion_masiva_id) WHERE (operacion_masiva_id IS NOT NULL);

CREATE INDEX nivel_minimo_bodega_empresa_id_ix ON inventario.nivel_minimo_bodega USING btree (empresa_id);

CREATE INDEX nivel_minimo_bodega_producto_id_ix ON inventario.nivel_minimo_bodega USING btree (producto_id);

CREATE INDEX nivel_minimo_bodega_bodega_id_ix ON inventario.nivel_minimo_bodega USING btree (bodega_id);

CREATE INDEX orden_compra_proveedor_id_ix ON inventario.orden_compra USING btree (proveedor_id);

CREATE UNIQUE INDEX orden_compra_empresa_folio_uk ON inventario.orden_compra USING btree (empresa_id, folio);

CREATE INDEX orden_compra_empresa_id_ix ON inventario.orden_compra USING btree (empresa_id);

CREATE INDEX orden_compra_empresa_folio_lower_ix ON inventario.orden_compra USING btree (empresa_id, lower(folio));

CREATE INDEX orden_compra_bodega_destino_id_ix ON inventario.orden_compra USING btree (bodega_destino_id);

CREATE INDEX orden_compra_empresa_fecha_id_ix ON inventario.orden_compra USING btree (empresa_id, fecha DESC, id DESC);

CREATE INDEX orden_compra_item_empresa_id_ix ON inventario.orden_compra_item USING btree (empresa_id);

CREATE INDEX orden_compra_item_orden_compra_id_ix ON inventario.orden_compra_item USING btree (orden_compra_id);

CREATE INDEX orden_compra_item_unidad_id_ix ON inventario.orden_compra_item USING btree (unidad_id);

CREATE INDEX orden_compra_item_producto_id_ix ON inventario.orden_compra_item USING btree (producto_id);

CREATE INDEX precio_lista_producto_id_ix ON inventario.precio_lista USING btree (producto_id);

CREATE INDEX precio_lista_empresa_id_ix ON inventario.precio_lista USING btree (empresa_id);

CREATE INDEX producto_importacion_id_ix ON inventario.producto USING btree (importacion_id) WHERE (importacion_id IS NOT NULL);

CREATE INDEX producto_proveedor_id_ix ON inventario.producto USING btree (proveedor_id);

CREATE INDEX producto_valor_stock_nombre_ix ON inventario.producto USING btree (empresa_id, activo, nombre) WHERE (existencia IS NOT NULL);

CREATE INDEX producto_categoria_producto_id_ix ON inventario.producto USING btree (categoria_producto_id);

CREATE INDEX producto_codigo_lower_ix ON inventario.producto USING btree (empresa_id, lower(codigo));

CREATE INDEX producto_empresa_activo_id_ix ON inventario.producto USING btree (empresa_id, activo, id);

CREATE INDEX producto_valor_stock_codigo_trgm_ix ON inventario.producto USING gin (codigo gin_trgm_ops) WHERE (existencia IS NOT NULL);

CREATE INDEX producto_activo_codigo_trgm_ix ON inventario.producto USING gin (codigo gin_trgm_ops) WHERE (activo = true);

CREATE UNIQUE INDEX producto_empresa_codigo_uniq ON inventario.producto USING btree (empresa_id, lower(codigo)) WHERE ((codigo IS NOT NULL) AND (codigo <> ''::text));

CREATE INDEX producto_unidad_compra_id_ix ON inventario.producto USING btree (unidad_compra_id);

CREATE INDEX producto_unidad_medida_id_ix ON inventario.producto USING btree (unidad_medida_id);

CREATE INDEX producto_valor_stock_costo_ix ON inventario.producto USING btree (empresa_id, activo, costo) WHERE (existencia IS NOT NULL);

CREATE INDEX producto_valor_stock_codigo_ix ON inventario.producto USING btree (empresa_id, activo, codigo) WHERE (existencia IS NOT NULL);

CREATE INDEX producto_valor_stock_nombre_trgm_ix ON inventario.producto USING gin (nombre gin_trgm_ops) WHERE (existencia IS NOT NULL);

CREATE INDEX producto_empresa_id_ix ON inventario.producto USING btree (empresa_id);

CREATE INDEX producto_activo_nombre_trgm_ix ON inventario.producto USING gin (nombre gin_trgm_ops) WHERE (activo = true);

CREATE INDEX producto_opcion_grupo_empresa_id_ix ON inventario.producto_opcion_grupo USING btree (empresa_id);

CREATE INDEX producto_opcion_grupo_producto_id_ix ON inventario.producto_opcion_grupo USING btree (producto_id);

CREATE INDEX producto_opcion_valor_grupo_id_ix ON inventario.producto_opcion_valor USING btree (grupo_id);

CREATE INDEX producto_opcion_valor_empresa_id_ix ON inventario.producto_opcion_valor USING btree (empresa_id);

CREATE INDEX producto_proveedor_empresa_id_ix ON inventario.producto_proveedor USING btree (empresa_id);

CREATE INDEX producto_proveedor_proveedor_id_ix ON inventario.producto_proveedor USING btree (proveedor_id);

CREATE INDEX producto_proveedor_producto_id_ix ON inventario.producto_proveedor USING btree (producto_id);

CREATE UNIQUE INDEX producto_proveedor_un_preferido_uk ON inventario.producto_proveedor USING btree (producto_id) WHERE preferido;

CREATE INDEX producto_valor_resumen_empresa_categoria_ix ON inventario.producto_valor_resumen USING btree (empresa_id, categoria_id);

CREATE INDEX proveedor_empresa_id_ix ON inventario.proveedor USING btree (empresa_id);

CREATE INDEX tipo_lista_precio_empresa_id_ix ON inventario.tipo_lista_precio USING btree (empresa_id);

CREATE UNIQUE INDEX tipo_lista_precio_empresa_clave_uk ON inventario.tipo_lista_precio USING btree (empresa_id, clave);

CREATE INDEX ultimo_movimiento_producto_empresa_fecha_ix ON inventario.ultimo_movimiento_producto USING btree (empresa_id, ultima_fecha);

CREATE INDEX ultimo_movimiento_producto_empresa_producto_ix ON inventario.ultimo_movimiento_producto USING btree (empresa_id, producto_id);

CREATE UNIQUE INDEX unidad_medida_empresa_clave_uk ON inventario.unidad_medida USING btree (empresa_id, clave);

CREATE INDEX unidad_medida_empresa_id_ix ON inventario.unidad_medida USING btree (empresa_id);

create policy compartida_todo on inventario.bodega as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on inventario.bodega as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy solo_mi_empresa on inventario.bodega as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on inventario.categoria_producto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on inventario.categoria_producto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy compartida_todo on inventario.categoria_producto as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy compartida_todo on inventario.conteo_fisico as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on inventario.conteo_fisico as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on inventario.conteo_fisico as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy compartida_todo on inventario.conteo_fisico_detalle as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on inventario.conteo_fisico_detalle as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on inventario.conteo_fisico_detalle as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy compartida_todo on inventario.existencia_bodega as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on inventario.existencia_bodega as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on inventario.existencia_bodega as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy solo_mi_empresa on inventario.existencia_producto_resumen as restrictive for ALL to public
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on inventario.existencia_producto_resumen as restrictive for ALL to public
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy compartida_todo on inventario.existencia_producto_resumen as permissive for ALL to public
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on inventario.importacion_producto as restrictive for ALL to public
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy compartida_todo on inventario.importacion_producto as permissive for ALL to public
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on inventario.importacion_producto as restrictive for ALL to public
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on inventario.lote_producto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on inventario.lote_producto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy compartida_todo on inventario.lote_producto as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on inventario.movimiento_inventario as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy solo_mi_empresa on inventario.movimiento_inventario as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on inventario.movimiento_inventario as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy compartida_todo on inventario.nivel_minimo_bodega as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on inventario.nivel_minimo_bodega as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on inventario.nivel_minimo_bodega as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy compartida_todo on inventario.orden_compra as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on inventario.orden_compra as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on inventario.orden_compra as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy compartida_todo on inventario.orden_compra_item as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on inventario.orden_compra_item as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy solo_mi_empresa on inventario.orden_compra_item as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on inventario.precio_lista as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on inventario.precio_lista as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy solo_mi_empresa on inventario.precio_lista as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on inventario.producto as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on inventario.producto as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy solo_mi_empresa on inventario.producto as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on inventario.producto_opcion_grupo as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on inventario.producto_opcion_grupo as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on inventario.producto_opcion_valor as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on inventario.producto_opcion_valor as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on inventario.producto_proveedor as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on inventario.producto_proveedor as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on inventario.producto_proveedor as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy modulo_habilitado on inventario.producto_valor_resumen as restrictive for ALL to public
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy solo_mi_empresa on inventario.producto_valor_resumen as restrictive for ALL to public
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on inventario.producto_valor_resumen as permissive for ALL to public
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on inventario.proveedor as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on inventario.proveedor as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy modulo_habilitado on inventario.proveedor as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy modulo_habilitado on inventario.tipo_lista_precio as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy compartida_todo on inventario.tipo_lista_precio as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on inventario.tipo_lista_precio as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on inventario.ultimo_movimiento_producto as restrictive for ALL to public
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on inventario.ultimo_movimiento_producto as restrictive for ALL to public
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy compartida_todo on inventario.ultimo_movimiento_producto as permissive for ALL to public
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on inventario.unidad_medida as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy modulo_habilitado on inventario.unidad_medida as restrictive for ALL to authenticated
  using (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado))
  with check (( SELECT privado.modulo_habilitado('inventario'::text) AS modulo_habilitado));

create policy compartida_todo on inventario.unidad_medida as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

CREATE OR REPLACE FUNCTION inventario.fn_actualizar_existencia_producto_resumen()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_producto_id bigint;
  v_empresa_id bigint;
  v_cantidad bigint;
  v_suma numeric;
begin
  if tg_op = 'DELETE' then
    v_producto_id := old.producto_id;
    v_empresa_id := old.empresa_id;
  else
    v_producto_id := new.producto_id;
    v_empresa_id := new.empresa_id;
  end if;

  select count(*), coalesce(sum(existencia), 0) into v_cantidad, v_suma
  from inventario.existencia_bodega
  where producto_id = v_producto_id;

  if v_cantidad = 0 then
    delete from inventario.existencia_producto_resumen where producto_id = v_producto_id;
  else
    insert into inventario.existencia_producto_resumen (producto_id, empresa_id, existencia_total)
    values (v_producto_id, v_empresa_id, v_suma)
    on conflict (producto_id) do update
      set existencia_total = excluded.existencia_total, empresa_id = excluded.empresa_id;
  end if;

  if tg_op = 'UPDATE' and old.producto_id is distinct from new.producto_id then
    select count(*), coalesce(sum(existencia), 0) into v_cantidad, v_suma
    from inventario.existencia_bodega
    where producto_id = old.producto_id;

    if v_cantidad = 0 then
      delete from inventario.existencia_producto_resumen where producto_id = old.producto_id;
    else
      insert into inventario.existencia_producto_resumen (producto_id, empresa_id, existencia_total)
      values (old.producto_id, old.empresa_id, v_suma)
      on conflict (producto_id) do update
        set existencia_total = excluded.existencia_total, empresa_id = excluded.empresa_id;
    end if;
  end if;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_actualizar_ultimo_movimiento_producto()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_producto_id bigint;
  v_empresa_id bigint;
  v_max_fecha date;
begin
  if tg_op = 'DELETE' then
    v_producto_id := old.producto_id;
    v_empresa_id := old.empresa_id;
  else
    v_producto_id := new.producto_id;
    v_empresa_id := new.empresa_id;
  end if;

  select max(fecha) into v_max_fecha
  from inventario.movimiento_inventario
  where producto_id = v_producto_id;

  if v_max_fecha is null then
    delete from inventario.ultimo_movimiento_producto where producto_id = v_producto_id;
  else
    insert into inventario.ultimo_movimiento_producto (producto_id, empresa_id, ultima_fecha)
    values (v_producto_id, v_empresa_id, v_max_fecha)
    on conflict (producto_id) do update
      set ultima_fecha = excluded.ultima_fecha, empresa_id = excluded.empresa_id;
  end if;

  if tg_op = 'UPDATE' and old.producto_id is distinct from new.producto_id then
    select max(fecha) into v_max_fecha
    from inventario.movimiento_inventario
    where producto_id = old.producto_id;

    if v_max_fecha is null then
      delete from inventario.ultimo_movimiento_producto where producto_id = old.producto_id;
    else
      insert into inventario.ultimo_movimiento_producto (producto_id, empresa_id, ultima_fecha)
      values (old.producto_id, old.empresa_id, v_max_fecha)
      on conflict (producto_id) do update
        set ultima_fecha = excluded.ultima_fecha, empresa_id = excluded.empresa_id;
    end if;
  end if;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_cobro_producto_por_codigo(p_codigo text)
 RETURNS SETOF inventario.producto
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select *
  from inventario.producto
  where lower(codigo) = lower(p_codigo)
    and activo = true
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_cobro_productos_listar(p_busqueda text DEFAULT NULL::text, p_categoria_id bigint DEFAULT NULL::bigint, p_bodega_id bigint DEFAULT NULL::bigint, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 20)
 RETURNS TABLE(id bigint, nombre text, codigo text, categoria_producto_id bigint, unidad_medida_id bigint, descripcion text, costo numeric, precio_unitario numeric, existencia numeric, nivel_minimo numeric, nivel_maximo numeric, proveedor_id bigint, unidad_compra_id bigint, factor_conversion_compra numeric, maneja_lotes boolean, foto text, destacado boolean, activo boolean, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with base as (
    select
      p.id, p.nombre, p.codigo, p.categoria_producto_id, p.unidad_medida_id, p.descripcion, p.costo, p.precio_unitario,
      p.existencia, p.nivel_minimo, p.nivel_maximo, p.proveedor_id, p.unidad_compra_id, p.factor_conversion_compra,
      p.maneja_lotes, p.foto, p.destacado, p.activo,
      case
        when p.existencia is null then null
        when p_bodega_id is null then coalesce(ea.existencia_total, p.existencia, 0)
        when ea.producto_id is not null then coalesce(eb.existencia, 0)
        else coalesce(p.existencia, 0)
      end as existencia_disponible
    from inventario.producto p
    left join inventario.existencia_producto_resumen ea
      on ea.producto_id = p.id and ea.empresa_id = privado.empresa_actual_id()
    left join inventario.existencia_bodega eb
      on eb.producto_id = p.id and eb.bodega_id = p_bodega_id and eb.empresa_id = privado.empresa_actual_id()
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and (nullif(trim(p_busqueda), '') is null or p.nombre ilike '%' || nullif(trim(p_busqueda), '') || '%' or p.codigo ilike '%' || nullif(trim(p_busqueda), '') || '%')
      and (p_categoria_id is null or p.categoria_producto_id = p_categoria_id)
  )
  select id, nombre, codigo, categoria_producto_id, unidad_medida_id, descripcion, costo, precio_unitario,
    existencia, nivel_minimo, nivel_maximo, proveedor_id, unidad_compra_id, factor_conversion_compra,
    maneja_lotes, foto, destacado, activo,
    count(*) over() as total
  from base
  where existencia_disponible is null or existencia_disponible > 0
  order by nombre asc, id asc
  limit p_cantidad offset p_desde
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_confirmar_recepcion_transito(p_movimiento_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_mov inventario.movimiento_inventario;
begin
  select * into v_mov
  from inventario.movimiento_inventario
  where id = p_movimiento_id
  for update;

  if v_mov.id is null or not v_mov.en_transito or v_mov.bodega_destino_id is null then
    return;
  end if;

  insert into inventario.existencia_bodega (producto_id, bodega_id, existencia, ubicacion)
  values (v_mov.producto_id, v_mov.bodega_destino_id, v_mov.cantidad, null)
  on conflict (producto_id, bodega_id)
  do update set existencia = inventario.existencia_bodega.existencia + excluded.existencia;

  update inventario.movimiento_inventario
  set en_transito = false, fecha_recepcion = now()
  where id = p_movimiento_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_conteo_fisico_detalle(p_conteo_fisico_id bigint)
 RETURNS TABLE(producto_id bigint, producto_codigo text, producto_nombre text, sistema numeric, contado numeric, diferencia numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select d.producto_id, p.codigo, p.nombre, d.sistema, d.contado, d.diferencia
  from inventario.conteo_fisico_detalle d
  join inventario.producto p on p.id = d.producto_id
  where d.empresa_id = privado.empresa_actual_id()
    and d.conteo_fisico_id = p_conteo_fisico_id
  order by p.nombre asc;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_conteo_fisico_historial(p_bodega_id bigint DEFAULT NULL::bigint, p_desde_fecha date DEFAULT NULL::date, p_hasta_fecha date DEFAULT NULL::date, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 20)
 RETURNS TABLE(id bigint, fecha timestamp with time zone, bodega_id bigint, bodega_nombre text, usuario_id bigint, usuario_nombre text, total_productos integer, total_diferencias integer, notas text, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    c.id,
    c.fecha,
    c.bodega_id,
    b.nombre,
    c.usuario_id,
    trim(concat_ws(' ', u.nombre, u.apellido_paterno, u.apellido_materno)),
    c.total_productos,
    c.total_diferencias,
    c.notas,
    count(*) over() as total
  from inventario.conteo_fisico c
  join inventario.bodega b on b.id = c.bodega_id
  join seguridad.usuario u on u.id = c.usuario_id
  where c.empresa_id = privado.empresa_actual_id()
    and (p_bodega_id is null or c.bodega_id = p_bodega_id)
    and (p_desde_fecha is null or c.fecha >= p_desde_fecha::timestamptz)
    and (p_hasta_fecha is null or c.fecha < (p_hasta_fecha::date + 1)::timestamptz)
  order by c.fecha desc, c.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_conteo_fisico_productos(p_bodega_id bigint, p_busqueda_nombre text DEFAULT NULL::text, p_busqueda_codigo text DEFAULT NULL::text, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 20)
 RETURNS TABLE(producto_id bigint, codigo text, nombre text, existencia numeric, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    p.id,
    p.codigo,
    p.nombre,
    e.existencia,
    count(*) over() as total
  from inventario.existencia_bodega e
  join inventario.producto p on p.id = e.producto_id
  where e.empresa_id = privado.empresa_actual_id()
    and e.bodega_id = p_bodega_id
    and p.activo = true
    and p.existencia is not null
    and (
      p_busqueda_nombre is null or p_busqueda_nombre = '' or
      p.nombre ilike '%' || p_busqueda_nombre || '%'
    )
    and (
      p_busqueda_codigo is null or p_busqueda_codigo = '' or
      p.codigo ilike '%' || p_busqueda_codigo || '%'
    )
  order by p.nombre asc, p.id asc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_enviar_en_transito(p_producto_id bigint, p_bodega_origen_id bigint, p_bodega_destino_id bigint, p_cantidad numeric, p_nota text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_bodega_origen_id is not null then
    update inventario.existencia_bodega
    set existencia = existencia - p_cantidad
    where producto_id = p_producto_id and bodega_id = p_bodega_origen_id;
  end if;

  insert into inventario.movimiento_inventario (
    producto_id, bodega_origen_id, bodega_destino_id, cantidad, nota,
    orden_compra_id, costo_unitario, en_transito, fecha_recepcion
  ) values (
    p_producto_id, p_bodega_origen_id, p_bodega_destino_id, p_cantidad, p_nota,
    null, null, true, null
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_importar_productos_masivo(p_filas jsonb, p_operacion_id uuid, p_solo_validar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_existente inventario.importacion_producto;
  v_total int;
  v_numero_regla text := '^\d+(\.\d+)?$';
  v_errores jsonb;
  v_advertencias jsonb;
  v_creados int := 0;
  v_restriccion text;
begin
  if p_operacion_id is null then
    raise exception 'Falta el identificador de operación (idempotencia).';
  end if;

  select * into v_existente from inventario.importacion_producto where id = p_operacion_id;
  if v_existente.id is not null then
    return jsonb_build_object(
      'operacionId', p_operacion_id, 'duplicada', true, 'ok', true,
      'totalFilas', v_existente.total_filas, 'productosCreados', v_existente.productos_creados,
      'errores', '[]'::jsonb, 'advertencias', '[]'::jsonb
    );
  end if;

  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El archivo no trae renglones para importar.';
  end if;

  v_total := jsonb_array_length(p_filas);
  if v_total > 5000 then
    raise exception 'El archivo trae % renglones -- el máximo por importación es 5,000. Divídelo en partes.', v_total;
  end if;

  drop table if exists pg_temp.tmp_importar_filas;
  create temp table pg_temp.tmp_importar_filas on commit drop as
  with base as (
    select
      coalesce(
        case when (f->>'numero') ~ '^\d{1,9}$' then (f->>'numero')::int else null end,
        idx::int
      ) as numero,
      trim(coalesce(f->>'nombre', '')) as nombre,
      trim(coalesce(f->>'codigo', '')) as codigo,
      lower(trim(coalesce(f->>'codigo', ''))) as codigo_lower,
      trim(coalesce(f->>'categoria', '')) as categoria_texto,
      trim(coalesce(f->>'unidad', '')) as unidad_texto,
      trim(coalesce(f->>'costo', '')) as costo_texto,
      trim(coalesce(f->>'precio', '')) as precio_texto,
      trim(coalesce(f->>'existencia', '')) as existencia_texto,
      lower(trim(coalesce(f->>'activo', ''))) as activo_texto,
      trim(coalesce(f->>'descripcion', '')) as descripcion_texto,
      trim(coalesce(f->>'nivel_minimo', '')) as nivel_minimo_texto,
      trim(coalesce(f->>'nivel_maximo', '')) as nivel_maximo_texto,
      trim(coalesce(f->>'proveedor', '')) as proveedor_texto,
      trim(coalesce(f->>'unidad_compra', '')) as unidad_compra_texto,
      trim(coalesce(f->>'factor_conversion_compra', '')) as factor_texto,
      lower(trim(coalesce(f->>'maneja_lotes', ''))) as maneja_lotes_texto,
      lower(trim(coalesce(f->>'destacado', ''))) as destacado_texto
    from jsonb_array_elements(p_filas) with ordinality as t(f, idx)
  ),
  resuelto as (
    select
      b.*,
      cat.id as categoria_id,
      uni.id as unidad_id,
      prov.id as proveedor_id,
      unic.id as unidad_compra_id,
      (b.costo_texto = '' or b.costo_texto ~ v_numero_regla) as costo_valido,
      (b.precio_texto ~ v_numero_regla) as precio_valido,
      (b.existencia_texto = '' or b.existencia_texto ~ v_numero_regla) as existencia_valido,
      (b.nivel_minimo_texto = '' or b.nivel_minimo_texto ~ v_numero_regla) as nivel_minimo_valido,
      (b.nivel_maximo_texto = '' or b.nivel_maximo_texto ~ v_numero_regla) as nivel_maximo_valido,
      (case when b.factor_texto ~ v_numero_regla then b.factor_texto::numeric > 0 else false end) as factor_valido,
      case when b.codigo_lower <> '' then count(*) over (partition by b.codigo_lower) else 1 end as veces_codigo_archivo,
      case when b.codigo_lower <> '' then min(b.numero) over (partition by b.codigo_lower) end as primer_numero_codigo
    from base b
    left join inventario.categoria_producto cat on b.categoria_texto <> '' and lower(cat.clave) = lower(b.categoria_texto)
    left join inventario.unidad_medida uni on b.unidad_texto <> '' and lower(uni.clave) = lower(b.unidad_texto)
    left join inventario.proveedor prov on b.proveedor_texto <> '' and lower(prov.nombre) = lower(b.proveedor_texto)
    left join inventario.unidad_medida unic on b.unidad_compra_texto <> '' and lower(unic.clave) = lower(b.unidad_compra_texto)
  )
  select
    r.*,
    case
      when r.nombre = '' then 'Falta el nombre.'
      when r.codigo_lower <> '' and r.veces_codigo_archivo > 1 and r.numero <> r.primer_numero_codigo
        then format('El código "%s" se repite dentro del mismo archivo (también en el renglón %s).', r.codigo, r.primer_numero_codigo)
      when r.categoria_id is null then format('La categoría "%s" no existe (revisa la Clave).', r.categoria_texto)
      when r.unidad_id is null then format('La unidad "%s" no existe (revisa la Clave).', r.unidad_texto)
      when not r.costo_valido then format('Costo inválido: "%s".', r.costo_texto)
      when r.precio_texto = '' then 'Falta el precio.'
      when not r.precio_valido then format('Precio inválido: "%s".', r.precio_texto)
      when not r.existencia_valido then format('Existencia inválida: "%s".', r.existencia_texto)
      when r.existencia_texto <> '' and r.nivel_minimo_texto <> '' and not r.nivel_minimo_valido
        then format('Nivel mínimo inválido: "%s".', r.nivel_minimo_texto)
      when r.existencia_texto <> '' and r.nivel_maximo_texto <> '' and not r.nivel_maximo_valido
        then format('Nivel máximo inválido: "%s".', r.nivel_maximo_texto)
      when r.proveedor_texto <> '' and r.proveedor_id is null
        then format('El proveedor "%s" no existe (coincide por Nombre, el proveedor no tiene Clave).', r.proveedor_texto)
      when r.unidad_compra_texto <> '' and r.unidad_compra_id is null
        then format('La unidad de compra "%s" no existe (revisa la Clave).', r.unidad_compra_texto)
      when r.unidad_compra_texto <> '' and r.factor_texto = ''
        then 'Falta "factor_conversion_compra" (a cuántas unidades base equivale la unidad de compra).'
      when r.unidad_compra_texto <> '' and not r.factor_valido
        then format('Factor de conversión inválido: "%s".', r.factor_texto)
      else null
    end as error_mensaje
  from resuelto r;

  select coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'mensaje', error_mensaje) order by numero), '[]'::jsonb)
  into v_errores
  from pg_temp.tmp_importar_filas
  where error_mensaje is not null;

  if v_errores = '[]'::jsonb then
    select coalesce(jsonb_agg(jsonb_build_object(
      'numero', f.numero,
      'mensaje', format('El código "%s" ya existe en el catálogo (producto #%s: %s).', f.codigo, p.id, p.nombre)
    ) order by f.numero), '[]'::jsonb)
    into v_errores
    from pg_temp.tmp_importar_filas f
    join inventario.producto p on lower(p.codigo) = f.codigo_lower
    where f.codigo_lower <> '';
  end if;

  if v_errores <> '[]'::jsonb then
    drop table if exists pg_temp.tmp_importar_filas;
    return jsonb_build_object(
      'operacionId', p_operacion_id, 'duplicada', false, 'ok', false,
      'totalFilas', v_total, 'productosCreados', 0, 'errores', v_errores, 'advertencias', '[]'::jsonb
    );
  end if;

  -- PENDIENTE 2 (2026-11): tercera rama de advertencia -- avisa, sin
  -- bloquear, cuando el archivo trae una existencia > 0 que YA NO se va a
  -- aplicar (ver el INSERT final, más abajo). Solo corre sobre filas sin
  -- error, así que existencia_texto aquí ya es '' o un número válido --
  -- el cast a numeric es seguro.
  select coalesce(jsonb_agg(jsonb_build_object('numero', numero, 'mensaje', m) order by numero), '[]'::jsonb)
  into v_advertencias
  from (
    select numero, 'Sin código -- no podrá buscarse por código de barras/QR en Cobro ni en Movimientos entre bodegas.' as m
    from pg_temp.tmp_importar_filas where codigo = ''
    union all
    select numero, format('El precio (%s) es menor que el costo (%s).',
      precio_texto::numeric,
      case when costo_texto = '' then 0 else costo_texto::numeric end
    ) as m
    from pg_temp.tmp_importar_filas
    where precio_texto::numeric < (case when costo_texto = '' then 0 else costo_texto::numeric end)
    union all
    select numero, format(
      'La existencia (%s) de este renglón no se aplicó -- los productos nuevos siempre inician en 0. Regístrala después desde Inventario → Movimientos entre bodegas → Movimiento masivo.',
      existencia_texto
    ) as m
    from pg_temp.tmp_importar_filas
    where existencia_texto <> '' and existencia_texto::numeric > 0
  ) a;

  if p_solo_validar then
    drop table if exists pg_temp.tmp_importar_filas;
    return jsonb_build_object(
      'operacionId', p_operacion_id, 'duplicada', false, 'ok', true,
      'totalFilas', v_total, 'productosCreados', 0, 'errores', '[]'::jsonb, 'advertencias', v_advertencias
    );
  end if;

  begin
    insert into inventario.importacion_producto (id, total_filas, productos_creados)
    values (p_operacion_id, v_total, 0);
  exception
    when unique_violation then
      get stacked diagnostics v_restriccion = constraint_name;
      if v_restriccion = 'importacion_producto_pkey' then
        drop table if exists pg_temp.tmp_importar_filas;
        select * into v_existente from inventario.importacion_producto where id = p_operacion_id;
        return jsonb_build_object(
          'operacionId', p_operacion_id, 'duplicada', true, 'ok', true,
          'totalFilas', v_existente.total_filas, 'productosCreados', v_existente.productos_creados,
          'errores', '[]'::jsonb, 'advertencias', '[]'::jsonb
        );
      end if;
      raise;
  end;

  begin
    insert into inventario.producto (
      nombre, codigo, categoria_producto_id, unidad_medida_id, descripcion, costo, precio_unitario,
      existencia, nivel_minimo, nivel_maximo, proveedor_id, unidad_compra_id, factor_conversion_compra,
      maneja_lotes, destacado, activo, importacion_id
    )
    select
      nombre,
      case when codigo = '' then null else codigo end,
      categoria_id,
      unidad_id,
      case when descripcion_texto = '' then null else descripcion_texto end,
      case when costo_texto = '' then 0 else costo_texto::numeric end,
      precio_texto::numeric,
      -- PENDIENTE 2 (2026-11): la existencia del CSV ya NUNCA se aplica --
      -- un producto físico nuevo siempre entra en 0 (igual que el alta
      -- manual en productos.component.ts → guardar()); la columna solo
      -- sigue decidiendo si el renglón es "producto" (número, aunque sea
      -- '0') o "servicio" (vacío -- null). Ver la advertencia de arriba,
      -- que avisa cuando el archivo pedía algo distinto de 0.
      case when existencia_texto = '' then null else 0 end,
      case when existencia_texto <> '' and nivel_minimo_texto <> '' then nivel_minimo_texto::numeric end,
      case when existencia_texto <> '' and nivel_maximo_texto <> '' then nivel_maximo_texto::numeric end,
      proveedor_id,
      unidad_compra_id,
      case when unidad_compra_texto <> '' then factor_texto::numeric end,
      (existencia_texto <> '') and not (maneja_lotes_texto = any (array['', 'no', 'false', '0'])),
      not (destacado_texto = any (array['', 'no', 'false', '0'])),
      not (activo_texto = any (array['no', 'false', '0'])),
      p_operacion_id
    from pg_temp.tmp_importar_filas;
  exception
    when unique_violation then
      get stacked diagnostics v_restriccion = constraint_name;
      if v_restriccion = 'producto_empresa_codigo_uniq' then
        raise exception 'Uno o más códigos de este archivo ya fueron registrados por otra importación o alta simultánea. No se creó ningún producto -- vuelve a intentar la importación.';
      end if;
      raise;
  end;

  get diagnostics v_creados = row_count;
  update inventario.importacion_producto set productos_creados = v_creados where id = p_operacion_id;

  drop table if exists pg_temp.tmp_importar_filas;

  return jsonb_build_object(
    'operacionId', p_operacion_id, 'duplicada', false, 'ok', true,
    'totalFilas', v_total, 'productosCreados', v_creados, 'errores', '[]'::jsonb, 'advertencias', v_advertencias
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_kardex_listar(p_producto_id bigint, p_bodega_id bigint DEFAULT NULL::bigint, p_tipo text DEFAULT NULL::text, p_desde_fecha date DEFAULT NULL::date, p_hasta_fecha date DEFAULT NULL::date, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 20)
 RETURNS TABLE(id bigint, fecha date, tipo text, bodega_origen_id bigint, origen_nombre text, bodega_destino_id bigint, destino_nombre text, cantidad numeric, delta numeric, saldo numeric, nota text, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with propios as (
    select
      m.id, m.fecha, m.bodega_origen_id, m.bodega_destino_id, m.cantidad, m.nota,
      case
        when m.bodega_origen_id is null then 'entrada'
        when m.bodega_destino_id is null then 'salida'
        else 'traspaso'
      end as tipo_calc,
      case
        when p_bodega_id is null then
          case when m.bodega_origen_id is null then m.cantidad
               when m.bodega_destino_id is null then -m.cantidad
               else 0 end
        else
          case when m.bodega_destino_id = p_bodega_id then m.cantidad
               when m.bodega_origen_id = p_bodega_id then -m.cantidad
               else 0 end
      end as delta_calc
    from inventario.movimiento_inventario m
    where m.producto_id = p_producto_id
      and (p_bodega_id is null or m.bodega_origen_id = p_bodega_id or m.bodega_destino_id = p_bodega_id)
  ),
  con_saldo as (
    select
      pr.*,
      sum(pr.delta_calc) over (order by pr.fecha, pr.id) as saldo_calc
    from propios pr
  )
  select
    cs.id, cs.fecha, cs.tipo_calc, cs.bodega_origen_id, bo.nombre, cs.bodega_destino_id, bd.nombre,
    cs.cantidad, cs.delta_calc, cs.saldo_calc, cs.nota,
    count(*) over()
  from con_saldo cs
  left join inventario.bodega bo on bo.id = cs.bodega_origen_id
  left join inventario.bodega bd on bd.id = cs.bodega_destino_id
  where (p_tipo is null or cs.tipo_calc = p_tipo)
    and (p_desde_fecha is null or cs.fecha >= p_desde_fecha)
    and (p_hasta_fecha is null or cs.fecha <= p_hasta_fecha)
  order by cs.fecha desc, cs.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_kardex_productos_autocomplete(p_busqueda text DEFAULT NULL::text, p_limite integer DEFAULT 15)
 RETURNS TABLE(id bigint, codigo text, nombre text, unidad_nombre text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p.id, p.codigo, p.nombre, um.nombre
  from inventario.producto p
  left join inventario.unidad_medida um on um.id = p.unidad_medida_id
  where p.activo = true
    and p.existencia is not null
    and (
      p_busqueda is null or p_busqueda = '' or
      p.nombre ilike '%' || p_busqueda || '%' or
      p.codigo ilike '%' || p_busqueda || '%'
    )
  order by p.nombre asc
  limit greatest(1, coalesce(p_limite, 15));
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_kardex_resumen(p_producto_id bigint, p_bodega_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(existencia_actual numeric, total_movimientos bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    case
      when p_bodega_id is not null then
        coalesce(
          (select eb.existencia from inventario.existencia_bodega eb
             where eb.producto_id = p_producto_id and eb.bodega_id = p_bodega_id),
          0
        )
      else
        coalesce(
          (select sum(eb.existencia) from inventario.existencia_bodega eb where eb.producto_id = p_producto_id),
          (select p.existencia from inventario.producto p where p.id = p_producto_id),
          0
        )
    end as existencia_actual,
    (
      select count(*) from inventario.movimiento_inventario m
      where m.producto_id = p_producto_id
        and (p_bodega_id is null or m.bodega_origen_id = p_bodega_id or m.bodega_destino_id = p_bodega_id)
    ) as total_movimientos;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_lotes_listar(p_producto_id bigint DEFAULT NULL::bigint, p_bodega_id bigint DEFAULT NULL::bigint, p_busqueda_lote text DEFAULT NULL::text, p_estado text DEFAULT NULL::text, p_incluir_inactivos boolean DEFAULT false, p_orden text DEFAULT 'fecha_caducidad'::text, p_direccion text DEFAULT 'asc'::text, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 50)
 RETURNS TABLE(id bigint, producto_id bigint, producto_codigo text, producto_nombre text, bodega_id bigint, bodega_nombre text, lote text, fecha_caducidad date, dias integer, cantidad numeric, notas text, activo boolean, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_orden text;
  v_direccion text;
begin
  v_orden := case p_orden
    when 'producto' then 'producto_nombre'
    when 'lote' then 'lote'
    when 'bodega' then 'bodega_nombre'
    when 'cantidad' then 'cantidad'
    when 'dias' then 'dias'
    when 'activo' then 'activo'
    else 'fecha_caducidad'
  end;
  v_direccion := case when lower(coalesce(p_direccion, 'asc')) = 'desc' then 'desc' else 'asc' end;

  return query execute format(
    $q$
    with base as (
      select
        l.id,
        l.producto_id,
        p.codigo as producto_codigo,
        p.nombre as producto_nombre,
        l.bodega_id,
        b.nombre as bodega_nombre,
        l.lote,
        l.fecha_caducidad,
        (l.fecha_caducidad - current_date) as dias,
        l.cantidad,
        l.notas,
        l.activo
      from inventario.lote_producto l
      join inventario.producto p on p.id = l.producto_id
      left join inventario.bodega b on b.id = l.bodega_id
      where ($1 or l.activo)
        and ($2 is null or l.producto_id = $2)
        and ($3 is null or l.bodega_id = $3)
        and ($4 is null or l.lote ilike '%%' || $4 || '%%')
    )
    select *, count(*) over() as total
    from base
    where
      case $5
        when 'vigente' then fecha_caducidad is not null and fecha_caducidad > current_date + 30
        when 'proximo' then fecha_caducidad is not null and fecha_caducidad >= current_date and fecha_caducidad <= current_date + 30
        when 'vencido' then fecha_caducidad is not null and fecha_caducidad < current_date
        else true
      end
    order by %I %s nulls last, id asc
    limit $6 offset $7
    $q$,
    v_orden, v_direccion
  )
  using p_incluir_inactivos, p_producto_id, p_bodega_id, nullif(trim(p_busqueda_lote), ''), nullif(p_estado, ''), p_cantidad, p_desde;
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_lotes_productos_autocomplete(p_busqueda text DEFAULT NULL::text, p_limite integer DEFAULT 15)
 RETURNS TABLE(id bigint, codigo text, nombre text, unidad_nombre text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p.id, p.codigo, p.nombre, um.nombre
  from inventario.producto p
  left join inventario.unidad_medida um on um.id = p.unidad_medida_id
  where p.activo = true
    and p.maneja_lotes = true
    and (
      p_busqueda is null or p_busqueda = '' or
      p.nombre ilike '%' || p_busqueda || '%' or
      p.codigo ilike '%' || p_busqueda || '%'
    )
  order by p.nombre asc
  limit greatest(1, coalesce(p_limite, 15));
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_lotes_resumen()
 RETURNS TABLE(total_proximos bigint, total_vencidos bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    count(*) filter (
      where activo and fecha_caducidad is not null
        and fecha_caducidad >= current_date and fecha_caducidad <= current_date + 30
    ),
    count(*) filter (
      where activo and fecha_caducidad is not null and fecha_caducidad < current_date
    )
  from inventario.lote_producto;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_movimiento_masivo_registrar(p_tipo text, p_bodega_origen_id bigint, p_bodega_destino_id bigint, p_en_transito boolean, p_nota text, p_lineas jsonb, p_operacion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_existentes int;
  v_linea jsonb;
  v_indice int := 0;
  v_producto_id bigint;
  v_cantidad numeric;
  v_producto inventario.producto;
  v_bodega inventario.bodega;
  v_count int := 0;
begin
  if p_operacion_id is null then
    raise exception 'Falta el identificador de operación (idempotencia).';
  end if;

  -- Idempotencia: si esta operación (mismo UUID) ya se registró antes --
  -- doble clic, Enter repetido, o un reintento tras una respuesta de red
  -- que no llegó a confirmarse en el navegador -- NO se vuelve a aplicar.
  -- Como todo el registro ocurre en una sola transacción, o están TODAS
  -- las filas de esa operación o no hay ninguna: nunca un estado a medias.
  select count(*) into v_existentes
  from inventario.movimiento_inventario
  where operacion_masiva_id = p_operacion_id;

  if v_existentes > 0 then
    return jsonb_build_object('operacion_id', p_operacion_id, 'duplicada', true, 'movimientos_registrados', v_existentes);
  end if;

  if p_tipo not in ('entrada', 'traspaso', 'salida') then
    raise exception 'Tipo de movimiento inválido: %.', p_tipo;
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La operación necesita al menos un producto.';
  end if;

  if jsonb_array_length(p_lineas) > 10000 then
    raise exception 'Esta operación tiene demasiados productos (máximo 10,000 por operación) -- divídela en varias.';
  end if;

  if (select count(*) from jsonb_array_elements(p_lineas)) <>
     (select count(distinct (l->>'producto_id')) from jsonb_array_elements(p_lineas) l) then
    raise exception 'La operación tiene el mismo producto repetido en más de un renglón.';
  end if;

  -- Bodegas requeridas según tipo -- misma regla que guardar() del
  -- formulario individual (movimientos-bodega.component.ts).
  if p_tipo = 'entrada' then
    if p_bodega_destino_id is null then
      raise exception 'Falta la bodega de destino.';
    end if;
  else
    if p_bodega_origen_id is null then
      raise exception 'Falta la bodega de origen.';
    end if;
    if p_tipo = 'traspaso' then
      if p_bodega_destino_id is null then
        raise exception 'Falta la bodega de destino.';
      end if;
      if p_bodega_origen_id = p_bodega_destino_id then
        raise exception 'La bodega de origen y destino no pueden ser la misma.';
      end if;
    end if;
  end if;

  -- RLS ya acota "bodega" a la empresa actual -- si no aparece, no existe o
  -- no es de esta empresa; en ambos casos es el mismo mensaje.
  if p_bodega_origen_id is not null then
    select * into v_bodega from inventario.bodega where id = p_bodega_origen_id;
    if v_bodega.id is null then
      raise exception 'Bodega de origen % no encontrada o sin permiso.', p_bodega_origen_id;
    end if;
  end if;
  if p_bodega_destino_id is not null then
    select * into v_bodega from inventario.bodega where id = p_bodega_destino_id;
    if v_bodega.id is null then
      raise exception 'Bodega de destino % no encontrada o sin permiso.', p_bodega_destino_id;
    end if;
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    v_indice := v_indice + 1;
    v_producto_id := case when v_linea->>'producto_id' is null then null else (v_linea->>'producto_id')::bigint end;
    v_cantidad := case when v_linea->>'cantidad' is null then null else (v_linea->>'cantidad')::numeric end;

    if v_producto_id is null then
      raise exception 'Renglón %: falta el producto.', v_indice;
    end if;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Renglón % (producto %): la cantidad debe ser mayor a cero.', v_indice, v_producto_id;
    end if;

    -- RLS ya acota "producto" a la empresa actual.
    select * into v_producto from inventario.producto where id = v_producto_id;
    if v_producto.id is null then
      raise exception 'Renglón %: producto % no encontrado o sin permiso.', v_indice, v_producto_id;
    end if;
    if not v_producto.activo then
      raise exception 'Renglón % (%): el producto está inactivo.', v_indice, v_producto.nombre;
    end if;
    if v_producto.existencia is null then
      raise exception 'Renglón % (%): es un servicio -- no maneja existencia por bodega.', v_indice, v_producto.nombre;
    end if;

    if p_bodega_origen_id is not null then
      -- Resta con guardia atómica de no-negativo: a diferencia de
      -- fn_registrar_movimiento_inventario/fn_enviar_en_transito (que
      -- restan sin condición -- ver auditoría), aquí la condición
      -- "existencia >= cantidad" va en el propio UPDATE, así que la
      -- comprobación y la escritura son una sola operación atómica de
      -- Postgres: con dos usuarios restando el mismo producto/bodega a la
      -- vez, sus transacciones se serializan por el lock de fila y cada
      -- una ve el saldo real que dejó la anterior, nunca un saldo
      -- "leído hace un rato" desde el navegador.
      update inventario.existencia_bodega
      set existencia = existencia - v_cantidad
      where producto_id = v_producto_id and bodega_id = p_bodega_origen_id and existencia >= v_cantidad;

      if not found then
        raise exception 'Renglón % (%): existencia insuficiente en la bodega de origen.', v_indice, v_producto.nombre;
      end if;
    end if;

    if p_tipo = 'entrada' or (p_tipo = 'traspaso' and not coalesce(p_en_transito, false)) then
      insert into inventario.existencia_bodega (producto_id, bodega_id, existencia, ubicacion)
      values (v_producto_id, p_bodega_destino_id, v_cantidad, null)
      on conflict (producto_id, bodega_id)
      do update set existencia = inventario.existencia_bodega.existencia + excluded.existencia;
    end if;

    insert into inventario.movimiento_inventario (
      producto_id, bodega_origen_id, bodega_destino_id, cantidad, nota,
      orden_compra_id, costo_unitario, en_transito, fecha_recepcion, operacion_masiva_id
    ) values (
      v_producto_id,
      case when p_tipo = 'entrada' then null else p_bodega_origen_id end,
      case when p_tipo = 'salida' then null else p_bodega_destino_id end,
      v_cantidad,
      p_nota,
      null, null,
      (p_tipo = 'traspaso' and coalesce(p_en_transito, false)),
      null,
      p_operacion_id
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('operacion_id', p_operacion_id, 'duplicada', false, 'movimientos_registrados', v_count);
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_movimientos_existencia_bodega(p_busqueda text DEFAULT NULL::text, p_bodega_id bigint DEFAULT NULL::bigint, p_solo_con_existencia boolean DEFAULT true, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 20)
 RETURNS TABLE(existencia_id bigint, producto_id bigint, producto_codigo text, producto_nombre text, bodega_id bigint, bodega_nombre text, existencia numeric, ubicacion text, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    e.id,
    e.producto_id,
    p.codigo,
    p.nombre,
    e.bodega_id,
    b.nombre,
    e.existencia,
    e.ubicacion,
    count(*) over() as total
  from inventario.existencia_bodega e
  join inventario.producto p on p.id = e.producto_id
  join inventario.bodega b on b.id = e.bodega_id
  where p.activo = true
    and p.existencia is not null
    and (p_bodega_id is null or e.bodega_id = p_bodega_id)
    and (coalesce(p_solo_con_existencia, true) = false or e.existencia > 0)
    and (
      p_busqueda is null or p_busqueda = '' or
      p.nombre ilike '%' || p_busqueda || '%' or
      p.codigo ilike '%' || p_busqueda || '%'
    )
  order by p.nombre asc, b.nombre asc, e.id asc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_movimientos_historial(p_producto_id bigint DEFAULT NULL::bigint, p_bodega_id bigint DEFAULT NULL::bigint, p_desde_fecha date DEFAULT NULL::date, p_hasta_fecha date DEFAULT NULL::date, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 20)
 RETURNS TABLE(id bigint, fecha date, producto_id bigint, producto_nombre text, producto_codigo text, bodega_origen_id bigint, origen_nombre text, bodega_destino_id bigint, destino_nombre text, tipo text, cantidad numeric, nota text, en_transito boolean, fecha_recepcion timestamp with time zone, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    m.id,
    m.fecha,
    m.producto_id,
    p.nombre,
    p.codigo,
    m.bodega_origen_id,
    bo.nombre,
    m.bodega_destino_id,
    bd.nombre,
    case
      when m.bodega_origen_id is null then 'entrada'
      when m.bodega_destino_id is null then 'salida'
      else 'traspaso'
    end,
    m.cantidad,
    m.nota,
    m.en_transito,
    m.fecha_recepcion,
    count(*) over() as total
  from inventario.movimiento_inventario m
  join inventario.producto p on p.id = m.producto_id
  left join inventario.bodega bo on bo.id = m.bodega_origen_id
  left join inventario.bodega bd on bd.id = m.bodega_destino_id
  where (p_producto_id is null or m.producto_id = p_producto_id)
    and (p_bodega_id is null or m.bodega_origen_id = p_bodega_id or m.bodega_destino_id = p_bodega_id)
    and (p_desde_fecha is null or m.fecha >= p_desde_fecha)
    and (p_hasta_fecha is null or m.fecha <= p_hasta_fecha)
  order by m.fecha desc, m.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_movimientos_productos_sin_asignar(p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 100)
 RETURNS TABLE(id bigint, codigo text, nombre text, existencia numeric, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    p.id,
    p.codigo,
    p.nombre,
    p.existencia,
    count(*) over() as total
  from inventario.producto p
  where p.activo = true
    and p.existencia is not null
    and p.existencia > 0
    and not exists (
      select 1 from inventario.existencia_bodega e where e.producto_id = p.id
    )
  order by p.nombre asc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_movimientos_transito(p_bodega_origen_id bigint DEFAULT NULL::bigint, p_bodega_destino_id bigint DEFAULT NULL::bigint, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 20)
 RETURNS TABLE(id bigint, fecha date, producto_id bigint, producto_nombre text, producto_codigo text, bodega_origen_id bigint, origen_nombre text, bodega_destino_id bigint, destino_nombre text, cantidad numeric, nota text, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    m.id,
    m.fecha,
    m.producto_id,
    p.nombre,
    p.codigo,
    m.bodega_origen_id,
    bo.nombre,
    m.bodega_destino_id,
    bd.nombre,
    m.cantidad,
    m.nota,
    count(*) over() as total
  from inventario.movimiento_inventario m
  join inventario.producto p on p.id = m.producto_id
  left join inventario.bodega bo on bo.id = m.bodega_origen_id
  left join inventario.bodega bd on bd.id = m.bodega_destino_id
  where m.en_transito = true
    and m.bodega_origen_id is not null
    and m.bodega_destino_id is not null
    and (p_bodega_origen_id is null or m.bodega_origen_id = p_bodega_origen_id)
    and (p_bodega_destino_id is null or m.bodega_destino_id = p_bodega_destino_id)
  order by m.fecha asc, m.id asc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_orden_compra_guardar(p_orden_id bigint, p_proveedor_id bigint, p_bodega_destino_id bigint, p_fecha date, p_fecha_entrega_estimada date, p_notas text, p_lineas jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_folio text;
  v_orden_id bigint;
  v_linea jsonb;
begin
  if p_orden_id is null then
    select 'OC-' || lpad((coalesce(max(nullif(regexp_replace(o.folio, '[^0-9]', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
      into v_folio
      from inventario.orden_compra o;

    insert into inventario.orden_compra
      (folio, proveedor_id, bodega_destino_id, estado, fecha, fecha_entrega_estimada, notas)
    values
      (v_folio, p_proveedor_id, p_bodega_destino_id, 'pendiente', p_fecha, p_fecha_entrega_estimada, p_notas)
    returning id into v_orden_id;
  else
    update inventario.orden_compra set
      proveedor_id = p_proveedor_id,
      bodega_destino_id = p_bodega_destino_id,
      fecha = p_fecha,
      fecha_entrega_estimada = p_fecha_entrega_estimada,
      notas = p_notas
    where id = p_orden_id
    returning id into v_orden_id;

    if v_orden_id is null then
      raise exception 'Orden de compra % no encontrada o sin permiso.', p_orden_id;
    end if;
  end if;

  if p_lineas is not null then
    delete from inventario.orden_compra_item where orden_compra_id = v_orden_id;

    for v_linea in select * from jsonb_array_elements(p_lineas)
    loop
      insert into inventario.orden_compra_item
        (orden_compra_id, producto_id, cantidad, costo_unitario, cantidad_recibida, unidad_id, factor_conversion)
      values (
        v_orden_id,
        (v_linea->>'producto_id')::bigint,
        (v_linea->>'cantidad')::numeric,
        (v_linea->>'costo_unitario')::numeric,
        0,
        case when v_linea->>'unidad_id' is null then null else (v_linea->>'unidad_id')::bigint end,
        coalesce((v_linea->>'factor_conversion')::numeric, 1)
      );
    end loop;
  end if;

  return v_orden_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_ordenes_compra_autocomplete_producto(p_busqueda text, p_limite integer DEFAULT 15)
 RETURNS TABLE(id bigint, codigo text, nombre text, costo numeric, unidad_medida_id bigint, unidad_medida_nombre text, unidad_compra_id bigint, unidad_compra_nombre text, factor_conversion_compra numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p.id, p.codigo, p.nombre, p.costo,
         p.unidad_medida_id, um.nombre,
         p.unidad_compra_id, uc.nombre, p.factor_conversion_compra
  from inventario.producto p
  left join inventario.unidad_medida um on um.id = p.unidad_medida_id
  left join inventario.unidad_medida uc on uc.id = p.unidad_compra_id
  where p.activo = true
    and (
      p_busqueda is null or p_busqueda = '' or
      p.nombre ilike '%' || p_busqueda || '%' or
      p.codigo ilike '%' || p_busqueda || '%'
    )
  order by p.nombre asc
  limit greatest(1, coalesce(p_limite, 15));
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_ordenes_compra_listar(p_busqueda text DEFAULT NULL::text, p_proveedor_id bigint DEFAULT NULL::bigint, p_bodega_id bigint DEFAULT NULL::bigint, p_estado text DEFAULT NULL::text, p_desde_fecha date DEFAULT NULL::date, p_hasta_fecha date DEFAULT NULL::date, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 20)
 RETURNS TABLE(id bigint, folio text, proveedor_id bigint, bodega_destino_id bigint, fecha date, fecha_entrega_estimada date, estado text, total numeric, total_filas bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    o.id,
    o.folio,
    o.proveedor_id,
    o.bodega_destino_id,
    o.fecha,
    o.fecha_entrega_estimada,
    o.estado,
    -- Total de la orden = suma de sus líneas (cantidad * costo_unitario) —
    -- orden_compra NO guarda un total propio (se calcula siempre a partir
    -- de orden_compra_item, igual que hacía el frontend antes de esta
    -- homologación). Subconsulta correlacionada apoyada en el índice ya
    -- existente orden_compra_item_orden_compra_id_ix.
    coalesce((
      select sum(oci.cantidad * oci.costo_unitario)
      from inventario.orden_compra_item oci
      where oci.orden_compra_id = o.id
    ), 0) as total,
    -- Total real de filas que cumplen el filtro (antes de LIMIT/OFFSET) —
    -- para "Página X de Y — N orden(es)" sin una segunda consulta de conteo.
    count(*) over() as total_filas
  from inventario.orden_compra o
  left join inventario.proveedor pr on pr.id = o.proveedor_id
  where (
      p_busqueda is null or p_busqueda = ''
      or lower(o.folio) like lower(p_busqueda) || '%'
      or pr.nombre ilike '%' || p_busqueda || '%'
    )
    and (p_proveedor_id is null or o.proveedor_id = p_proveedor_id)
    and (p_bodega_id is null or o.bodega_destino_id = p_bodega_id)
    and (p_estado is null or p_estado = '' or o.estado = p_estado)
    and (p_desde_fecha is null or o.fecha >= p_desde_fecha)
    and (p_hasta_fecha is null or o.fecha <= p_hasta_fecha)
  order by o.fecha desc, o.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_ordenes_compra_producto_por_codigo(p_codigo text)
 RETURNS TABLE(id bigint, codigo text, nombre text, costo numeric, activo boolean, unidad_medida_id bigint, unidad_medida_nombre text, unidad_compra_id bigint, unidad_compra_nombre text, factor_conversion_compra numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p.id, p.codigo, p.nombre, p.costo, p.activo,
         p.unidad_medida_id, um.nombre,
         p.unidad_compra_id, uc.nombre, p.factor_conversion_compra
  from inventario.producto p
  left join inventario.unidad_medida um on um.id = p.unidad_medida_id
  left join inventario.unidad_medida uc on uc.id = p.unidad_compra_id
  where lower(p.codigo) = lower(p_codigo)
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_ordenes_compra_productos_por_ids(p_ids bigint[])
 RETURNS TABLE(id bigint, codigo text, nombre text, costo numeric, activo boolean, unidad_medida_id bigint, unidad_medida_nombre text, unidad_compra_id bigint, unidad_compra_nombre text, factor_conversion_compra numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p.id, p.codigo, p.nombre, p.costo, p.activo,
         p.unidad_medida_id, um.nombre,
         p.unidad_compra_id, uc.nombre, p.factor_conversion_compra
  from inventario.producto p
  left join inventario.unidad_medida um on um.id = p.unidad_medida_id
  left join inventario.unidad_medida uc on uc.id = p.unidad_compra_id
  where p.id = any(p_ids);
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_ordenes_compra_resumen()
 RETURNS TABLE(total_pendientes bigint, total_vencidas bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    count(*) filter (where estado in ('pendiente', 'recibida_parcial')),
    count(*) filter (
      where estado in ('pendiente', 'recibida_parcial')
        and fecha_entrega_estimada is not null
        and fecha_entrega_estimada < current_date
    )
  from inventario.orden_compra;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_productos_autocomplete(p_busqueda text, p_limite integer DEFAULT 15)
 RETURNS TABLE(id bigint, codigo text, nombre text, foto_thumb_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p.id, p.codigo, p.nombre, p.foto_thumb_url
  from inventario.producto p
  where p.activo = true
    and p.existencia is not null
    and (
      p_busqueda is null or p_busqueda = '' or
      p.nombre ilike '%' || p_busqueda || '%' or
      p.codigo ilike '%' || p_busqueda || '%'
    )
  order by p.nombre asc
  limit greatest(1, coalesce(p_limite, 15));
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_recalcular_producto_valor_resumen(p_producto_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_empresa_id bigint;
  v_categoria_id bigint;
  v_costo numeric;
  v_precio numeric;
  v_nivel_minimo numeric;
  v_nivel_maximo numeric;
  v_activo boolean;
  v_existencia_base numeric;
  v_existencia numeric;
  v_tiene_nmb boolean;
  v_nmb_bajo boolean;
begin
  select p.empresa_id, p.categoria_producto_id, p.costo, p.precio_unitario,
         p.nivel_minimo, p.nivel_maximo, p.activo, p.existencia
    into v_empresa_id, v_categoria_id, v_costo, v_precio, v_nivel_minimo, v_nivel_maximo, v_activo, v_existencia_base
  from inventario.producto p
  where p.id = p_producto_id;

  if v_empresa_id is null or not v_activo or v_existencia_base is null then
    delete from inventario.producto_valor_resumen where producto_id = p_producto_id;
    return;
  end if;

  select coalesce(epr.existencia_total, v_existencia_base, 0)
    into v_existencia
  from inventario.existencia_producto_resumen epr
  where epr.producto_id = p_producto_id;

  if v_existencia is null then
    v_existencia := coalesce(v_existencia_base, 0);
  end if;

  select exists(select 1 from inventario.nivel_minimo_bodega n where n.producto_id = p_producto_id)
    into v_tiene_nmb;

  if v_tiene_nmb then
    select coalesce(bool_or(coalesce(e.existencia, 0) < n.nivel_minimo), false)
      into v_nmb_bajo
    from inventario.nivel_minimo_bodega n
    left join inventario.existencia_bodega e
      on e.producto_id = n.producto_id and e.bodega_id = n.bodega_id
    where n.producto_id = p_producto_id;
  else
    v_nmb_bajo := false;
  end if;

  insert into inventario.producto_valor_resumen (
    producto_id, empresa_id, categoria_id, costo, precio_unitario, existencia,
    valor_costo, valor_venta, es_sin_existencia, es_stock_bajo, es_sobre_stock
  ) values (
    p_producto_id, v_empresa_id, v_categoria_id, v_costo, v_precio, v_existencia,
    v_existencia * v_costo, v_existencia * v_precio,
    v_existencia = 0,
    case
      when v_tiene_nmb then v_nmb_bajo
      when v_nivel_minimo is not null then v_existencia < v_nivel_minimo
      else false
    end,
    (v_nivel_maximo is not null and v_existencia > v_nivel_maximo)
  )
  on conflict (producto_id) do update set
    empresa_id = excluded.empresa_id,
    categoria_id = excluded.categoria_id,
    costo = excluded.costo,
    precio_unitario = excluded.precio_unitario,
    existencia = excluded.existencia,
    valor_costo = excluded.valor_costo,
    valor_venta = excluded.valor_venta,
    es_sin_existencia = excluded.es_sin_existencia,
    es_stock_bajo = excluded.es_stock_bajo,
    es_sobre_stock = excluded.es_sobre_stock;
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_reconciliar_ordenes_vencidas()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with candidatos as (
    select oc.id as orden_id, oc.folio
    from inventario.orden_compra oc
    where oc.estado in ('pendiente', 'recibida_parcial')
      and oc.fecha_entrega_estimada is not null
      and oc.fecha_entrega_estimada < current_date
  )
  select inventario.fn_generar_aviso_orden_vencida(c.orden_id, c.folio)
  from candidatos c;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_registrar_movimiento_inventario(p_producto_id bigint, p_bodega_origen_id bigint, p_bodega_destino_id bigint, p_cantidad numeric, p_nota text, p_orden_compra_id bigint, p_costo_unitario numeric)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Origen: solo resta si YA existe una fila para ese producto+bodega --
  -- preserva exactamente el comportamiento actual (si no existe, no pasa
  -- nada; no se crea una fila con existencia negativa).
  if p_bodega_origen_id is not null then
    update inventario.existencia_bodega
    set existencia = existencia - p_cantidad
    where producto_id = p_producto_id and bodega_id = p_bodega_origen_id;
  end if;

  -- Destino: suma si existe, crea la fila si no -- atomico por el
  -- ON CONFLICT, sin necesidad de un SELECT previo.
  if p_bodega_destino_id is not null then
    insert into inventario.existencia_bodega (producto_id, bodega_id, existencia, ubicacion)
    values (p_producto_id, p_bodega_destino_id, p_cantidad, null)
    on conflict (producto_id, bodega_id)
    do update set existencia = inventario.existencia_bodega.existencia + excluded.existencia;
  end if;

  insert into inventario.movimiento_inventario (
    producto_id, bodega_origen_id, bodega_destino_id, cantidad, nota,
    orden_compra_id, costo_unitario, en_transito, fecha_recepcion
  ) values (
    p_producto_id, p_bodega_origen_id, p_bodega_destino_id, p_cantidad, p_nota,
    p_orden_compra_id, p_costo_unitario, false, null
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_sugerencia_reposicion(p_busqueda_nombre text DEFAULT NULL::text, p_busqueda_codigo text DEFAULT NULL::text, p_proveedor_id bigint DEFAULT NULL::bigint, p_bodega_id bigint DEFAULT NULL::bigint, p_orden text DEFAULT 'proveedor'::text, p_direccion text DEFAULT 'asc'::text, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 50)
 RETURNS TABLE(producto_id bigint, codigo text, nombre text, bodega_id bigint, bodega_nombre text, existencia numeric, nivel_minimo numeric, sugerida numeric, proveedor_id bigint, proveedor_nombre text, costo_unitario numeric, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with alertas as (
    select
      p.id as producto_id,
      null::bigint as bodega_id,
      coalesce(eb_sum.total_existencia, p.existencia) as existencia,
      p.nivel_minimo as nivel_minimo
    from inventario.producto p
    left join lateral (
      select sum(e.existencia) as total_existencia
      from inventario.existencia_bodega e
      where e.producto_id = p.id
    ) eb_sum on true
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo = true
      and p.existencia is not null
      and p.nivel_minimo is not null
      and not exists (
        select 1 from inventario.nivel_minimo_bodega n where n.producto_id = p.id
      )
      and coalesce(eb_sum.total_existencia, p.existencia) < p.nivel_minimo

    union all

    select
      p.id as producto_id,
      n.bodega_id,
      coalesce(e.existencia, 0) as existencia,
      n.nivel_minimo
    from inventario.producto p
    join inventario.nivel_minimo_bodega n on n.producto_id = p.id
    left join inventario.existencia_bodega e on e.producto_id = p.id and e.bodega_id = n.bodega_id
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo = true
      and p.existencia is not null
      and coalesce(e.existencia, 0) < n.nivel_minimo
  ),
  enriquecido as (
    select
      a.producto_id,
      p.codigo,
      p.nombre,
      a.bodega_id,
      coalesce(b.nombre, 'Todas (sin mínimo por bodega)') as bodega_nombre,
      a.existencia,
      a.nivel_minimo,
      greatest(a.nivel_minimo * 2 - a.existencia, 1) as sugerida,
      coalesce(pp.proveedor_id, p.proveedor_id) as proveedor_id,
      coalesce(pr.nombre, 'Sin proveedor asignado') as proveedor_nombre,
      coalesce(pp.precio_compra, p.costo) as costo_unitario
    from alertas a
    join inventario.producto p on p.id = a.producto_id
    left join inventario.bodega b on b.id = a.bodega_id
    left join inventario.producto_proveedor pp on pp.producto_id = a.producto_id and pp.preferido = true
    left join inventario.proveedor pr on pr.id = coalesce(pp.proveedor_id, p.proveedor_id)
  )
  select
    producto_id, codigo, nombre, bodega_id, bodega_nombre, existencia, nivel_minimo, sugerida,
    proveedor_id, proveedor_nombre, costo_unitario,
    count(*) over() as total
  from enriquecido
  where
    (p_busqueda_nombre is null or p_busqueda_nombre = '' or nombre ilike '%' || p_busqueda_nombre || '%')
    and (p_busqueda_codigo is null or p_busqueda_codigo = '' or codigo ilike '%' || p_busqueda_codigo || '%')
    and (
      p_proveedor_id is null
      or (p_proveedor_id = -1 and proveedor_id is null)
      or proveedor_id = p_proveedor_id
    )
    and (p_bodega_id is null or bodega_id = p_bodega_id)
  order by
    case when p_orden = 'codigo' and p_direccion = 'asc' then codigo end asc nulls last,
    case when p_orden = 'codigo' and p_direccion = 'desc' then codigo end desc nulls last,
    case when p_orden = 'nombre' and p_direccion = 'asc' then nombre end asc nulls last,
    case when p_orden = 'nombre' and p_direccion = 'desc' then nombre end desc nulls last,
    case when p_orden = 'existencia' and p_direccion = 'asc' then existencia end asc nulls last,
    case when p_orden = 'existencia' and p_direccion = 'desc' then existencia end desc nulls last,
    case when p_orden = 'minimo' and p_direccion = 'asc' then nivel_minimo end asc nulls last,
    case when p_orden = 'minimo' and p_direccion = 'desc' then nivel_minimo end desc nulls last,
    case when p_orden = 'sugerido' and p_direccion = 'asc' then sugerida end asc nulls last,
    case when p_orden = 'sugerido' and p_direccion = 'desc' then sugerida end desc nulls last,
    proveedor_nombre asc,
    nivel_minimo desc
  offset greatest(0, p_desde)
  limit least(greatest(1, p_cantidad), 10000);
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_sugerencia_reposicion_total()
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with alertas as (
    select p.id as producto_id
    from inventario.producto p
    left join lateral (
      select sum(e.existencia) as total_existencia
      from inventario.existencia_bodega e
      where e.producto_id = p.id
    ) eb_sum on true
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo = true
      and p.existencia is not null
      and p.nivel_minimo is not null
      and not exists (select 1 from inventario.nivel_minimo_bodega n where n.producto_id = p.id)
      and coalesce(eb_sum.total_existencia, p.existencia) < p.nivel_minimo

    union all

    select p.id as producto_id
    from inventario.producto p
    join inventario.nivel_minimo_bodega n on n.producto_id = p.id
    left join inventario.existencia_bodega e on e.producto_id = p.id and e.bodega_id = n.bodega_id
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo = true
      and p.existencia is not null
      and coalesce(e.existencia, 0) < n.nivel_minimo
  )
  select count(*) from alertas;
$function$
;

-- ----------------------------------------------------------------------------
-- CORRECCIÓN 1: la función inmediatamente siguiente a este comentario
-- (inventario.fn_trigger_procesar_foto_producto) ya NO tiene la URL ni la
-- clave anon hardcoded. Usa privado.fn_config_imagenes_requerida()
-- (01_privado.sql), que bloquea la llamada si falta configuración o si se
-- intenta usar los valores del proyecto de producción original.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION inventario.fn_trigger_procesar_foto_producto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_secreto text;
  v_cfg record;
begin
  if tg_op = 'UPDATE' and old.foto is not distinct from new.foto then
    return new;
  end if;

  if new.foto is null then
    update inventario.producto set foto_thumb_url = null, foto_detalle_url = null where id = new.id;
    return new;
  end if;

  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'webhook_tienda_imagenes';

  select * into v_cfg from privado.fn_config_imagenes_requerida();

  perform net.http_post(
    url := v_cfg.webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cfg.anon_key,
      'x-webhook-secret', v_secreto
    ),
    body := jsonb_build_object('accion', 'procesar_producto', 'productoId', new.id)
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_trigger_producto_valor_resumen_desde_otra_tabla()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform inventario.fn_recalcular_producto_valor_resumen(coalesce(new.producto_id, old.producto_id));
  return coalesce(new, old);
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_trigger_producto_valor_resumen_desde_producto()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform inventario.fn_recalcular_producto_valor_resumen(new.id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_valor_stock_por_bodega()
 RETURNS TABLE(bodega_id bigint, bodega_nombre text, valor numeric, pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET work_mem TO '32MB'
AS $function$
  with total as (
    select coalesce(sum(valor_costo), 0) as total
    from inventario.producto_valor_resumen
    where empresa_id = privado.empresa_actual_id()
  ),
  por_bodega as (
    select e.bodega_id, sum(e.existencia * pvr.costo) as valor
    from inventario.existencia_bodega e
    join inventario.producto_valor_resumen pvr
      on pvr.producto_id = e.producto_id
     and pvr.empresa_id = privado.empresa_actual_id()
    where e.empresa_id = privado.empresa_actual_id()
    group by e.bodega_id
  ),
  asignado as (
    select coalesce(sum(valor), 0) as valor from por_bodega
  )
  select bo.id as bodega_id, bo.nombre as bodega_nombre, pb.valor,
    case when t.total > 0 then (pb.valor / t.total) * 100 else 0 end as pct
  from por_bodega pb
  join inventario.bodega bo on bo.id = pb.bodega_id
  cross join total t
  union all
  select null::bigint, 'Sin bodega asignada', greatest(t.total - a.valor, 0),
    case when t.total > 0 then (greatest(t.total - a.valor, 0) / t.total) * 100 else 0 end
  from total t cross join asignado a
  where greatest(t.total - a.valor, 0) > 0
  order by valor desc;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_valor_stock_por_categoria()
 RETURNS TABLE(categoria_id bigint, categoria_nombre text, valor numeric, pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with por_cat as (
    select pvr.categoria_id, sum(pvr.valor_costo) as valor
    from inventario.producto_valor_resumen pvr
    where pvr.empresa_id = privado.empresa_actual_id()
    group by pvr.categoria_id
  ),
  total as (
    select coalesce(sum(valor), 0) as total from por_cat
  )
  select
    c.id as categoria_id,
    c.nombre as categoria_nombre,
    pc.valor,
    case when t.total > 0 then (pc.valor / t.total) * 100 else 0 end as pct
  from por_cat pc
  join inventario.categoria_producto c on c.id = pc.categoria_id
  cross join total t
  order by pc.valor desc;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_valor_stock_productos(p_busqueda text DEFAULT NULL::text, p_categoria_id bigint DEFAULT NULL::bigint, p_bodega_id bigint DEFAULT NULL::bigint, p_estado text DEFAULT NULL::text, p_orden text DEFAULT 'nombre'::text, p_direccion text DEFAULT 'asc'::text, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 50)
 RETURNS TABLE(producto_id bigint, codigo text, nombre text, categoria_id bigint, categoria_nombre text, existencia numeric, costo numeric, valor numeric, stock_bajo boolean, sobre_stock boolean, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_orden text;
  v_direccion text;
begin
  v_orden := case p_orden
    when 'codigo' then 'codigo'
    when 'existencia' then 'existencia'
    when 'costo' then 'costo'
    when 'valor' then 'valor'
    else 'nombre'
  end;
  v_direccion := case when lower(coalesce(p_direccion, 'asc')) = 'desc' then 'desc' else 'asc' end;

  return query execute format(
    $q$
    with nmb_bajo_agg as (
      select n.producto_id, bool_or(coalesce(e.existencia, 0) < n.nivel_minimo) as bajo
      from inventario.nivel_minimo_bodega n
      left join inventario.existencia_bodega e
        on e.producto_id = n.producto_id and e.bodega_id = n.bodega_id
      where n.empresa_id = privado.empresa_actual_id()
      group by n.producto_id
    ),
    base as (
      select
        p.id as producto_id,
        p.codigo,
        p.nombre,
        p.categoria_producto_id as categoria_id,
        c.nombre as categoria_nombre,
        coalesce(ea.existencia_total, p.existencia, 0) as existencia,
        p.costo,
        coalesce(ea.existencia_total, p.existencia, 0) * p.costo as valor,
        case
          when nb.producto_id is not null then coalesce(nb.bajo, false)
          when p.nivel_minimo is not null then coalesce(ea.existencia_total, p.existencia, 0) < p.nivel_minimo
          else false
        end as stock_bajo,
        (p.nivel_maximo is not null and coalesce(ea.existencia_total, p.existencia, 0) > p.nivel_maximo) as sobre_stock
      from inventario.producto p
      join inventario.categoria_producto c on c.id = p.categoria_producto_id
      left join inventario.existencia_producto_resumen ea
        on ea.producto_id = p.id and ea.empresa_id = privado.empresa_actual_id()
      left join nmb_bajo_agg nb on nb.producto_id = p.id
      where p.empresa_id = privado.empresa_actual_id()
        and p.activo
        and p.existencia is not null
        and ($1 is null or p.nombre ilike '%%' || $1 || '%%' or p.codigo ilike '%%' || $1 || '%%')
        and ($2 is null or p.categoria_producto_id = $2)
        and ($3 is null or exists (
          select 1 from inventario.existencia_bodega eb
          where eb.producto_id = p.id and eb.bodega_id = $3
        ))
    )
    select *, count(*) over() as total
    from base
    where
      case $4
        when 'con_existencia' then existencia > 0
        when 'sin_existencia' then existencia = 0
        when 'stock_bajo' then stock_bajo
        when 'sobre_stock' then sobre_stock
        else true
      end
    order by %I %s, producto_id asc
    limit $5 offset $6
    $q$,
    v_orden, v_direccion
  )
  using nullif(trim(p_busqueda), ''), p_categoria_id, p_bodega_id, nullif(p_estado, ''), p_cantidad, p_desde;
end;
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_valor_stock_resumen()
 RETURNS TABLE(valor_costo numeric, valor_venta numeric, margen numeric, total_productos bigint, sin_existencia bigint, stock_bajo bigint, sobre_stock bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    coalesce(sum(pvr.valor_costo), 0)::numeric as valor_costo,
    coalesce(sum(pvr.valor_venta), 0)::numeric as valor_venta,
    (coalesce(sum(pvr.valor_venta), 0) - coalesce(sum(pvr.valor_costo), 0))::numeric as margen,
    count(*) as total_productos,
    count(*) filter (where pvr.es_sin_existencia) as sin_existencia,
    count(*) filter (where pvr.es_stock_bajo) as stock_bajo,
    count(*) filter (where pvr.es_sobre_stock) as sobre_stock
  from inventario.producto_valor_resumen pvr
  where pvr.empresa_id = privado.empresa_actual_id();
$function$
;

CREATE OR REPLACE FUNCTION inventario.fn_valor_stock_rotacion(p_umbral_dias integer DEFAULT 60, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 50)
 RETURNS TABLE(producto_id bigint, codigo text, nombre text, existencia numeric, ultimo_movimiento date, dias_sin_movimiento integer, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with base as (
    select
      p.id as producto_id,
      p.codigo,
      p.nombre,
      coalesce(ea.existencia_total, p.existencia, 0) as existencia,
      u.ultima_fecha as ultimo_movimiento,
      case when u.ultima_fecha is null then null else (current_date - u.ultima_fecha) end as dias_sin_movimiento
    from inventario.producto p
    left join inventario.existencia_producto_resumen ea
      on ea.producto_id = p.id and ea.empresa_id = privado.empresa_actual_id()
    left join inventario.ultimo_movimiento_producto u
      on u.producto_id = p.id and u.empresa_id = privado.empresa_actual_id()
    where p.empresa_id = privado.empresa_actual_id()
      and p.activo
      and p.existencia is not null
  )
  select producto_id, codigo, nombre, existencia, ultimo_movimiento, dias_sin_movimiento,
    count(*) over() as total
  from base
  where ultimo_movimiento is null or dias_sin_movimiento >= p_umbral_dias
  order by ultimo_movimiento asc nulls first, producto_id asc
  limit p_cantidad offset p_desde;
$function$
;

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.bodega FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.categoria_producto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.conteo_fisico FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.conteo_fisico_detalle FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_actualizar_existencia_producto_resumen AFTER INSERT OR DELETE OR UPDATE ON inventario.existencia_bodega FOR EACH ROW EXECUTE FUNCTION inventario.fn_actualizar_existencia_producto_resumen();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.existencia_bodega FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_producto_valor_resumen_desde_existencia AFTER INSERT OR DELETE OR UPDATE ON inventario.existencia_producto_resumen FOR EACH ROW EXECUTE FUNCTION inventario.fn_trigger_producto_valor_resumen_desde_otra_tabla();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.lote_producto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_actualizar_ultimo_movimiento_producto AFTER INSERT OR DELETE OR UPDATE ON inventario.movimiento_inventario FOR EACH ROW EXECUTE FUNCTION inventario.fn_actualizar_ultimo_movimiento_producto();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.movimiento_inventario FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.nivel_minimo_bodega FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_producto_valor_resumen_desde_nivel_minimo AFTER INSERT OR DELETE OR UPDATE ON inventario.nivel_minimo_bodega FOR EACH ROW EXECUTE FUNCTION inventario.fn_trigger_producto_valor_resumen_desde_otra_tabla();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.orden_compra FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.orden_compra_item FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.precio_lista FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_procesar_foto_producto AFTER INSERT OR UPDATE OF foto ON inventario.producto FOR EACH ROW EXECUTE FUNCTION inventario.fn_trigger_procesar_foto_producto();

CREATE TRIGGER trg_producto_valor_resumen_desde_producto AFTER INSERT OR UPDATE ON inventario.producto FOR EACH ROW EXECUTE FUNCTION inventario.fn_trigger_producto_valor_resumen_desde_producto();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.producto FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.producto_opcion_grupo FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.producto_opcion_valor FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.producto_proveedor FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.proveedor FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.tipo_lista_precio FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON inventario.unidad_medida FOR EACH ROW EXECUTE FUNCTION privado.auditoria();