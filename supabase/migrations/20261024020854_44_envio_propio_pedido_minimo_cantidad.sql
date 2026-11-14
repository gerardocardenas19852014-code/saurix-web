-- El "Pedido mínimo para envío propio" pasa de ser un monto en pesos a ser
-- una CANTIDAD MÍNIMA DE PRODUCTOS/PIEZAS en el carrito (decisión del
-- negocio tras probarlo: querían exigir un número de piezas, no un monto).
-- Antes: numeric(14,2) (p.ej. 150.00 pesos). Ahora: integer (p.ej. 4 piezas).
-- round() antes del cast para no truncar hacia abajo un valor ya guardado
-- (4.00 -> 4; si alguien hubiera guardado 4.60 -> 5, no 4).
alter table seguridad.empresa
  alter column envio_propio_pedido_minimo type integer
  using round(envio_propio_pedido_minimo)::integer;

alter table seguridad.empresa
  alter column envio_propio_pedido_minimo
  set default null;

comment on column seguridad.empresa.envio_propio_pedido_minimo is
  'Cantidad mínima de productos/piezas en el carrito para poder elegir "Envío del negocio" (NULL = sin mínimo). Se compara contra la suma de cantidades del carrito, no contra el subtotal en dinero.';