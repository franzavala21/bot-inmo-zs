-- Fase 5: matcher (propiedades nuevas ↔ interesados), avisos aprobados de a uno y agenda de visitas.
-- Reglas: ningún aviso sale sin que un dueño lo apruebe; no hay "aprobar todo"; fuera de las 24 h solo plantilla;
-- con plantilla, solo a quien aceptó recibir avisos; quien pide no recibir más, no vuelve a aparecer.

-- ¿Aceptó que le avisemos por WhatsApp si entra algo parecido? (lo pregunta el bot; {"value": bool, "quote": ...})
alter table lead_profiles add column if not exists wants_alerts jsonb;
-- Pidió no recibir más avisos (botón de la plantilla).
alter table contacts add column if not exists proactive_opt_out boolean not null default false;
-- Envío con plantilla de Meta: {"name": ..., "language": ..., "params": [...], "buttons": [...]}. null = texto libre.
alter table outbound_messages add column if not exists template jsonb;
-- Borradores: de qué propiedad y en qué chat.
alter table outbound_drafts add column if not exists property_id uuid references properties(id) on delete set null;
alter table outbound_drafts add column if not exists conversation_id uuid references conversations(id) on delete cascade;
create index if not exists drafts_pending on outbound_drafts (status, created_at);

create or replace function save_lead(
  p_contact_id uuid, p_conversation_id uuid, p_profile jsonb, p_conflicts jsonb, p_signals text[],
  p_score int, p_breakdown jsonb, p_rules_version int, p_last_message_at timestamptz, p_summary text
) returns void language plpgsql security definer set search_path = public as $$
declare s text;
begin
  insert into lead_profiles (contact_id, operation, zones, property_type, budget_max, budget_currency, rooms_min, pets,
    timeframe, financing, name, wants_visit, purpose, wants_alerts, conflicts, last_message_at, updated_at)
  values (p_contact_id, p_profile->'operation', p_profile->'zones', p_profile->'property_type', p_profile->'budget_max',
    p_profile->'budget_currency', p_profile->'rooms_min', p_profile->'pets', p_profile->'timeframe', p_profile->'financing',
    p_profile->'name', p_profile->'wants_visit', p_profile->'purpose', p_profile->'wants_alerts', coalesce(p_conflicts, '[]'::jsonb), p_last_message_at, now())
  on conflict (contact_id) do update set
    operation = excluded.operation, zones = excluded.zones, property_type = excluded.property_type,
    budget_max = excluded.budget_max, budget_currency = excluded.budget_currency, rooms_min = excluded.rooms_min,
    pets = excluded.pets, timeframe = excluded.timeframe, financing = excluded.financing, name = excluded.name,
    wants_visit = excluded.wants_visit, purpose = excluded.purpose, wants_alerts = excluded.wants_alerts, conflicts = excluded.conflicts, last_message_at = excluded.last_message_at,
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

