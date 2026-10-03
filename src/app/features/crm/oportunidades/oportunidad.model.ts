export interface Oportunidad {
  id: number;
  nombre: string;
  /** Opcional — una oportunidad puede nacer de un prospecto que aún no es un
   *  Cliente formal (Comercio.Cliente); se deja sin dueño hasta que se decida. */
  clienteId: number | null;
  valorEstimado: number | null;
  /** FK a OportunidadEtapaConfig (ver oportunidad-etapa.model.ts) — hasta
   *  2026-10-02 esto era un enum fijo de 6 valores (OportunidadEtapa); ahora
   *  las etapas son un catálogo editable desde CRM → Oportunidades → Gestor
   *  de Etapas, igual que TableroColumna en Gestión de Proyectos. */
  etapaId: number;
  fechaCierreEstimada: string | null;
  /** Solo aplica (y se exige) cuando la etapa tiene `esPerdida === true`. */
  motivoPerdidaId: number | null;
  notas: string | null;
  fechaCreacion?: string;
  fechaModificacion?: string;
}

export interface MotivoPerdida {
  id: number;
  nombre: string;
  activo: boolean;
}
