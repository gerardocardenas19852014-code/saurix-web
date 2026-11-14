alter table proyectos.proyecto
  add column es_prueba boolean not null default false;

update proyectos.proyecto
  set es_prueba = true
  where id = 6;

comment on column proyectos.proyecto.es_prueba is
  'Marca un proyecto como datos de prueba de carga (p.ej. "Prueba de Rendimiento" con 200,000 tickets sintéticos, mantenidos a propósito para pruebas de rendimiento) para excluirlo de reportes/estadísticas agregadas ENTRE proyectos (Dashboard, Balanceo de carga, Reportes ejecutivos, Reportes de horas, Resumen ejecutivo, asistente IA) sin borrar ni afectar sus datos — dentro de su propio proyecto (Kanban/Backlog/Gantt/Gestor de estados) sigue viéndose normal, para seguir sirviendo como prueba de carga.';