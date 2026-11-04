-- Fase 2: WhatsApp de punta a punta (F-05 a F-07).
-- Funciones atómicas: cada cambio y su línea de audit_log van en la misma transacción.

-- WhatsApp a veces identifica al contacto solo por LID (id@lid) y no por número.
-- wa_jid es la dirección a la que hay que responder; phone queda como identificador estable.
alter table contacts add column if not exists wa_jid text;

-- Tipo de mensaje (text, audio, image…) para mostrarlo en la bandeja.
alter table messages add column if not exists kind text not null default 'text';

-- ───────── Entrada: lo llama /api/inbound (service role) ─────────
create or replace function ingest_inbound(
  p_channel_slug text, p_wa_message_id text, p_phone text, p_wa_jid text, p_display_name text,
  p_from_me boolean, p_kind text, p_body text, p_media_path text, p_sent_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_channel_id uuid; v_contact_id uuid; v_conv conversations; v_msg_id uuid;
begin
  select id into v_channel_id from channels where slug = p_channel_slug and active;
  if v_channel_id is null then raise exception 'canal inexistente o inactivo: %', p_channel_slug; end if;

  -- El nombre de WhatsApp solo se toma de mensajes del cliente (en los propios es el nuestro).
  insert into contacts (phone, wa_jid, display_name)
    values (p_phone, p_wa_jid, case when p_from_me then null else p_display_name end)
  on conflict (phone) do update set
    wa_jid = coalesce(excluded.wa_jid, contacts.wa_jid),
    display_name = coalesce(excluded.display_name, contacts.display_name)
  returning id into v_contact_id;

  insert into conversations (contact_id, channel_id) values (v_contact_id, v_channel_id)
    on conflict (contact_id, channel_id) do nothing;
  select * into v_conv from conversations
    where contact_id = v_contact_id and channel_id = v_channel_id for update;

  -- Idempotente: si el worker reintenta, el mensaje no se duplica.
  insert into messages (conversation_id, author, kind, body, media_path, wa_message_id, created_at)
    values (v_conv.id, case when p_from_me then 'human' else 'client' end::msg_author,
            coalesce(p_kind, 'text'), p_body, p_media_path, p_wa_message_id, coalesce(p_sent_at, now()))
  on conflict (conversation_id, wa_message_id) do nothing
  returning id into v_msg_id;

  if v_msg_id is null then
    return jsonb_build_object('conversation_id', v_conv.id, 'message_id', null, 'duplicate', true);
  end if;

  update conversations set last_message_at = greatest(last_message_at, coalesce(p_sent_at, now()))
    where id = v_conv.id;

  insert into audit_log (conversation_id, event, summary, details) values (
    v_conv.id, case when p_from_me then 'outbound_phone' else 'inbound' end,
    case when p_from_me then 'Un dueño escribió desde el teléfono del chip' else 'Mensaje recibido' end,
    jsonb_build_object('message_id', v_msg_id, 'kind', p_kind));

  -- Si un dueño contesta desde el teléfono, el chat pasa a humano para que el bot no se cruce.
  if p_from_me and v_conv.mode = 'ai' then
    update conversations set mode = 'human', needs_attention = false, attention_reason = null where id = v_conv.id;
    insert into audit_log (conversation_id, event, summary, details) values (
      v_conv.id, 'mode_changed', 'Pasa a modo humano: un dueño respondió desde el teléfono', jsonb_build_object('to', 'human'));
  end if;

  return jsonb_build_object('conversation_id', v_conv.id, 'message_id', v_msg_id, 'duplicate', false);
end $$;

-- ───────── Respuesta: ahora prefiere wa_jid (contactos que solo tienen LID) ─────────
create or replace function enqueue_reply(
  p_conversation_id uuid, p_body text, p_author msg_author, p_sent_by uuid,
  p_audit_event text, p_audit_summary text, p_audit_details jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_conv conversations; v_to text; v_msg_id uuid; v_out_id uuid;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv.id is null then raise exception 'conversación inexistente'; end if;
  if p_author = 'ai' and v_conv.mode = 'human' then
    raise exception 'conversación en modo humano';
  end if;
  select coalesce(wa_jid, phone) into v_to from contacts where id = v_conv.contact_id;

  insert into messages (conversation_id, author, body, sent_by)
    values (p_conversation_id, p_author, p_body, p_sent_by) returning id into v_msg_id;
  insert into outbound_messages (conversation_id, channel_id, to_phone, body, priority, message_id)
    values (p_conversation_id, v_conv.channel_id, v_to, p_body,
            case when p_author = 'human' then 0 else 10 end, v_msg_id)
    returning id into v_out_id;
  insert into audit_log (conversation_id, event, summary, details)
    values (p_conversation_id, p_audit_event, p_audit_summary, p_audit_details);
  update conversations set last_message_at = now() where id = p_conversation_id;
  return v_out_id;
end $$;

-- ───────── Respuesta de un dueño desde el panel ─────────
create or replace function human_reply(p_conversation_id uuid, p_body text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_mode conv_mode; v_out uuid;
begin
  if coalesce(trim(p_body), '') = '' then raise exception 'mensaje vacío'; end if;
  select mode into v_mode from conversations where id = p_conversation_id for update;
  v_out := enqueue_reply(p_conversation_id, p_body, 'human', p_user,
    'sent_human', 'Respuesta enviada desde el panel', jsonb_build_object('by', p_user));
  update conversations set mode = 'human', needs_attention = false, attention_reason = null
    where id = p_conversation_id;
  if v_mode = 'ai' then
    insert into audit_log (conversation_id, event, summary, details) values (
      p_conversation_id, 'mode_changed', 'Pasa a modo humano: respondió una persona desde el panel',
      jsonb_build_object('to', 'human', 'by', p_user));
  end if;
  return v_out;
end $$;

-- ───────── Interruptor IA/humano ─────────
create or replace function set_conversation_mode(p_conversation_id uuid, p_mode conv_mode, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old conv_mode;
begin
  select mode into v_old from conversations where id = p_conversation_id for update;
  if v_old is null then raise exception 'conversación inexistente'; end if;
  if v_old = p_mode then return; end if;
  update conversations set mode = p_mode,
    needs_attention = case when p_mode = 'ai' then false else needs_attention end,
    attention_reason = case when p_mode = 'ai' then null else attention_reason end
  where id = p_conversation_id;
  insert into audit_log (conversation_id, event, summary, details) values (
    p_conversation_id, 'mode_changed',
    case when p_mode = 'human' then 'Un dueño tomó el chat (modo humano)' else 'Un dueño devolvió el chat al bot (modo IA)' end,
    jsonb_build_object('to', p_mode, 'by', p_user));
end $$;

-- ───────── Resultado de un envío: lo llama el worker ─────────
create or replace function mark_outbound_result(
  p_outbound_id uuid, p_ok boolean, p_wa_message_id text, p_error text, p_max_attempts int default 3
) returns void language plpgsql security definer set search_path = public as $$
declare v_out outbound_messages;
begin
  select * into v_out from outbound_messages where id = p_outbound_id for update;
  if v_out.id is null then return; end if;
  if p_ok then
    update outbound_messages set status = 'sent', sent_at = now(), error = null where id = p_outbound_id;
    update messages set wa_message_id = p_wa_message_id where id = v_out.message_id;
  elsif v_out.attempts >= p_max_attempts then
    update outbound_messages set status = 'failed', error = left(p_error, 300) where id = p_outbound_id;
    update conversations set needs_attention = true, attention_reason = 'No se pudo enviar un mensaje'
      where id = v_out.conversation_id;
    insert into audit_log (conversation_id, event, summary, details) values (
      v_out.conversation_id, 'send_failed', 'No se pudo enviar el mensaje por WhatsApp',
      jsonb_build_object('outbound_id', p_outbound_id, 'attempts', v_out.attempts, 'error', left(p_error, 300)));
  else
    update outbound_messages set status = 'pending', error = left(p_error, 300) where id = p_outbound_id;
  end if;
end $$;

-- Al arrancar, el worker no sabe si lo que quedó "enviando" salió o no.
-- No se reintenta (podría duplicarse en el teléfono del cliente): se marca para revisar a mano.
create or replace function fail_interrupted_outbound(p_channel_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int; r record;
begin
  v_count := 0;
  for r in update outbound_messages set status = 'failed', error = 'interrumpido: revisar en el teléfono si salió'
    where channel_id = p_channel_id and status = 'sending' returning id, conversation_id
  loop
    v_count := v_count + 1;
    update conversations set needs_attention = true, attention_reason = 'Un envío quedó interrumpido'
      where id = r.conversation_id;
    insert into audit_log (conversation_id, event, summary, details) values (
      r.conversation_id, 'send_failed', 'Envío interrumpido por un reinicio del worker: revisar si salió',
      jsonb_build_object('outbound_id', r.id));
  end loop;
  return v_count;
end $$;

revoke execute on function ingest_inbound, human_reply, set_conversation_mode, mark_outbound_result,
  fail_interrupted_outbound, enqueue_reply from public, anon, authenticated;
