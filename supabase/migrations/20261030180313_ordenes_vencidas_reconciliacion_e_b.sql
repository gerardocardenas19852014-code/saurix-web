
-- BLOQUE E-B: reconciliacion por lotes para "orden vencida". Es la UNICA via
-- posible (depende solo de la fecha, nunca hay trigger -- ver diseño
-- aprobado), asi que se queda permanentemente cada minuto, igual que SLA
-- y "pago" de Tarjetas.

create or replace function inventario.fn_reconciliar_ordenes_vencidas()
returns void
language sql
security definer
set search_path = ''
as $function$
  with candidatos as (
    select oc.id as orden_id, oc.folio
    from inventario.orden_compra oc
    where oc.estado in ('pendiente', 'recibida_parcial')
      and oc.fecha_entrega_estimada is not null
      and oc.fecha_entrega_estimada < current_date
  )
  select inventario.fn_generar_aviso_orden_vencida(c.orden_id, c.folio)
  from candidatos c;
$function$;

revoke all on function inventario.fn_reconciliar_ordenes_vencidas() from public, anon, authenticated;

select cron.schedule('reconciliar-ordenes-vencidas', '* * * * *', $$select inventario.fn_reconciliar_ordenes_vencidas();$$);