-- ───────── Matcher: coincidencia + borrador + bitácora, juntos. Devuelve el id del borrador o null si ya existía. ─────────
create or replace function save_match(p_property_id uuid, p_contact_id uuid, p_conversation_id uuid, p_reasons jsonb, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_match uuid; v_draft uuid; v_channel uuid;
begin
  insert into property_matches (property_id, contact_id, reasons) values (p_property_id, p_contact_id, p_reasons)
    on conflict (property_id, contact_id) do nothing returning id into v_match;
  if v_match is null then return null; end if;
  select channel_id into v_channel from conversations where id = p_conversation_id;
  insert into outbound_drafts (match_id, contact_id, channel_id, body, property_id, conversation_id)
    values (v_match, p_contact_id, v_channel, p_body, p_property_id, p_conversation_id) returning id into v_draft;
  insert into audit_log (conversation_id, event, summary, details) values (p_conversation_id, 'match_found',
    'Entró una propiedad que coincide con lo que busca: aviso en borrador para aprobar',
    jsonb_build_object('property_id', p_property_id, 'draft_id', v_draft, 'reasons', p_reasons));
  return v_draft;
end $$;

-- ───────── Un dueño aprueba UN borrador: queda en la cola de envío, con su línea en la bitácora ─────────
create or replace function approve_draft(p_draft_id uuid, p_user uuid, p_body text, p_template jsonb, p_property_codes jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_d outbound_drafts; v_to text; v_opt boolean; v_msg uuid; v_out uuid;
begin
  select * into v_d from outbound_drafts where id = p_draft_id for update;
  if v_d.id is null or v_d.status <> 'pending' then raise exception 'el borrador ya no está pendiente'; end if;
  select coalesce(wa_jid, phone), proactive_opt_out into v_to, v_opt from contacts where id = v_d.contact_id;
  if v_opt then raise exception 'el contacto pidió no recibir avisos'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'mensaje vacío'; end if;

  insert into messages (conversation_id, author, body, sent_by) values (v_d.conversation_id, 'human', p_body, p_user) returning id into v_msg;
  insert into outbound_messages (conversation_id, channel_id, to_phone, body, priority, message_id, template)
    values (v_d.conversation_id, v_d.channel_id, v_to, p_body, 0, v_msg, p_template) returning id into v_out;
  update outbound_drafts set status = 'approved', body = p_body, decided_by = p_user, decided_at = now() where id = p_draft_id;
  update conversations set last_message_at = now() where id = v_d.conversation_id;
  insert into audit_log (conversation_id, event, summary, details) values (v_d.conversation_id, 'proactive_approved',
    case when p_template is null then 'Un dueño aprobó un aviso (texto)' else 'Un dueño aprobó un aviso (plantilla de Meta)' end,
    jsonb_build_object('draft_id', p_draft_id, 'by', p_user, 'outbound_id', v_out, 'property_codes', coalesce(p_property_codes, '[]'::jsonb)));
  -- Para que el bot sepa qué ficha se mostró si el cliente responde "sí, pasame la info".
  insert into audit_log (conversation_id, event, summary, details) values (v_d.conversation_id, 'sent',
    'Aviso de propiedad enviado a la cola', jsonb_build_object('property_codes', coalesce(p_property_codes, '[]'::jsonb), 'proactive', true));
  return v_out;
end $$;

create or replace function discard_draft(p_draft_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_d outbound_drafts;
begin
  select * into v_d from outbound_drafts where id = p_draft_id for update;
  if v_d.id is null or v_d.status <> 'pending' then return; end if;
  update outbound_drafts set status = 'rejected', decided_by = p_user, decided_at = now() where id = p_draft_id;
  insert into audit_log (conversation_id, event, summary, details) values (v_d.conversation_id, 'proactive_discarded',
    'Un dueño descartó un aviso', jsonb_build_object('draft_id', p_draft_id, 'by', p_user));
end $$;

-- ───────── El cliente pidió no recibir más avisos (botón de la plantilla) ─────────
create or replace function set_proactive_opt_out(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_contact uuid;
begin
  select contact_id into v_contact from conversations where id = p_conversation_id;
  if v_contact is null then return; end if;
  update contacts set proactive_opt_out = true where id = v_contact;
  update outbound_drafts set status = 'rejected', decided_at = now() where contact_id = v_contact and status = 'pending';
  insert into audit_log (conversation_id, event, summary, details) values (p_conversation_id, 'opt_out',
    'El cliente pidió no recibir más avisos: no se le vuelven a proponer', '{}'::jsonb);
end $$;

-- ───────── Agenda: alta/edición de una visita con su línea en la bitácora ─────────
create or replace function save_visit(p_id uuid, p_contact_id uuid, p_property_id uuid, p_starts_at timestamptz,
  p_notes text, p_status visit_status, p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_conv uuid;
begin
  if p_id is null then
    insert into visits (contact_id, property_id, starts_at, notes, status, assigned_to)
      values (p_contact_id, p_property_id, p_starts_at, nullif(trim(p_notes), ''), coalesce(p_status, 'scheduled'), p_user) returning id into v_id;
  else
    update visits set property_id = p_property_id, starts_at = p_starts_at, notes = nullif(trim(p_notes), ''),
      status = coalesce(p_status, status) where id = p_id returning id, contact_id into v_id, p_contact_id;
    if v_id is null then raise exception 'visita inexistente'; end if;
  end if;
  select id into v_conv from conversations where contact_id = p_contact_id order by last_message_at desc nulls last limit 1;
  insert into audit_log (conversation_id, event, summary, details) values (v_conv,
    case when p_id is null then 'visit_scheduled' else 'visit_updated' end,
    case when p_id is null then 'Un dueño agendó una visita' else 'Un dueño actualizó una visita' end,
    jsonb_build_object('visit_id', v_id, 'by', p_user, 'starts_at', p_starts_at, 'status', p_status));
  return v_id;
end $$;

revoke execute on function save_match, approve_draft, discard_draft, set_proactive_opt_out, save_visit from public, anon, authenticated;
