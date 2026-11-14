-- ============================================================================
-- SAURIX — Línea base reproducible (Etapa B5.1) — Esquema: ventas
-- Generado por introspección de pg_catalog el 2026-11-11. Ver limitaciones en
-- claude/saurix-correccion2-etapa-b5-1-linea-base-2026-11.md, Bloque A.
-- ============================================================================

create schema if not exists ventas;

create table ventas.abono_cuenta_por_cobrar (
  id bigint generated always as identity not null,
  cuenta_por_cobrar_id bigint not null,
  fecha timestamp with time zone not null default now(),
  monto numeric(14,2) not null default 0,
  metodo_pago text not null,
  turno_caja_id bigint,
  usuario_id bigint,
  notas text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.cliente (
  id bigint generated always as identity not null,
  nombre text not null,
  rfc text,
  es_extranjero boolean not null default false,
  regimen_fiscal_clave text,
  pais text,
  codigo_postal text,
  colonia text,
  calle text,
  numero_exterior text,
  numero_interior text,
  estado text,
  municipio text,
  localidad text,
  correo text,
  telefono text,
  lista_precio_predeterminada_id bigint,
  es_generico boolean not null default false,
  puntos_acumulados integer not null default 0,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.comision_vendedor (
  id bigint generated always as identity not null,
  usuario_id bigint not null,
  tipo text not null,
  valor numeric(14,2) not null default 0,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.configuracion_lealtad (
  id bigint generated always as identity not null,
  programa_activo boolean not null default false,
  pesos_por_punto numeric(10,2) not null default 0,
  pesos_descuento_por_punto numeric(10,2) not null default 0,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.configuracion_ventas (
  id bigint generated always as identity not null,
  conteo_caja_por_denominacion boolean not null default false,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id(),
  corte_caja_activo boolean not null default true,
  cierre_caja_activo boolean not null default true,
  apertura_caja_activo boolean not null default true
);

create table ventas.cotizacion (
  id bigint generated always as identity not null,
  folio text not null,
  fecha timestamp with time zone not null default now(),
  fecha_vigencia date,
  cliente_id bigint not null,
  vendedor_usuario_id bigint,
  subtotal numeric(14,2) not null default 0,
  descuento numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  estado text not null default 'Pendiente'::text,
  notas text,
  venta_convertida_id bigint,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.cotizacion_item (
  id bigint generated always as identity not null,
  cotizacion_id bigint not null,
  producto_id bigint,
  descripcion text not null,
  cantidad numeric(14,2) not null default 1,
  precio_unitario numeric(14,2) not null default 0,
  descuento_pct numeric(5,2) not null default 0,
  subtotal numeric(14,2) not null default 0,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.cuenta_por_cobrar (
  id bigint generated always as identity not null,
  venta_id bigint not null,
  cliente_id bigint not null,
  fecha timestamp with time zone not null default now(),
  monto_original numeric(14,2) not null default 0,
  saldo_pendiente numeric(14,2) not null default 0,
  estado text not null default 'Pendiente'::text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.devolucion (
  id bigint generated always as identity not null,
  folio text not null,
  venta_id bigint not null,
  fecha timestamp with time zone not null default now(),
  usuario_id bigint,
  motivo text,
  total_reembolsado numeric(14,2) not null default 0,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.devolucion_item (
  id bigint generated always as identity not null,
  devolucion_id bigint not null,
  venta_item_id bigint not null,
  producto_id bigint,
  descripcion text not null,
  cantidad numeric(14,2) not null default 1,
  precio_unitario numeric(14,2) not null default 0,
  subtotal numeric(14,2) not null default 0,
  bodega_id bigint,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.movimiento_puntos_cliente (
  id bigint generated always as identity not null,
  cliente_id bigint not null,
  fecha timestamp with time zone not null default now(),
  puntos integer not null default 0,
  tipo text not null,
  venta_id bigint,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.pedido_tienda (
  id bigint generated always as identity not null,
  empresa_id bigint not null,
  nombre_cliente text,
  telefono_cliente text,
  notas_cliente text,
  ubicacion_lat numeric,
  ubicacion_lng numeric,
  items jsonb not null,
  total numeric(14,2) not null default 0,
  estado text not null default 'Pendiente'::text,
  venta_id bigint,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  origen text not null default 'pedido_web'::text,
  folio text,
  token_publico text,
  nombre_mostrar_en text,
  reclamado_por bigint,
  reclamado_en timestamp with time zone
);

create table ventas.regimen_fiscal (
  id bigint generated always as identity not null,
  clave text not null,
  nombre text not null,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.turno_caja (
  id bigint generated always as identity not null,
  usuario_id bigint not null,
  fecha_apertura timestamp with time zone not null default now(),
  monto_apertura numeric(14,2) not null default 0,
  notas_apertura text,
  fecha_cierre timestamp with time zone,
  monto_cierre_contado numeric(14,2),
  monto_cierre_esperado numeric(14,2),
  diferencia_cierre numeric(14,2),
  notas_cierre text,
  estado text not null default 'Abierto'::text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.turno_caja_denominacion (
  id bigint generated always as identity not null,
  turno_caja_id bigint not null,
  momento text not null,
  valor numeric(10,2) not null,
  cantidad integer not null default 0,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.venta (
  id bigint generated always as identity not null,
  folio text not null,
  fecha timestamp with time zone not null default now(),
  turno_caja_id bigint not null,
  cliente_id bigint not null,
  vendedor_usuario_id bigint,
  subtotal numeric(14,2) not null default 0,
  descuento numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  estado text not null default 'Completada'::text,
  notas text,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id(),
  canal text
);

create table ventas.venta_item (
  id bigint generated always as identity not null,
  venta_id bigint not null,
  producto_id bigint,
  descripcion text not null,
  cantidad numeric(14,2) not null default 1,
  precio_unitario numeric(14,2) not null default 0,
  descuento_pct numeric(5,2) not null default 0,
  subtotal numeric(14,2) not null default 0,
  bodega_id bigint,
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

create table ventas.venta_pago (
  id bigint generated always as identity not null,
  venta_id bigint not null,
  metodo_pago text not null,
  monto numeric(14,2) not null default 0,
  monto_recibido numeric(14,2),
  cambio numeric(14,2),
  fecha_creacion timestamp with time zone not null default now(),
  fecha_modificacion timestamp with time zone,
  creado_por bigint,
  modificado_por bigint,
  activo boolean not null default true,
  empresa_id bigint not null default privado.empresa_actual_id()
);

alter table ventas.abono_cuenta_por_cobrar enable row level security;

alter table ventas.cliente enable row level security;

alter table ventas.comision_vendedor enable row level security;

alter table ventas.configuracion_lealtad enable row level security;

alter table ventas.configuracion_ventas enable row level security;

alter table ventas.cotizacion enable row level security;

alter table ventas.cotizacion_item enable row level security;

alter table ventas.cuenta_por_cobrar enable row level security;

alter table ventas.devolucion enable row level security;

alter table ventas.devolucion_item enable row level security;

alter table ventas.movimiento_puntos_cliente enable row level security;

alter table ventas.pedido_tienda enable row level security;

alter table ventas.regimen_fiscal enable row level security;

alter table ventas.turno_caja enable row level security;

alter table ventas.turno_caja_denominacion enable row level security;

alter table ventas.venta enable row level security;

alter table ventas.venta_item enable row level security;

alter table ventas.venta_pago enable row level security;

alter table ventas.abono_cuenta_por_cobrar add constraint abono_cuenta_por_cobrar_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.abono_cuenta_por_cobrar add constraint abono_cuenta_por_cobrar_cuenta_por_cobrar_id_fkey FOREIGN KEY (cuenta_por_cobrar_id) REFERENCES ventas.cuenta_por_cobrar(id) ON DELETE CASCADE;

alter table ventas.abono_cuenta_por_cobrar add constraint abono_cuenta_por_cobrar_pkey PRIMARY KEY (id);

alter table ventas.abono_cuenta_por_cobrar add constraint abono_cuenta_por_cobrar_turno_caja_id_fkey FOREIGN KEY (turno_caja_id) REFERENCES ventas.turno_caja(id);

alter table ventas.abono_cuenta_por_cobrar add constraint abono_cuenta_por_cobrar_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES seguridad.usuario(id);

alter table ventas.cliente add constraint cliente_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.cliente add constraint cliente_pkey PRIMARY KEY (id);

alter table ventas.cliente add constraint cliente_lista_precio_predeterminada_id_fkey FOREIGN KEY (lista_precio_predeterminada_id) REFERENCES inventario.tipo_lista_precio(id) ON DELETE SET NULL;

alter table ventas.comision_vendedor add constraint comision_vendedor_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.comision_vendedor add constraint comision_vendedor_tipo_check CHECK ((tipo = ANY (ARRAY['Porcentaje'::text, 'MontoFijo'::text])));

alter table ventas.comision_vendedor add constraint comision_vendedor_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES seguridad.usuario(id);

alter table ventas.comision_vendedor add constraint comision_vendedor_pkey PRIMARY KEY (id);

alter table ventas.configuracion_lealtad add constraint configuracion_lealtad_pkey PRIMARY KEY (id);

alter table ventas.configuracion_lealtad add constraint configuracion_lealtad_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.configuracion_ventas add constraint configuracion_ventas_pkey PRIMARY KEY (id);

alter table ventas.configuracion_ventas add constraint configuracion_ventas_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.cotizacion add constraint cotizacion_venta_convertida_id_fkey FOREIGN KEY (venta_convertida_id) REFERENCES ventas.venta(id) ON DELETE SET NULL;

alter table ventas.cotizacion add constraint cotizacion_vendedor_usuario_id_fkey FOREIGN KEY (vendedor_usuario_id) REFERENCES seguridad.usuario(id);

alter table ventas.cotizacion add constraint cotizacion_pkey PRIMARY KEY (id);

alter table ventas.cotizacion add constraint cotizacion_estado_check CHECK ((estado = ANY (ARRAY['Vigente'::text, 'Convertida'::text, 'Cancelada'::text])));

alter table ventas.cotizacion add constraint cotizacion_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.cotizacion add constraint cotizacion_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES ventas.cliente(id);

alter table ventas.cotizacion_item add constraint cotizacion_item_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.cotizacion_item add constraint cotizacion_item_cotizacion_id_fkey FOREIGN KEY (cotizacion_id) REFERENCES ventas.cotizacion(id) ON DELETE CASCADE;

alter table ventas.cotizacion_item add constraint cotizacion_item_pkey PRIMARY KEY (id);

alter table ventas.cotizacion_item add constraint cotizacion_item_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE SET NULL;

alter table ventas.cuenta_por_cobrar add constraint cuenta_por_cobrar_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.cuenta_por_cobrar add constraint cuenta_por_cobrar_estado_check CHECK ((estado = ANY (ARRAY['Pendiente'::text, 'Pagada'::text])));

alter table ventas.cuenta_por_cobrar add constraint cuenta_por_cobrar_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas.venta(id);

alter table ventas.cuenta_por_cobrar add constraint cuenta_por_cobrar_pkey PRIMARY KEY (id);

alter table ventas.cuenta_por_cobrar add constraint cuenta_por_cobrar_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES ventas.cliente(id);

alter table ventas.devolucion add constraint devolucion_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.devolucion add constraint devolucion_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas.venta(id);

alter table ventas.devolucion add constraint devolucion_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES seguridad.usuario(id);

alter table ventas.devolucion add constraint devolucion_pkey PRIMARY KEY (id);

alter table ventas.devolucion_item add constraint devolucion_item_devolucion_id_fkey FOREIGN KEY (devolucion_id) REFERENCES ventas.devolucion(id) ON DELETE CASCADE;

alter table ventas.devolucion_item add constraint devolucion_item_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.devolucion_item add constraint devolucion_item_venta_item_id_fkey FOREIGN KEY (venta_item_id) REFERENCES ventas.venta_item(id);

alter table ventas.devolucion_item add constraint devolucion_item_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE SET NULL;

alter table ventas.devolucion_item add constraint devolucion_item_bodega_id_fkey FOREIGN KEY (bodega_id) REFERENCES inventario.bodega(id) ON DELETE SET NULL;

alter table ventas.devolucion_item add constraint devolucion_item_pkey PRIMARY KEY (id);

alter table ventas.movimiento_puntos_cliente add constraint movimiento_puntos_cliente_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.movimiento_puntos_cliente add constraint movimiento_puntos_cliente_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES ventas.cliente(id) ON DELETE CASCADE;

alter table ventas.movimiento_puntos_cliente add constraint movimiento_puntos_cliente_pkey PRIMARY KEY (id);

alter table ventas.movimiento_puntos_cliente add constraint movimiento_puntos_cliente_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas.venta(id) ON DELETE SET NULL;

alter table ventas.movimiento_puntos_cliente add constraint movimiento_puntos_cliente_tipo_check CHECK ((tipo = ANY (ARRAY['Ganado'::text, 'Canjeado'::text, 'Reversado'::text])));

alter table ventas.pedido_tienda add constraint pedido_tienda_origen_check CHECK ((origen = ANY (ARRAY['pedido_web'::text, 'menu_qr'::text])));

alter table ventas.pedido_tienda add constraint pedido_tienda_estado_check CHECK ((estado = ANY (ARRAY['Pendiente'::text, 'Confirmado'::text, 'Descartado'::text, 'Expirado'::text])));

alter table ventas.pedido_tienda add constraint pedido_tienda_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas.venta(id) ON DELETE SET NULL;

alter table ventas.pedido_tienda add constraint pedido_tienda_token_publico_unique UNIQUE (token_publico);

alter table ventas.pedido_tienda add constraint pedido_tienda_reclamado_por_fkey FOREIGN KEY (reclamado_por) REFERENCES seguridad.usuario(id);

alter table ventas.pedido_tienda add constraint pedido_tienda_pkey PRIMARY KEY (id);

alter table ventas.pedido_tienda add constraint pedido_tienda_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.regimen_fiscal add constraint regimen_fiscal_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.regimen_fiscal add constraint regimen_fiscal_pkey PRIMARY KEY (id);

alter table ventas.turno_caja add constraint turno_caja_estado_check CHECK ((estado = ANY (ARRAY['Abierto'::text, 'Cerrado'::text])));

alter table ventas.turno_caja add constraint turno_caja_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.turno_caja add constraint turno_caja_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES seguridad.usuario(id);

alter table ventas.turno_caja add constraint turno_caja_pkey PRIMARY KEY (id);

alter table ventas.turno_caja_denominacion add constraint turno_caja_denominacion_turno_caja_id_fkey FOREIGN KEY (turno_caja_id) REFERENCES ventas.turno_caja(id) ON DELETE CASCADE;

alter table ventas.turno_caja_denominacion add constraint turno_caja_denominacion_pkey PRIMARY KEY (id);

alter table ventas.turno_caja_denominacion add constraint turno_caja_denominacion_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.turno_caja_denominacion add constraint turno_caja_denominacion_momento_check CHECK ((momento = ANY (ARRAY['Apertura'::text, 'Cierre'::text])));

alter table ventas.venta add constraint venta_estado_check CHECK ((estado = ANY (ARRAY['Completada'::text, 'Cancelada'::text])));

alter table ventas.venta add constraint venta_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES ventas.cliente(id);

alter table ventas.venta add constraint venta_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.venta add constraint venta_pkey PRIMARY KEY (id);

alter table ventas.venta add constraint venta_turno_caja_id_fkey FOREIGN KEY (turno_caja_id) REFERENCES ventas.turno_caja(id);

alter table ventas.venta add constraint venta_vendedor_usuario_id_fkey FOREIGN KEY (vendedor_usuario_id) REFERENCES seguridad.usuario(id);

alter table ventas.venta_item add constraint venta_item_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.venta_item add constraint venta_item_pkey PRIMARY KEY (id);

alter table ventas.venta_item add constraint venta_item_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES inventario.producto(id) ON DELETE SET NULL;

alter table ventas.venta_item add constraint venta_item_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas.venta(id) ON DELETE CASCADE;

alter table ventas.venta_item add constraint venta_item_bodega_id_fkey FOREIGN KEY (bodega_id) REFERENCES inventario.bodega(id) ON DELETE SET NULL;

alter table ventas.venta_pago add constraint venta_pago_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES seguridad.empresa(id);

alter table ventas.venta_pago add constraint venta_pago_pkey PRIMARY KEY (id);

alter table ventas.venta_pago add constraint venta_pago_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas.venta(id) ON DELETE CASCADE;

CREATE INDEX abono_cuenta_por_cobrar_empresa_id_ix ON ventas.abono_cuenta_por_cobrar USING btree (empresa_id);

CREATE INDEX abono_cuenta_por_cobrar_turno_caja_id_ix ON ventas.abono_cuenta_por_cobrar USING btree (turno_caja_id);

CREATE INDEX abono_cuenta_por_cobrar_usuario_id_ix ON ventas.abono_cuenta_por_cobrar USING btree (usuario_id);

CREATE INDEX abono_cuenta_por_cobrar_cuenta_por_cobrar_id_ix ON ventas.abono_cuenta_por_cobrar USING btree (cuenta_por_cobrar_id);

CREATE INDEX cliente_empresa_id_ix ON ventas.cliente USING btree (empresa_id);

CREATE INDEX cliente_lista_precio_predeterminada_id_ix ON ventas.cliente USING btree (lista_precio_predeterminada_id);

CREATE INDEX comision_vendedor_empresa_id_ix ON ventas.comision_vendedor USING btree (empresa_id);

CREATE INDEX comision_vendedor_usuario_id_ix ON ventas.comision_vendedor USING btree (usuario_id);

CREATE INDEX configuracion_lealtad_empresa_id_ix ON ventas.configuracion_lealtad USING btree (empresa_id);

CREATE UNIQUE INDEX configuracion_lealtad_empresa_uk ON ventas.configuracion_lealtad USING btree (empresa_id);

CREATE INDEX configuracion_ventas_empresa_id_ix ON ventas.configuracion_ventas USING btree (empresa_id);

CREATE UNIQUE INDEX configuracion_ventas_empresa_uk ON ventas.configuracion_ventas USING btree (empresa_id);

CREATE INDEX cotizacion_venta_convertida_id_ix ON ventas.cotizacion USING btree (venta_convertida_id);

CREATE INDEX cotizacion_empresa_id_ix ON ventas.cotizacion USING btree (empresa_id);

CREATE INDEX cotizacion_vendedor_usuario_id_ix ON ventas.cotizacion USING btree (vendedor_usuario_id);

CREATE INDEX cotizacion_cliente_id_ix ON ventas.cotizacion USING btree (cliente_id);

CREATE INDEX cotizacion_item_producto_id_ix ON ventas.cotizacion_item USING btree (producto_id);

CREATE INDEX cotizacion_item_cotizacion_id_ix ON ventas.cotizacion_item USING btree (cotizacion_id);

CREATE INDEX cotizacion_item_empresa_id_ix ON ventas.cotizacion_item USING btree (empresa_id);

CREATE INDEX cuenta_por_cobrar_empresa_id_ix ON ventas.cuenta_por_cobrar USING btree (empresa_id);

CREATE INDEX cuenta_por_cobrar_cliente_id_ix ON ventas.cuenta_por_cobrar USING btree (cliente_id);

CREATE INDEX cuenta_por_cobrar_venta_id_ix ON ventas.cuenta_por_cobrar USING btree (venta_id);

CREATE INDEX devolucion_venta_id_ix ON ventas.devolucion USING btree (venta_id);

CREATE INDEX devolucion_usuario_id_ix ON ventas.devolucion USING btree (usuario_id);

CREATE INDEX devolucion_empresa_id_ix ON ventas.devolucion USING btree (empresa_id);

CREATE INDEX devolucion_item_empresa_id_ix ON ventas.devolucion_item USING btree (empresa_id);

CREATE INDEX devolucion_item_producto_id_ix ON ventas.devolucion_item USING btree (producto_id);

CREATE INDEX devolucion_item_devolucion_id_ix ON ventas.devolucion_item USING btree (devolucion_id);

CREATE INDEX devolucion_item_venta_item_id_ix ON ventas.devolucion_item USING btree (venta_item_id);

CREATE INDEX devolucion_item_bodega_id_ix ON ventas.devolucion_item USING btree (bodega_id);

CREATE INDEX movimiento_puntos_cliente_cliente_id_ix ON ventas.movimiento_puntos_cliente USING btree (cliente_id);

CREATE INDEX movimiento_puntos_cliente_empresa_id_ix ON ventas.movimiento_puntos_cliente USING btree (empresa_id);

CREATE INDEX movimiento_puntos_cliente_venta_id_ix ON ventas.movimiento_puntos_cliente USING btree (venta_id);

CREATE INDEX pedido_tienda_venta_id_ix ON ventas.pedido_tienda USING btree (venta_id);

CREATE INDEX pedido_tienda_empresa_id_ix ON ventas.pedido_tienda USING btree (empresa_id);

CREATE UNIQUE INDEX regimen_fiscal_empresa_clave_uk ON ventas.regimen_fiscal USING btree (empresa_id, clave);

CREATE INDEX regimen_fiscal_empresa_id_ix ON ventas.regimen_fiscal USING btree (empresa_id);

CREATE INDEX turno_caja_usuario_id_ix ON ventas.turno_caja USING btree (usuario_id);

CREATE INDEX turno_caja_empresa_id_ix ON ventas.turno_caja USING btree (empresa_id);

CREATE INDEX turno_caja_denominacion_empresa_id_ix ON ventas.turno_caja_denominacion USING btree (empresa_id);

CREATE INDEX turno_caja_denominacion_turno_caja_id_ix ON ventas.turno_caja_denominacion USING btree (turno_caja_id);

CREATE INDEX venta_empresa_id_ix ON ventas.venta USING btree (empresa_id);

CREATE INDEX venta_vendedor_usuario_id_ix ON ventas.venta USING btree (vendedor_usuario_id);

CREATE INDEX venta_cliente_id_ix ON ventas.venta USING btree (cliente_id);

CREATE INDEX venta_turno_caja_id_ix ON ventas.venta USING btree (turno_caja_id);

CREATE INDEX venta_item_venta_id_ix ON ventas.venta_item USING btree (venta_id);

CREATE INDEX venta_item_empresa_id_ix ON ventas.venta_item USING btree (empresa_id);

CREATE INDEX venta_item_producto_id_ix ON ventas.venta_item USING btree (producto_id);

CREATE INDEX venta_item_bodega_id_ix ON ventas.venta_item USING btree (bodega_id);

CREATE INDEX venta_pago_empresa_id_ix ON ventas.venta_pago USING btree (empresa_id);

CREATE INDEX venta_pago_venta_id_ix ON ventas.venta_pago USING btree (venta_id);

create policy solo_mi_empresa on ventas.abono_cuenta_por_cobrar as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.abono_cuenta_por_cobrar as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy compartida_todo on ventas.cliente as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.cliente as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.comision_vendedor as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.comision_vendedor as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.configuracion_lealtad as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.configuracion_lealtad as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.configuracion_ventas as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.configuracion_ventas as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on ventas.cotizacion as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.cotizacion as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy compartida_todo on ventas.cotizacion_item as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.cotizacion_item as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.cuenta_por_cobrar as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.cuenta_por_cobrar as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.devolucion as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.devolucion as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on ventas.devolucion_item as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.devolucion_item as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy compartida_todo on ventas.movimiento_puntos_cliente as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.movimiento_puntos_cliente as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on ventas.pedido_tienda as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.pedido_tienda as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy compartida_todo on ventas.regimen_fiscal as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.regimen_fiscal as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.turno_caja as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.turno_caja as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on ventas.turno_caja_denominacion as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.turno_caja_denominacion as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy compartida_todo on ventas.venta as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.venta as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy solo_mi_empresa on ventas.venta_item as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.venta_item as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

create policy solo_mi_empresa on ventas.venta_pago as restrictive for ALL to authenticated
  using ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)))
  with check ((empresa_id = ( SELECT privado.empresa_actual_id() AS empresa_actual_id)));

create policy compartida_todo on ventas.venta_pago as permissive for ALL to authenticated
  using ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL))
  with check ((( SELECT privado.usuario_actual_id() AS usuario_actual_id) IS NOT NULL));

CREATE OR REPLACE FUNCTION ventas.fn_asignar_folio_pedido_tienda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_numero bigint;
  v_prefijo text;
begin
  if new.folio is null then
    v_prefijo := case when new.origen = 'menu_qr' then 'A-' else 'P-' end;
    update seguridad.empresa
      set siguiente_folio_tienda = siguiente_folio_tienda + 1
      where id = new.empresa_id
      returning siguiente_folio_tienda - 1 into v_numero;
    new.folio := v_prefijo || v_numero;
  end if;

  if new.token_publico is null then
    new.token_publico := encode(extensions.gen_random_bytes(16), 'hex');
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_dashboard_ventas_canales(p_desde_fecha date, p_hasta_fecha date)
 RETURNS TABLE(canal text, total numeric, cantidad bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    coalesce(nullif(trim(v.canal), ''), 'Mostrador') as canal,
    coalesce(sum(v.total), 0) as total,
    count(*) as cantidad
  from ventas.venta v
  where v.estado = 'Completada'
    and (p_desde_fecha is null or v.fecha::date >= p_desde_fecha)
    and (p_hasta_fecha is null or v.fecha::date <= p_hasta_fecha)
  group by 1
  order by total desc;
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_dashboard_ventas_metodos_pago(p_desde_fecha date, p_hasta_fecha date)
 RETURNS TABLE(metodo_pago text, total numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select vp.metodo_pago, coalesce(sum(vp.monto), 0) as total
  from ventas.venta_pago vp
  join ventas.venta v on v.id = vp.venta_id
  where v.estado = 'Completada'
    and (p_desde_fecha is null or v.fecha::date >= p_desde_fecha)
    and (p_hasta_fecha is null or v.fecha::date <= p_hasta_fecha)
  group by vp.metodo_pago
  order by total desc;
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_dashboard_ventas_resumen(p_hoy date)
 RETURNS TABLE(ventas_hoy numeric, numero_ventas_hoy bigint, ticket_promedio_hoy numeric, ventas_ayer numeric, costo_vendido_hoy numeric, margen_bruto_hoy numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with ventas_hoy_cte as (
    select v.id, v.total
    from ventas.venta v
    where v.estado = 'Completada'
      and v.fecha::date = p_hoy
  ),
  costo_hoy as (
    select coalesce(sum(vi.cantidad * coalesce(p.costo, 0)), 0) as costo
    from ventas.venta_item vi
    join ventas_hoy_cte vh on vh.id = vi.venta_id
    left join inventario.producto p on p.id = vi.producto_id
    where vi.producto_id is not null
  ),
  ventas_ayer_cte as (
    select coalesce(sum(v.total), 0) as total
    from ventas.venta v
    where v.estado = 'Completada'
      and v.fecha::date = p_hoy - 1
  )
  select
    coalesce((select sum(total) from ventas_hoy_cte), 0) as ventas_hoy,
    (select count(*) from ventas_hoy_cte) as numero_ventas_hoy,
    case when (select count(*) from ventas_hoy_cte) > 0
      then coalesce((select sum(total) from ventas_hoy_cte), 0) / (select count(*) from ventas_hoy_cte)
      else 0
    end as ticket_promedio_hoy,
    (select total from ventas_ayer_cte) as ventas_ayer,
    (select costo from costo_hoy) as costo_vendido_hoy,
    coalesce((select sum(total) from ventas_hoy_cte), 0) - (select costo from costo_hoy) as margen_bruto_hoy;
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_dashboard_ventas_top_productos(p_dias integer DEFAULT 30, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 10)
 RETURNS TABLE(posicion bigint, producto_id bigint, nombre text, codigo text, cantidad_vendida numeric, cantidad_devuelta numeric, cantidad_neta numeric, importe_neto numeric, total_filas bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with ventas_en_rango as (
    select v.id
    from ventas.venta v
    where v.estado = 'Completada'
      and v.fecha >= (now() - (greatest(1, p_dias) || ' days')::interval)
  ),
  vendido as (
    select vi.producto_id,
      sum(vi.cantidad) as cantidad_vendida,
      sum(vi.subtotal) as importe_vendido
    from ventas.venta_item vi
    join ventas_en_rango ve on ve.id = vi.venta_id
    where vi.producto_id is not null
    group by vi.producto_id
  ),
  devuelto as (
    select di.producto_id,
      sum(di.cantidad) as cantidad_devuelta,
      sum(di.subtotal) as importe_devuelto
    from ventas.devolucion_item di
    join ventas.venta_item vi on vi.id = di.venta_item_id
    join ventas_en_rango ve on ve.id = vi.venta_id
    where di.producto_id is not null
    group by di.producto_id
  ),
  neto as (
    select
      v.producto_id,
      v.cantidad_vendida,
      coalesce(d.cantidad_devuelta, 0) as cantidad_devuelta,
      v.cantidad_vendida - coalesce(d.cantidad_devuelta, 0) as cantidad_neta,
      v.importe_vendido - coalesce(d.importe_devuelto, 0) as importe_neto
    from vendido v
    left join devuelto d on d.producto_id = v.producto_id
  ),
  ranking as (
    select
      row_number() over (order by n.cantidad_neta desc, n.producto_id asc) as posicion,
      n.producto_id,
      p.nombre,
      p.codigo,
      n.cantidad_vendida,
      n.cantidad_devuelta,
      n.cantidad_neta,
      n.importe_neto
    from neto n
    join inventario.producto p on p.id = n.producto_id
    order by n.cantidad_neta desc, n.producto_id asc
    limit 50
  )
  select
    r.posicion, r.producto_id, r.nombre, r.codigo,
    r.cantidad_vendida, r.cantidad_devuelta, r.cantidad_neta, r.importe_neto,
    count(*) over() as total_filas
  from ranking r
  order by r.posicion
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_expirar_ordenes_menu_qr()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  update ventas.pedido_tienda
  set estado = 'Expirado'
  where estado = 'Pendiente'
    and origen = 'menu_qr'
    and fecha_creacion < now() - interval '2 hours'
    and (reclamado_en is null or reclamado_en < now() - interval '5 minutes');
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_historial_ventas_listar(p_busqueda text DEFAULT NULL::text, p_estado text DEFAULT NULL::text, p_desde_fecha date DEFAULT NULL::date, p_hasta_fecha date DEFAULT NULL::date, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 20)
 RETURNS TABLE(id bigint, folio text, fecha timestamp with time zone, cliente_id bigint, cliente_nombre text, vendedor_usuario_id bigint, vendedor_nombre text, total numeric, estado text, canal text, total_filas bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    v.id,
    v.folio,
    v.fecha,
    v.cliente_id,
    c.nombre as cliente_nombre,
    v.vendedor_usuario_id,
    trim(concat_ws(' ', u.nombre, u.apellido_paterno, u.apellido_materno)) as vendedor_nombre,
    v.total,
    v.estado,
    v.canal,
    count(*) over() as total_filas
  from ventas.venta v
  left join ventas.cliente c on c.id = v.cliente_id
  left join seguridad.usuario u on u.id = v.vendedor_usuario_id
  where (
      p_busqueda is null or p_busqueda = ''
      or lower(v.folio) like lower(p_busqueda) || '%'
      or c.nombre ilike '%' || p_busqueda || '%'
    )
    and (p_estado is null or p_estado = '' or v.estado = p_estado)
    and (p_desde_fecha is null or v.fecha::date >= p_desde_fecha)
    and (p_hasta_fecha is null or v.fecha::date <= p_hasta_fecha)
  order by v.fecha desc, v.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_liberar_pedido_tienda(p_pedido_id bigint)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  update ventas.pedido_tienda
  set reclamado_por = null, reclamado_en = null
  where id = p_pedido_id and reclamado_por = privado.usuario_actual_id();
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_pedido_tienda_cargar_a_venta(p_pedido_id bigint, p_turno_caja_id bigint, p_cliente_id bigint, p_vendedor_usuario_id bigint, p_notas text, p_canal text, p_lineas jsonb, p_pagos jsonb, p_puntos_a_canjear integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_usuario_id bigint := privado.usuario_actual_id();
  v_pedido ventas.pedido_tienda;
  v_venta_id bigint;
begin
  set local lock_timeout = '5s';

  select * into v_pedido
  from ventas.pedido_tienda
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'Pedido % no encontrado o no pertenece a esta empresa.', p_pedido_id;
  end if;

  if v_pedido.estado = 'Confirmado' then
    if v_pedido.venta_id is null then
      raise exception 'El pedido % quedó Confirmado sin venta asociada — estado inconsistente, revisar a mano.', p_pedido_id;
    end if;
    return jsonb_build_object('ventaId', v_pedido.venta_id, 'creadaEnEstaSolicitud', false);
  end if;

  if v_pedido.estado <> 'Pendiente' then
    raise exception 'El pedido % no está Pendiente (estado actual: %) — no se puede confirmar.', p_pedido_id, v_pedido.estado;
  end if;

  if v_pedido.reclamado_por is not null
     and v_pedido.reclamado_por <> v_usuario_id
     and v_pedido.reclamado_en > now() - interval '5 minutes' then
    raise exception 'El pedido % está reclamado por otro cajero.', p_pedido_id;
  end if;

  v_venta_id := ventas.fn_venta_registrar(
    p_turno_caja_id, p_cliente_id, p_vendedor_usuario_id, p_notas, p_canal,
    p_lineas, p_pagos, p_puntos_a_canjear
  );

  update ventas.pedido_tienda
  set estado = 'Confirmado', venta_id = v_venta_id, reclamado_por = null, reclamado_en = null
  where id = p_pedido_id;

  return jsonb_build_object('ventaId', v_venta_id, 'creadaEnEstaSolicitud', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_pedidos_tienda_listar(p_desde_fecha date DEFAULT NULL::date, p_hasta_fecha date DEFAULT NULL::date, p_estado text DEFAULT NULL::text, p_origen text DEFAULT NULL::text, p_busqueda text DEFAULT NULL::text, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 20)
 RETURNS TABLE(id bigint, fecha_creacion timestamp with time zone, folio text, origen text, cliente text, telefono_cliente text, total numeric, estado text, venta_id bigint, total_filas bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    p.id,
    p.fecha_creacion,
    p.folio,
    p.origen,
    coalesce(p.nombre_cliente, p.nombre_mostrar_en, '') as cliente,
    p.telefono_cliente,
    p.total,
    p.estado,
    p.venta_id,
    count(*) over() as total_filas
  from ventas.pedido_tienda p
  where p.activo
    and (p_desde_fecha is null or p.fecha_creacion >= p_desde_fecha)
    and (p_hasta_fecha is null or p.fecha_creacion < (p_hasta_fecha + 1))
    and (p_estado is null or p.estado = p_estado)
    and (p_origen is null or p.origen = p_origen)
    and (
      p_busqueda is null or p_busqueda = '' or
      p.folio ilike '%' || p_busqueda || '%' or
      p.nombre_cliente ilike '%' || p_busqueda || '%' or
      p.nombre_mostrar_en ilike '%' || p_busqueda || '%' or
      p.telefono_cliente ilike '%' || p_busqueda || '%'
    )
  order by p.fecha_creacion desc, p.id desc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_reclamar_pedido_tienda(p_pedido_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_id bigint;
begin
  update ventas.pedido_tienda
  set reclamado_por = privado.usuario_actual_id(), reclamado_en = now()
  where id = p_pedido_id
    and estado = 'Pendiente'
    and (
      reclamado_en is null
      or reclamado_en < now() - interval '5 minutes'
      or reclamado_por = privado.usuario_actual_id()
    )
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_reporte_comisiones_listar(p_desde_fecha date DEFAULT NULL::date, p_hasta_fecha date DEFAULT NULL::date, p_vendedor_id bigint DEFAULT NULL::bigint, p_desde integer DEFAULT 0, p_cantidad integer DEFAULT 20)
 RETURNS TABLE(usuario_id bigint, vendedor_nombre text, numero_ventas bigint, total_ventas numeric, total_devuelto numeric, ventas_netas numeric, comision_tipo text, comision_valor numeric, monto_comision numeric, total_filas bigint, suma_comision_total numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with ventas_periodo as (
    select
      v.id,
      v.vendedor_usuario_id,
      v.total,
      coalesce((
        select sum(di.subtotal)
        from ventas.devolucion d
        join ventas.devolucion_item di on di.devolucion_id = d.id
        where d.venta_id = v.id
      ), 0) as devuelto
    from ventas.venta v
    where v.estado = 'Completada'
      and (p_desde_fecha is null or v.fecha::date >= p_desde_fecha)
      and (p_hasta_fecha is null or v.fecha::date <= p_hasta_fecha)
  ),
  por_vendedor as (
    select
      vp.vendedor_usuario_id as usuario_id,
      count(*) as numero_ventas,
      sum(vp.total) as total_ventas,
      sum(vp.devuelto) as total_devuelto,
      sum(vp.total) - sum(vp.devuelto) as ventas_netas
    from ventas_periodo vp
    group by vp.vendedor_usuario_id
  ),
  con_comision as (
    select
      u.id as usuario_id,
      u.nombre as vendedor_nombre,
      pv.numero_ventas,
      round(pv.total_ventas, 2) as total_ventas,
      round(pv.total_devuelto, 2) as total_devuelto,
      round(pv.ventas_netas, 2) as ventas_netas,
      cv.tipo as comision_tipo,
      cv.valor as comision_valor,
      round(
        case
          when cv.tipo = 'Porcentaje' then pv.ventas_netas * (cv.valor / 100)
          when cv.tipo = 'MontoFijo' then pv.numero_ventas * cv.valor
          else 0
        end,
        2
      ) as monto_comision
    from por_vendedor pv
    join seguridad.usuario u on u.id = pv.usuario_id
    left join lateral (
      select c.tipo, c.valor from ventas.comision_vendedor c where c.usuario_id = u.id order by c.id limit 1
    ) cv on true
    where u.activo is not false
      and (p_vendedor_id is null or u.id = p_vendedor_id)
  )
  select
    usuario_id,
    vendedor_nombre,
    numero_ventas,
    total_ventas,
    total_devuelto,
    ventas_netas,
    comision_tipo,
    comision_valor,
    monto_comision,
    count(*) over() as total_filas,
    coalesce(sum(monto_comision) over(), 0) as suma_comision_total
  from con_comision
  order by monto_comision desc, vendedor_nombre asc
  offset greatest(0, p_desde)
  limit greatest(1, p_cantidad);
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_revalidar_items_pedido_tienda(p_pedido_id bigint)
 RETURNS TABLE(producto_id bigint, descripcion text, cantidad integer, precio_unitario numeric, disponible boolean, motivo text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_items jsonb;
  v_item jsonb;
  v_producto_id bigint;
  v_cantidad int;
  v_nombre_guardado text;
  v_opciones jsonb;
  v_opcion jsonb;
  v_desc text;
  v_precio_base numeric;
  v_activo boolean;
  v_extra numeric;
  v_valor_actual numeric;
  v_grupo_nombre text;
  v_valor_nombre text;
begin
  select items into v_items from ventas.pedido_tienda where id = p_pedido_id;
  if v_items is null then
    return;
  end if;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    v_producto_id := nullif(v_item->>'productoId', '')::bigint;
    v_cantidad := coalesce((v_item->>'cantidad')::int, 0);
    v_nombre_guardado := coalesce(v_item->>'nombreProducto', '(producto)');
    v_opciones := coalesce(v_item->'opcionesElegidas', '[]'::jsonb);
    v_desc := v_nombre_guardado;

    select pr.precio_unitario, pr.activo into v_precio_base, v_activo
      from inventario.producto pr
      where pr.id = v_producto_id;

    if v_precio_base is null then
      producto_id := v_producto_id;
      descripcion := v_desc;
      cantidad := v_cantidad;
      precio_unitario := 0;
      disponible := false;
      motivo := 'Este producto ya no existe en el catálogo.';
      return next;
      continue;
    end if;

    v_extra := 0;
    for v_opcion in select * from jsonb_array_elements(v_opciones)
    loop
      v_grupo_nombre := v_opcion->>'grupoNombre';
      v_valor_nombre := v_opcion->>'valorNombre';
      select pov.precio_adicional into v_valor_actual
        from inventario.producto_opcion_valor pov
        join inventario.producto_opcion_grupo pog on pog.id = pov.grupo_id
        where pog.producto_id = v_producto_id
          and pog.nombre = v_grupo_nombre
          and pov.nombre = v_valor_nombre
        limit 1;

      if v_valor_actual is null then
        producto_id := v_producto_id;
        descripcion := v_desc || ' (' || v_grupo_nombre || ': ' || v_valor_nombre || ')';
        cantidad := v_cantidad;
        precio_unitario := v_precio_base + coalesce((v_opcion->>'precioAdicional')::numeric, 0);
        disponible := false;
        motivo := 'Una de las opciones elegidas ya no existe — revisa el precio.';
        return next;
        continue;
      end if;

      v_extra := v_extra + v_valor_actual;
      v_desc := v_desc || ' (' || v_grupo_nombre || ': ' || v_valor_nombre || ')';
    end loop;

    producto_id := v_producto_id;
    descripcion := v_desc;
    cantidad := v_cantidad;
    precio_unitario := v_precio_base + v_extra;
    disponible := v_activo is true;
    motivo := case when v_activo is not true then 'Este producto está desactivado.' else null end;
    return next;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_venta_cancelar(p_venta_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_empresa_id bigint := privado.empresa_actual_id();
  v_venta ventas.venta;
  v_item ventas.venta_item;
  v_mov ventas.movimiento_puntos_cliente;
  v_con_abono boolean;
begin
  select * into v_venta from ventas.venta where id = p_venta_id and empresa_id = v_empresa_id;
  if v_venta.id is null then
    raise exception 'Venta % no encontrada o no pertenece a esta empresa.', p_venta_id;
  end if;
  if v_venta.estado = 'Cancelada' then
    return v_venta.id;
  end if;

  select exists (
    select 1 from ventas.cuenta_por_cobrar
    where venta_id = p_venta_id
      and (estado <> 'Pendiente' or saldo_pendiente < monto_original - 0.01)
  ) into v_con_abono;
  if v_con_abono then
    raise exception 'Esta venta ya tiene abonos registrados a su cuenta por cobrar — no se puede cancelar.';
  end if;

  for v_item in select * from ventas.venta_item where venta_id = p_venta_id
  loop
    if v_item.producto_id is not null and v_item.bodega_id is not null then
      perform inventario.fn_registrar_movimiento_inventario(
        v_item.producto_id, null, v_item.bodega_id, v_item.cantidad, 'Cancelación de venta ' || v_venta.folio, null, null
      );
    end if;
  end loop;

  update ventas.cuenta_por_cobrar set saldo_pendiente = 0, estado = 'Cancelada'
    where venta_id = p_venta_id and estado = 'Pendiente';

  for v_mov in select * from ventas.movimiento_puntos_cliente where venta_id = p_venta_id and activo
  loop
    insert into ventas.movimiento_puntos_cliente (cliente_id, fecha, puntos, tipo, venta_id, activo)
    values (v_mov.cliente_id, now(), -v_mov.puntos, 'Reversado', p_venta_id, true);

    update ventas.cliente set puntos_acumulados = greatest(0, puntos_acumulados - v_mov.puntos)
      where id = v_mov.cliente_id;
  end loop;

  update ventas.venta set estado = 'Cancelada' where id = p_venta_id;

  return v_venta.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION ventas.fn_venta_registrar(p_turno_caja_id bigint, p_cliente_id bigint, p_vendedor_usuario_id bigint, p_notas text, p_canal text, p_lineas jsonb, p_pagos jsonb, p_puntos_a_canjear integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_empresa_id bigint := privado.empresa_actual_id();
  v_turno ventas.turno_caja;
  v_cliente ventas.cliente;
  v_config ventas.configuracion_lealtad;
  v_linea jsonb;
  v_pago jsonb;
  v_folio text;
  v_venta_id bigint;
  v_fecha timestamptz := now();
  v_subtotal numeric := 0;
  v_descuento_lineas numeric := 0;
  v_puntos_a_canjear integer := greatest(0, coalesce(p_puntos_a_canjear, 0));
  v_descuento_puntos numeric := 0;
  v_descuento numeric;
  v_total numeric;
  v_programa_activo boolean := false;
  v_pesos_por_punto numeric := 0;
  v_pesos_descuento_por_punto numeric := 0;
  v_puntos_ganados integer;
  v_cantidad numeric;
  v_producto_id bigint;
  v_bodega_id bigint;
  v_monto numeric;
  v_metodo_pago text;
begin
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La venta necesita al menos un renglón.';
  end if;
  if p_pagos is null or jsonb_array_length(p_pagos) = 0 then
    raise exception 'La venta necesita al menos un pago.';
  end if;

  select * into v_turno from ventas.turno_caja where id = p_turno_caja_id and empresa_id = v_empresa_id;
  if v_turno.id is null then
    raise exception 'Turno de caja % no encontrado o no pertenece a esta empresa.', p_turno_caja_id;
  end if;
  if v_turno.estado <> 'Abierto' then
    raise exception 'El turno de caja % ya está cerrado.', p_turno_caja_id;
  end if;

  select * into v_cliente from ventas.cliente where id = p_cliente_id and empresa_id = v_empresa_id;
  if v_cliente.id is null then
    raise exception 'Cliente % no encontrado o no pertenece a esta empresa.', p_cliente_id;
  end if;

  select
    coalesce(sum((l->>'cantidad')::numeric * (l->>'precio_unitario')::numeric), 0),
    coalesce(sum((l->>'cantidad')::numeric * (l->>'precio_unitario')::numeric * (l->>'descuento_pct')::numeric / 100), 0)
  into v_subtotal, v_descuento_lineas
  from jsonb_array_elements(p_lineas) l;

  select * into v_config from ventas.configuracion_lealtad where empresa_id = v_empresa_id limit 1;
  if v_config.id is not null then
    v_programa_activo := v_config.programa_activo;
    v_pesos_por_punto := v_config.pesos_por_punto;
    v_pesos_descuento_por_punto := v_config.pesos_descuento_por_punto;
  end if;

  if not v_programa_activo or v_cliente.es_generico then
    v_puntos_a_canjear := 0;
  end if;
  if v_puntos_a_canjear > 0 then
    v_descuento_puntos := least(round(v_puntos_a_canjear * v_pesos_descuento_por_punto, 2), v_subtotal - v_descuento_lineas);
  end if;

  v_descuento := v_descuento_lineas + v_descuento_puntos;
  v_total := v_subtotal - v_descuento;

  perform pg_advisory_xact_lock(hashtext('ventas.venta.folio:' || v_empresa_id::text));
  select 'VTA-' || lpad((coalesce(max(nullif(regexp_replace(folio, '[^0-9]', '', 'g'), ''))::int, 0) + 1)::text, 4, '0')
    into v_folio
    from ventas.venta
    where empresa_id = v_empresa_id;

  insert into ventas.venta
    (folio, fecha, turno_caja_id, cliente_id, vendedor_usuario_id, subtotal, descuento, total, estado, notas, canal, activo)
  values
    (v_folio, v_fecha, p_turno_caja_id, p_cliente_id, p_vendedor_usuario_id, v_subtotal, v_descuento, v_total, 'Completada', p_notas, nullif(trim(p_canal), ''), true)
  returning id into v_venta_id;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    v_producto_id := case when v_linea->>'producto_id' is null then null else (v_linea->>'producto_id')::bigint end;
    v_bodega_id := case when v_linea->>'bodega_id' is null then null else (v_linea->>'bodega_id')::bigint end;
    v_cantidad := (v_linea->>'cantidad')::numeric;

    insert into ventas.venta_item
      (venta_id, producto_id, descripcion, cantidad, precio_unitario, descuento_pct, subtotal, bodega_id, activo)
    values (
      v_venta_id,
      v_producto_id,
      v_linea->>'descripcion',
      v_cantidad,
      (v_linea->>'precio_unitario')::numeric,
      (v_linea->>'descuento_pct')::numeric,
      v_cantidad * (v_linea->>'precio_unitario')::numeric * (1 - (v_linea->>'descuento_pct')::numeric / 100),
      v_bodega_id,
      true
    );

    if v_producto_id is not null and v_bodega_id is not null then
      perform inventario.fn_registrar_movimiento_inventario(
        v_producto_id, v_bodega_id, null, v_cantidad, 'Venta ' || v_folio, null, null
      );
    end if;
  end loop;

  for v_pago in select * from jsonb_array_elements(p_pagos)
  loop
    v_metodo_pago := v_pago->>'metodo_pago';
    v_monto := (v_pago->>'monto')::numeric;

    insert into ventas.venta_pago
      (venta_id, metodo_pago, monto, monto_recibido, cambio, activo)
    values (
      v_venta_id,
      v_metodo_pago,
      v_monto,
      case when v_pago->>'monto_recibido' is null then null else (v_pago->>'monto_recibido')::numeric end,
      case when v_pago->>'cambio' is null then null else (v_pago->>'cambio')::numeric end,
      true
    );

    if v_metodo_pago = 'Crédito' then
      insert into ventas.cuenta_por_cobrar
        (venta_id, cliente_id, fecha, monto_original, saldo_pendiente, estado, activo)
      values (v_venta_id, p_cliente_id, v_fecha, v_monto, v_monto, 'Pendiente', true);
    end if;
  end loop;

  if v_puntos_a_canjear > 0 then
    insert into ventas.movimiento_puntos_cliente (cliente_id, fecha, puntos, tipo, venta_id, activo)
    values (p_cliente_id, v_fecha, -v_puntos_a_canjear, 'Canjeado', v_venta_id, true);

    update ventas.cliente set puntos_acumulados = greatest(0, puntos_acumulados - v_puntos_a_canjear)
      where id = p_cliente_id;
  end if;

  if not v_cliente.es_generico then
    v_puntos_ganados := case when v_programa_activo and v_pesos_por_punto > 0 then floor(v_total / v_pesos_por_punto)::int else 0 end;
    if v_puntos_ganados > 0 then
      insert into ventas.movimiento_puntos_cliente (cliente_id, fecha, puntos, tipo, venta_id, activo)
      values (p_cliente_id, v_fecha, v_puntos_ganados, 'Ganado', v_venta_id, true);

      update ventas.cliente set puntos_acumulados = puntos_acumulados + v_puntos_ganados
        where id = p_cliente_id;
    end if;
  end if;

  return v_venta_id;
end;
$function$
;

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.abono_cuenta_por_cobrar FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.cliente FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.comision_vendedor FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.configuracion_lealtad FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.configuracion_ventas FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.cotizacion FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.cotizacion_item FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.cuenta_por_cobrar FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.devolucion FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.devolucion_item FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.movimiento_puntos_cliente FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_asignar_folio_pedido_tienda BEFORE INSERT ON ventas.pedido_tienda FOR EACH ROW EXECUTE FUNCTION ventas.fn_asignar_folio_pedido_tienda();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.pedido_tienda FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.regimen_fiscal FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.turno_caja FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.turno_caja_denominacion FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.venta FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.venta_item FOR EACH ROW EXECUTE FUNCTION privado.auditoria();

CREATE TRIGGER trg_auditoria BEFORE INSERT OR UPDATE ON ventas.venta_pago FOR EACH ROW EXECUTE FUNCTION privado.auditoria();
