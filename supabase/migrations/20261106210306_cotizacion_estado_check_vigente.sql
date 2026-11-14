ALTER TABLE ventas.cotizacion DROP CONSTRAINT cotizacion_estado_check;
ALTER TABLE ventas.cotizacion
  ADD CONSTRAINT cotizacion_estado_check
  CHECK (estado = ANY (ARRAY['Vigente'::text, 'Convertida'::text, 'Cancelada'::text]));