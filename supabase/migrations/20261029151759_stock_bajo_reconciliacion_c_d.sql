
-- C-D: reconciliacion por lotes (set-based) para stock bajo.
-- Red de seguridad frente a los triggers event-driven de C-C: encuentra TODOS los
-- productos/bodegas que actualmente estan por debajo de su nivel minimo y que aun
-- no tienen aviso generado hoy, y delega la escritura en la MISMA funcion de C-B
-- (fn_generar_avisos_stock_bajo) para no duplicar la regla de negocio ni el texto
-- de la notificacion. La deduplicacion por (producto,usuario,dia,bodega) ya la
-- garantiza el indice unico existente + ON CONFLICT DO NOTHING dentro de esa funcion,
-- por lo que esta reconciliacion es segura de ejecutar repetidamente sin generar
-- avisos duplicados, incluso si los destinatarios cambiaron durante el dia.

create or replace function inventario.fn_reconciliar_avisos_stock_bajo()
returns table(usuario_id bigint, producto_id bigint, bodega_id bigint)
language sql
security definer
set search_path = ''
as $function$
  with candidatos_bodega as (
    select n.producto_id, n.bodega_id,
           coalesce(eb.existencia, 0) as existencia,
           n.nivel_minimo
    from inventario.nivel_minimo_bodega n
    join inventario.producto pr on pr.id = n.producto_id
    left join inventario.existencia_bodega eb
      on eb.producto_id = n.producto_id and eb.bodega_id = n.bodega_id
    where pr.activo
      and pr.existencia is not null
      and coalesce(eb.existencia, 0) < n.nivel_minimo
  ),
  candidatos_global as (
    select pr.id as producto_id, null::bigint as bodega_id,
           coalesce(epr.existencia_total, pr.existencia, 0) as existencia,
           pr.nivel_minimo
    from inventario.producto pr
    left join inventario.existencia_producto_resumen epr on epr.producto_id = pr.id
    where pr.activo
      and pr.existencia is not null
      and pr.nivel_minimo is not null
      and coalesce(epr.existencia_total, pr.existencia, 0) < pr.nivel_minimo
      and not exists (
        select 1 from inventario.nivel_minimo_bodega n2 where n2.producto_id = pr.id
      )
  ),
  candidatos as (
    select * from candidatos_bodega
    union all
    select * from candidatos_global
  )
  select g.usuario_id, c.producto_id, c.bodega_id
  from candidatos c
  cross join lateral inventario.fn_generar_avisos_stock_bajo(
    c.producto_id, c.bodega_id, c.existencia, c.nivel_minimo
  ) g;
$function$;

revoke all on function inventario.fn_reconciliar_avisos_stock_bajo() from public, anon, authenticated;
