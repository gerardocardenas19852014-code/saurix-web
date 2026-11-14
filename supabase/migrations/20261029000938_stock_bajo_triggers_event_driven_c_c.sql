
-- BLOQUE C — STOCK, sub-bloque C-C: triggers event-driven. Cada uno evalúa
-- ÚNICAMENTE el producto/bodega afectado por el cambio que lo disparó —
-- nunca recorre el catálogo completo. Reutilizan tal cual las funciones de
-- C-B (sin duplicar lógica de negocio aquí).

-- 1) existencia_bodega: cualquier movimiento de inventario real pasa por
--    aquí (ver auditoría de rutas de escritura en el diseño). Si la bodega
--    afectada tiene NivelMinimoBodega propio -> regla por bodega. Si el
--    producto no tiene NINGÚN NivelMinimoBodega -> esta fila alimenta la
--    suma global (existencia_producto_resumen), se evalúa la regla global.
--    Si el producto tiene NMB en OTRAS bodegas pero no en esta, no se
--    evalúa nada (exactamente igual que hoy en Angular: esa bodega
--    "huérfana" no participa en ninguna de las dos reglas).
create or replace function inventario.fn_trigger_stock_bajo_existencia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tiene_nmb_esta_bodega boolean;
  v_tiene_algun_nmb boolean;
  v_eval record;
begin
  select exists(
    select 1 from inventario.nivel_minimo_bodega n
    where n.producto_id = new.producto_id and n.bodega_id = new.bodega_id
  ) into v_tiene_nmb_esta_bodega;

  if v_tiene_nmb_esta_bodega then
    select * into v_eval from inventario.fn_evaluar_stock_bajo_bodega(new.producto_id, new.bodega_id);
    if v_eval.candidato then
      perform inventario.fn_generar_avisos_stock_bajo(new.producto_id, new.bodega_id, v_eval.existencia, v_eval.nivel_minimo);
    end if;
    return null;
  end if;

  select exists(
    select 1 from inventario.nivel_minimo_bodega n where n.producto_id = new.producto_id
  ) into v_tiene_algun_nmb;

  if not v_tiene_algun_nmb then
    select * into v_eval from inventario.fn_evaluar_stock_bajo_global(new.producto_id);
    if v_eval.candidato then
      perform inventario.fn_generar_avisos_stock_bajo(new.producto_id, null, v_eval.existencia, v_eval.nivel_minimo);
    end if;
  end if;

  return null;
end;
$$;

revoke all on function inventario.fn_trigger_stock_bajo_existencia() from public, anon, authenticated;

create trigger trg_stock_bajo_desde_existencia
  after insert or update of existencia on inventario.existencia_bodega
  for each row execute function inventario.fn_trigger_stock_bajo_existencia();

-- 2) nivel_minimo_bodega: crear/cambiar un mínimo re-evalúa esa bodega
--    concreta; borrar el ÚLTIMO mínimo de un producto hace que vuelva a
--    aplicar la regla global, así que se re-evalúa esa (transición
--    bodega -> global, sin necesitar ningún movimiento nuevo).
create or replace function inventario.fn_trigger_stock_bajo_nivel_minimo_bodega()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_producto_id bigint;
  v_quedan_nmb boolean;
  v_eval record;
begin
  if tg_op = 'DELETE' then
    v_producto_id := old.producto_id;
    select exists(select 1 from inventario.nivel_minimo_bodega n where n.producto_id = v_producto_id)
      into v_quedan_nmb;
    if not v_quedan_nmb then
      select * into v_eval from inventario.fn_evaluar_stock_bajo_global(v_producto_id);
      if v_eval.candidato then
        perform inventario.fn_generar_avisos_stock_bajo(v_producto_id, null, v_eval.existencia, v_eval.nivel_minimo);
      end if;
    end if;
    return null;
  end if;

  select * into v_eval from inventario.fn_evaluar_stock_bajo_bodega(new.producto_id, new.bodega_id);
  if v_eval.candidato then
    perform inventario.fn_generar_avisos_stock_bajo(new.producto_id, new.bodega_id, v_eval.existencia, v_eval.nivel_minimo);
  end if;
  return null;
end;
$$;

revoke all on function inventario.fn_trigger_stock_bajo_nivel_minimo_bodega() from public, anon, authenticated;

create trigger trg_stock_bajo_desde_nivel_minimo_bodega
  after insert or update of nivel_minimo or delete on inventario.nivel_minimo_bodega
  for each row execute function inventario.fn_trigger_stock_bajo_nivel_minimo_bodega();

-- 3) producto: solo importa mientras el producto NO tenga NMB propio
--    (modo global) — si lo tiene, fn_evaluar_stock_bajo_global ya devuelve
--    0 filas por su cuenta, así que no hace falta duplicar ese guard aquí.
create or replace function inventario.fn_trigger_stock_bajo_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eval record;
begin
  select * into v_eval from inventario.fn_evaluar_stock_bajo_global(new.id);
  if v_eval.candidato then
    perform inventario.fn_generar_avisos_stock_bajo(new.id, null, v_eval.existencia, v_eval.nivel_minimo);
  end if;
  return null;
end;
$$;

revoke all on function inventario.fn_trigger_stock_bajo_producto() from public, anon, authenticated;

create trigger trg_stock_bajo_desde_producto
  after update of nivel_minimo, existencia on inventario.producto
  for each row execute function inventario.fn_trigger_stock_bajo_producto();
