-- Paso 1: columna nueva (nullable primero), backfill según la regla
-- posicional EXACTA ya vigente (última columna por orden, por proyecto),
-- validación, y solo entonces NOT NULL + DEFAULT. No se asume false para
-- nada: se calcula para cada ticket existente.

alter table proyectos.ticket add column if not exists resuelto boolean;

update proyectos.ticket t
set resuelto = (t.tablero_columna_id = uc.columna_id)
from (
  select proyecto_id, id as columna_id
  from (
    select proyecto_id, id,
           row_number() over (partition by proyecto_id order by orden desc) as rn
    from proyectos.tablero_columna
  ) x where rn = 1
) uc
where uc.proyecto_id = t.proyecto_id;

-- Para proyectos sin ninguna columna (no debería existir, pero por si acaso)
update proyectos.ticket set resuelto = false where resuelto is null;

alter table proyectos.ticket alter column resuelto set not null;
alter table proyectos.ticket alter column resuelto set default false;