-- =====================================================================
-- Saurix · Supabase · 20 Conversión de unidades
--  - inventario.producto gana unidad_compra_id/factor_conversion_compra:
--    unidad de compra ALTERNA, distinta de unidad_medida_id (la que de
--    verdad lleva la existencia) — p. ej. existencia en Pieza pero se
--    compra en Caja. unidad_compra_id null = sin unidad alterna (se sigue
--    comprando en la unidad base, como hasta ahora). factor_conversion_compra
--    = cuántas unidad_medida_id trae cada unidad_compra_id.
--  - inventario.orden_compra_item gana unidad_id/factor_conversion: snapshot
--    POR LÍNEA de en qué unidad se capturó (congelado al crear la línea, no
--    se recalcula si el producto cambia después) — unidad_id null = unidad
--    base (factor 1), que es el valor para toda línea existente antes de
--    esta característica (no requiere backfill). factor_conversion no
--    acepta null (default 1) para no tener que revisar null en cada lectura
--    en orden-compra.service.ts → recibir(), que es quien de verdad aplica
--    la conversión a unidad base al momento de recibir mercancía.
--  - Mismo criterio que 18/19: solo ALTER TABLE a dos tablas que YA existen
--    y ya tienen auditoría/RLS/empresa_id/modulo_habilitado desde
--    14_inventario.sql / 17_compras.sql — no hace falta repetir nada de eso
--    aquí, a diferencia de cuando se crea una tabla nueva.
-- =====================================================================
set check_function_bodies = off;

alter table inventario.producto
  add column unidad_compra_id         bigint references inventario.unidad_medida(id),
  add column factor_conversion_compra numeric(14,4);

alter table inventario.orden_compra_item
  add column unidad_id         bigint references inventario.unidad_medida(id),
  add column factor_conversion numeric(14,4) not null default 1;

create index producto_unidad_compra_id_ix  on inventario.producto (unidad_compra_id);
create index orden_compra_item_unidad_id_ix on inventario.orden_compra_item (unidad_id);
