-- Fase 4: ficha del lead (extractor) y puntaje (código).
-- La ficha, las señales, el puntaje y su línea en la bitácora se guardan juntos (save_lead).

-- Hasta qué mensaje del cliente se leyó la ficha (para no volver a leer si no hay nada nuevo).
alter table lead_profiles add column if not exists last_message_at timestamptz;
alter table lead_profiles add column if not exists wants_visit jsonb;

-- Cada señal una sola vez por contacto.
delete from lead_signals a using lead_signals b
  where a.contact_id = b.contact_id and a.signal = b.signal and a.created_at > b.created_at;
create unique index if not exists lead_signals_once on lead_signals (contact_id, signal);

create or replace function save_lead(
  p_contact_id uuid, p_conversation_id uuid, p_profile jsonb, p_conflicts jsonb, p_signals text[],
  p_score int, p_breakdown jsonb, p_rules_version int, p_last_message_at timestamptz, p_summary text
) returns void language plpgsql security definer set search_path = public as $$
declare s text;
begin
  insert into lead_profiles (contact_id, operation, zones, property_type, budget_max, budget_currency, rooms_min, pets,
    timeframe, financing, name, wants_visit, conflicts, last_message_at, updated_at)
  values (p_contact_id, p_profile->'operation', p_profile->'zones', p_profile->'property_type', p_profile->'budget_max',
    p_profile->'budget_currency', p_profile->'rooms_min', p_profile->'pets', p_profile->'timeframe', p_profile->'financing',
    p_profile->'name', p_profile->'wants_visit', coalesce(p_conflicts, '[]'::jsonb), p_last_message_at, now())
  on conflict (contact_id) do update set
    operation = excluded.operation, zones = excluded.zones, property_type = excluded.property_type,
    budget_max = excluded.budget_max, budget_currency = excluded.budget_currency, rooms_min = excluded.rooms_min,
    pets = excluded.pets, timeframe = excluded.timeframe, financing = excluded.financing, name = excluded.name,
    wants_visit = excluded.wants_visit, conflicts = excluded.conflicts, last_message_at = excluded.last_message_at,
    updated_at = now();

  foreach s in array coalesce(p_signals, '{}'::text[]) loop
    insert into lead_signals (contact_id, signal) values (p_contact_id, s) on conflict do nothing;
  end loop;

  insert into lead_scores (contact_id, score, breakdown, rules_version, computed_at)
  values (p_contact_id, p_score, p_breakdown, p_rules_version, now())
  on conflict (contact_id) do update set score = excluded.score, breakdown = excluded.breakdown,
    rules_version = excluded.rules_version, computed_at = now();

  insert into audit_log (conversation_id, event, summary, details)
  values (p_conversation_id, 'lead_updated', p_summary,
    jsonb_build_object('score', p_score, 'rules_version', p_rules_version, 'conflicts', jsonb_array_length(coalesce(p_conflicts, '[]'::jsonb))));
end $$;

revoke execute on function save_lead from public, anon, authenticated;
