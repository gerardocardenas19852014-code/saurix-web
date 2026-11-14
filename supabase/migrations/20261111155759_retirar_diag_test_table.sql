do $$
declare
  v_filas bigint;
  v_fk bigint;
begin
  select count(*) into v_filas from public._diag_test_table;
  select count(*) into v_fk from pg_constraint where confrelid = 'public._diag_test_table'::regclass;

  if v_filas > 0 then
    raise exception 'Abortado: la tabla tiene % filas, ya no está vacía. Revisar antes de continuar.', v_filas;
  end if;

  if v_fk > 0 then
    raise exception 'Abortado: existen % dependencias de clave foránea nuevas. Revisar antes de continuar.', v_fk;
  end if;
end $$;

drop table if exists public._diag_test_table;