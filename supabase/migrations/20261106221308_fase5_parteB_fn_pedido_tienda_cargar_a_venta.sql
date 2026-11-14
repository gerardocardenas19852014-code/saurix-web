create or replace function ventas.fn_pedido_tienda_cargar_a_venta(
  p_pedido_id bigint,
  p_turno_caja_id bigint,
  p_cliente_id bigint,
  p_vendedor_usuario_id bigint,
  p_notas text,
  p_canal text,
  p_lineas jsonb,
  p_pagos jsonb,
  p_puntos_a_canjear integer default 0
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_usuario_id bigint := privado.usuario_actual_id();
  v_pedido ventas.pedido_tienda;
  v_venta_id bigint;
begin
  -- Cota explícita de espera (nunca indefinida) — ver revisión técnica de
  -- Fase 5 Parte B.
  set local lock_timeout = '5s';

  -- Candado de fila: nadie más puede tocar este pedido mientras dura esta
  -- transacción. RLS normal (solo_mi_empresa) ya filtra por empresa ANTES
  -- de llegar aquí — esta función es SECURITY INVOKER (igual que
  -- fn_venta_registrar/fn_reclamar_pedido_tienda, ninguna SECURITY
  -- DEFINER), así que un usuario de otra empresa ni siquiera puede ver
  -- esta fila para bloquearla.
  select * into v_pedido
  from ventas.pedido_tienda
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'Pedido % no encontrado o no pertenece a esta empresa.', p_pedido_id;
  end if;

  -- Idempotencia: una llamada repetida sobre un pedido YA Confirmado
  -- (doble clic, reintento de red, dos cajeros casi simultáneos) regresa
  -- la MISMA venta ya existente — nunca crea una segunda. El contrato de
  -- respuesta distingue explícitamente este caso con "creadaEnEstaSolicitud:
  -- false" (nunca se infiere por fecha ni por ningún otro campo
  -- ambiguo) — ver sección 3 de la verificación final de Fase 5 Parte B.
  if v_pedido.estado = 'Confirmado' then
    if v_pedido.venta_id is null then
      raise exception 'El pedido % quedó Confirmado sin venta asociada — estado inconsistente, revisar a mano.', p_pedido_id;
    end if;
    return jsonb_build_object('ventaId', v_pedido.venta_id, 'creadaEnEstaSolicitud', false);
  end if;

  -- Un pedido ya Descartado/Expirado nunca se "revive" por esta vía.
  if v_pedido.estado <> 'Pendiente' then
    raise exception 'El pedido % no está Pendiente (estado actual: %) — no se puede confirmar.', p_pedido_id, v_pedido.estado;
  end if;

  -- Segunda capa de defensa (la primera es el candado de arriba): respeta
  -- un reclamo vigente de OTRO cajero tomado por fn_reclamar_pedido_tienda.
  if v_pedido.reclamado_por is not null
     and v_pedido.reclamado_por <> v_usuario_id
     and v_pedido.reclamado_en > now() - interval '5 minutes' then
    raise exception 'El pedido % está reclamado por otro cajero.', p_pedido_id;
  end if;

  -- Registra la venta reutilizando fn_venta_registrar TAL CUAL, sin
  -- modificarlo. Si esto lanza una excepción, se propaga sin atraparla:
  -- TODA esta función se revierte con ella — el pedido se queda
  -- exactamente como estaba, porque el UPDATE de abajo nunca se ejecuta.
  v_venta_id := ventas.fn_venta_registrar(
    p_turno_caja_id, p_cliente_id, p_vendedor_usuario_id, p_notas, p_canal,
    p_lineas, p_pagos, p_puntos_a_canjear
  );

  -- Vincula el pedido con la venta recién creada, EN LA MISMA transacción:
  -- si este UPDATE fallara, Postgres revierte también la venta de arriba.
  update ventas.pedido_tienda
  set estado = 'Confirmado', venta_id = v_venta_id, reclamado_por = null, reclamado_en = null
  where id = p_pedido_id;

  return jsonb_build_object('ventaId', v_venta_id, 'creadaEnEstaSolicitud', true);
end;
$function$;

grant execute on function ventas.fn_pedido_tienda_cargar_a_venta(
  bigint, bigint, bigint, bigint, text, text, jsonb, jsonb, integer
) to authenticated;