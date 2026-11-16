-- Seguimientos: retomar a quien dejó de responder. Van como borradores en Avisos y un dueño los aprueba de a uno.
-- kind: 'match' (propiedad nueva), 'follow_up_1' (20 h, texto), 'follow_up_2' (3 días, plantilla).
-- anchor_message_id: el último mensaje del cliente al que se refiere (un seguimiento de cada tipo por silencio).
alter table outbound_drafts add column if not exists kind text not null default 'match';
alter table outbound_drafts add column if not exists anchor_message_id uuid references messages(id) on delete cascade;
create unique index if not exists drafts_follow_up_once on outbound_drafts (conversation_id, kind, anchor_message_id)
  where anchor_message_id is not null;

create or replace function save_follow_up(p_conversation_id uuid, p_kind text, p_anchor uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_conv conversations; v_id uuid;
begin
  select * into v_conv from conversations where id = p_conversation_id;
  if v_conv.id is null then return null; end if;
  insert into outbound_drafts (contact_id, channel_id, body, conversation_id, kind, anchor_message_id)
    values (v_conv.contact_id, v_conv.channel_id, p_body, p_conversation_id, p_kind, p_anchor)
    on conflict (conversation_id, kind, anchor_message_id) where anchor_message_id is not null do nothing
    returning id into v_id;
  if v_id is null then return null; end if;
  insert into audit_log (conversation_id, event, summary, details) values (p_conversation_id, 'follow_up_drafted',
    case when p_kind = 'follow_up_1' then 'No respondió en 20 h: seguimiento en borrador para aprobar'
         else 'No respondió en 3 días: seguimiento con plantilla en borrador para aprobar' end,
    jsonb_build_object('draft_id', v_id, 'kind', p_kind));
  return v_id;
end $$;

-- El cliente volvió a escribir: los seguimientos pendientes de ese chat ya no corresponden.
create or replace function discard_answered_follow_ups()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record;
begin
  for r in update outbound_drafts d set status = 'rejected', decided_at = now()
    where d.status = 'pending' and d.kind like 'follow_up_%' and exists (
      select 1 from messages m, messages a where a.id = d.anchor_message_id and m.conversation_id = d.conversation_id
        and m.author = 'client' and m.created_at > a.created_at)
    returning d.id, d.conversation_id
  loop
    v_count := v_count + 1;
    insert into audit_log (conversation_id, event, summary, details) values (r.conversation_id, 'proactive_discarded',
      'El cliente volvió a escribir: se descartó el seguimiento pendiente', jsonb_build_object('draft_id', r.id));
  end loop;
  return v_count;
end $$;

revoke execute on function save_follow_up, discard_answered_follow_ups from public, anon, authenticated;
