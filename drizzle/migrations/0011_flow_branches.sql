-- Ramas sí/no en los flujos de seguimiento.
-- Los pasos siguen en flows.steps (jsonb); un paso "condition" lleva sus ramas "yes" y "no".
-- El motor recorre los pasos como un grafo por id, así que la inscripción guarda el id del
-- siguiente paso en lugar de un índice. Las inscripciones existentes quedan con
-- current_node NULL y el motor retoma con current_step como hasta ahora.
-- No hay tablas nuevas: las políticas de flow_enrollments (0008) cubren la columna.
ALTER TABLE public.flow_enrollments ADD COLUMN IF NOT EXISTS current_node text;
COMMENT ON COLUMN public.flow_enrollments.current_node IS
  'Id del siguiente paso del flujo; ''$end'' = no queda nada; NULL = usar current_step (inscripciones anteriores).';

-- "¿Respondió?" debe contar sólo mensajes del prospecto, no de un asesor.
-- La cancelación anti-spam no cambia: un asesor sigue cancelando el flujo.
CREATE OR REPLACE FUNCTION public.flow_cancel_on_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sender = 'bot' THEN RETURN NEW; END IF;
  UPDATE public.flow_enrollments e SET
    replied = e.replied OR NEW.sender = 'lead',
    status = CASE WHEN f.stop_on_reply THEN 'cancelled' ELSE e.status END,
    cancel_reason = CASE WHEN f.stop_on_reply THEN (CASE WHEN NEW.sender = 'asesor' THEN 'Intervino un asesor' ELSE 'Respondió el prospecto' END) ELSE e.cancel_reason END
  FROM public.flows f
  WHERE f.id = e.flow_id AND e.lead_id = NEW.lead_id AND e.status = 'active';
  RETURN NEW;
END $$;
