
-- Backfill de folio/token para los pedido_tienda históricos (antes del
-- trigger de la migración anterior). Folio numerado de forma estable por
-- empresa (orden por id) y luego se deja el contador de cada empresa listo
-- para continuar justo después del último folio asignado aquí.
with numerados as (
  select
    id,
    empresa_id,
    row_number() over (partition by empresa_id order by id) as pos,
    case when origen = 'menu_qr' then 'A-' else 'P-' end as prefijo
  from ventas.pedido_tienda
  where folio is null
),
con_base as (
  select n.id, n.empresa_id, n.prefijo, n.pos,
         coalesce(e.siguiente_folio_tienda, 1) as base
  from numerados n
  join seguridad.empresa e on e.id = n.empresa_id
)
update ventas.pedido_tienda pt
set folio = cb.prefijo || (cb.base + cb.pos - 1)
from con_base cb
where pt.id = cb.id;

update seguridad.empresa e
set siguiente_folio_tienda = siguiente_folio_tienda + sub.cantidad
from (
  select empresa_id, count(*) as cantidad
  from ventas.pedido_tienda
  where folio is not null
  group by empresa_id
) sub
where e.id = sub.empresa_id;

update ventas.pedido_tienda
set token_publico = encode(extensions.gen_random_bytes(16), 'hex')
where token_publico is null;
