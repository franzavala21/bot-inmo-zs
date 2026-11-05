-- Fase 3: bot que responde (F-08 a F-11).
-- Cada decisión del bot y su envío quedan en audit_log en la misma transacción (bot_commit).

-- Interruptor general por canal. Arranca APAGADO: lo prenden los dueños desde /conexion.
alter table channels add column if not exists bot_enabled boolean not null default false;

-- Último mensaje del cliente que tomó el bot (evita procesar dos veces el mismo turno).
alter table conversations add column if not exists bot_last_message_id uuid;

-- ───────── Info del negocio: lo único (además de Tokko) que el bot puede afirmar ─────────
create table if not exists business_info (
  key text primary key,
  title text not null,
  body text not null default '',          -- vacío = el bot no sabe nada de ese tema y deriva
  sort int not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into business_info (key, title, sort) values
  ('horarios', 'Horarios de atención', 1),
  ('oficina', 'Dónde estamos (oficina)', 2),
  ('como_trabajamos', 'Cómo trabajamos', 3),
  ('requisitos_compra', 'Qué necesita alguien para comprar', 4),
  ('honorarios', 'Honorarios / comisión', 5),
  ('otros', 'Otros datos que el bot puede decir', 6)
on conflict (key) do nothing;

alter table business_info enable row level security;
create policy owners_all on business_info for all to authenticated using (is_owner()) with check (is_owner());

-- ───────── Tomar un turno del bot ─────────
-- true solo si: el canal tiene el bot prendido, el chat está en modo IA y el mensaje
-- sigue siendo el último del cliente (si llegó otro, lo atiende el turno de ese).
create or replace function claim_bot_turn(p_conversation_id uuid, p_message_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_conv conversations; v_enabled boolean; v_latest uuid;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv.id is null or v_conv.mode <> 'ai' then return false; end if;
  select bot_enabled into v_enabled from channels where id = v_conv.channel_id;
  if not coalesce(v_enabled, false) then return false; end if;
  select id into v_latest from messages
    where conversation_id = p_conversation_id and author = 'client'
    order by created_at desc, id desc limit 1;
  if v_latest is distinct from p_message_id then return false; end if;
  if v_conv.bot_last_message_id is not distinct from p_message_id then return false; end if;
  update conversations set bot_last_message_id = p_message_id where id = p_conversation_id;
  return true;
end $$;

-- ───────── Cerrar un turno del bot ─────────
-- p_trace: [{event, summary, details}] con cada paso (clasificó, buscó, rechazos, etc.).
-- Si un dueño tomó el chat o llegó otro mensaje del cliente mientras pensaba, no se envía nada.
create or replace function bot_commit(
  p_conversation_id uuid, p_message_id uuid, p_body text, p_handoff boolean, p_reason text, p_trace jsonb,
  p_send_details jsonb default '{}'::jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare v_conv conversations; v_msg_at timestamptz; e jsonb;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv.id is null then raise exception 'conversación inexistente'; end if;

  for e in select * from jsonb_array_elements(coalesce(p_trace, '[]'::jsonb)) loop
    insert into audit_log (conversation_id, event, summary, details)
      values (p_conversation_id, e->>'event', e->>'summary', e->'details');
  end loop;

  if v_conv.mode = 'human' then
    insert into audit_log (conversation_id, event, summary, details) values (p_conversation_id, 'discarded',
      'El bot no respondió: una persona tomó el chat mientras pensaba', jsonb_build_object('message_id', p_message_id));
    return 'human';
  end if;

  select created_at into v_msg_at from messages where id = p_message_id;
  if exists (select 1 from messages where conversation_id = p_conversation_id and author = 'client'
             and (created_at > v_msg_at or (created_at = v_msg_at and id > p_message_id))) then
    insert into audit_log (conversation_id, event, summary, details) values (p_conversation_id, 'discarded',
      'El bot no respondió: el cliente escribió de nuevo y se responde todo junto', jsonb_build_object('message_id', p_message_id));
    return 'stale';
  end if;

  if p_body is not null and trim(p_body) <> '' then
    perform enqueue_reply(p_conversation_id, p_body, 'ai', null,
      case when p_handoff then 'sent_handoff' else 'sent' end,
      case when p_handoff then 'El bot respondió y derivó a una persona' else 'El bot respondió' end,
      coalesce(p_send_details, '{}'::jsonb) || jsonb_build_object('message_id', p_message_id));
  end if;

  if p_handoff then
    update conversations set mode = 'human', needs_attention = true, attention_reason = left(p_reason, 200)
      where id = p_conversation_id;
    insert into audit_log (conversation_id, event, summary, details) values (p_conversation_id, 'handoff',
      'Derivado a una persona: ' || coalesce(p_reason, 'sin motivo'), jsonb_build_object('to', 'human'));
  end if;
  return case when p_handoff then 'handoff' else 'sent' end;
end $$;

-- Prender/apagar el bot de un canal, con su línea en la bitácora.
create or replace function set_bot_enabled(p_channel_id uuid, p_enabled boolean, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update channels set bot_enabled = p_enabled where id = p_channel_id;
  insert into audit_log (conversation_id, event, summary, details) values (null, 'bot_toggled',
    case when p_enabled then 'Un dueño prendió el bot' else 'Un dueño apagó el bot' end,
    jsonb_build_object('channel_id', p_channel_id, 'enabled', p_enabled, 'by', p_user));
end $$;

revoke execute on function claim_bot_turn, bot_commit, set_bot_enabled from public, anon, authenticated;
