-- Homologación Usuarios (auditoría nov-2026): seguridad.rol existía vacío
-- porque nunca hubo una pantalla para darlo de alta. Se rellena con los
-- valores reales que YA usa seguridad.usuario.role por empresa (no se
-- inventa ningún rol nuevo) para que el selector de "Seguridad → Usuarios"
-- deje de depender del valor sintético inyectado por el frontend.
insert into seguridad.rol (nombre, activo, empresa_id)
select distinct u.role, true, u.empresa_id
from seguridad.usuario u
where u.role is not null and u.role <> ''
  and not exists (
    select 1 from seguridad.rol r
    where r.empresa_id = u.empresa_id and lower(r.nombre) = lower(u.role)
  );