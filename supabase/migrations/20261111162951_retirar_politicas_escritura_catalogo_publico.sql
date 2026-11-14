-- ============================================================================
-- SAURIX — B4.4, Corrección 2: retiro de políticas de escritura pública en
-- catalogo-publico.
-- ============================================================================

begin;

-- ── Validación previa ───────────────────────────────────────────────────
do $$
declare
  v_existe_subir boolean;
  v_existe_actualizar boolean;
  v_existe_borrar boolean;
  v_existe_ver boolean;
begin
  select exists(
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='catalogo_publico_subir'
      and cmd='INSERT' and roles::text = '{public}'
  ) into v_existe_subir;

  select exists(
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='catalogo_publico_actualizar'
      and cmd='UPDATE' and roles::text = '{public}'
  ) into v_existe_actualizar;

  select exists(
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='catalogo_publico_borrar'
      and cmd='DELETE' and roles::text = '{public}'
  ) into v_existe_borrar;

  select exists(
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='catalogo_publico_ver'
      and cmd='SELECT'
  ) into v_existe_ver;

  if not (v_existe_subir and v_existe_actualizar and v_existe_borrar) then
    raise exception 'Abortado: una o más de las 3 políticas de escritura esperadas no existen o cambiaron de definición. Revisar antes de continuar.';
  end if;

  if not v_existe_ver then
    raise exception 'Abortado: la política de lectura pública catalogo_publico_ver no existe. No se procede sin confirmar que la lectura pública está intacta antes del cambio.';
  end if;
end $$;

-- ── Retiro de las 3 políticas de escritura (sin tocar la de lectura) ──────
drop policy catalogo_publico_subir on storage.objects;
drop policy catalogo_publico_actualizar on storage.objects;
drop policy catalogo_publico_borrar on storage.objects;

-- ── Validación posterior ───────────────────────────────────────────────
do $$
declare
  v_restantes integer;
  v_lectura_intacta boolean;
  v_total_politicas_catalogo integer;
begin
  select count(*) into v_restantes
  from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname in ('catalogo_publico_subir','catalogo_publico_actualizar','catalogo_publico_borrar');

  if v_restantes <> 0 then
    raise exception 'Abortado: alguna de las 3 políticas retiradas sigue existiendo tras el DROP. Revisar.';
  end if;

  select exists(
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='catalogo_publico_ver' and cmd='SELECT'
      and qual = '(bucket_id = ''catalogo-publico''::text)'
  ) into v_lectura_intacta;

  if not v_lectura_intacta then
    raise exception 'Abortado: la política de lectura pública catalogo_publico_ver ya no existe o su condición cambió inesperadamente. Revisar.';
  end if;

  select count(*) into v_total_politicas_catalogo
  from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname like 'catalogo_publico_%';

  if v_total_politicas_catalogo <> 1 then
    raise exception 'Abortado: se esperaba exactamente 1 política restante para catalogo-publico (la de lectura), se encontraron %. Revisar.', v_total_politicas_catalogo;
  end if;
end $$;

commit;