create or replace function inventario.fn_ordenes_compra_resumen()
returns table(total_pendientes bigint, total_vencidas bigint)
language sql
stable
set search_path = ''
as $function$
  select
    count(*) filter (where estado in ('pendiente', 'recibida_parcial')),
    count(*) filter (
      where estado in ('pendiente', 'recibida_parcial')
        and fecha_entrega_estimada is not null
        and fecha_entrega_estimada < current_date
    )
  from inventario.orden_compra;
$function$;