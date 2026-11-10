-- API oficial de WhatsApp (Meta Cloud API). La web recibe el webhook y envía; el worker de Railway queda para Baileys.
-- Funciones atómicas: cada cambio y su línea de audit_log van en la misma transacción.

-- Qué número de Meta corresponde a cada canal (lo manda el webhook en metadata.phone_number_id).
alter table channels add column if not exists meta_phone_number_id text unique;

-- Cuándo se tomó un envío: para detectar los que quedaron "enviando" si la función se cortó.
alter table outbound_messages add column if not exists claimed_at timestamptz;
create index if not exists outbound_wa_message on messages (wa_message_id);

-- ───────── Tomar el siguiente envío pendiente (ahora anota cuándo) ─────────
create or replace function claim_outbound(p_channel_id uuid)
returns setof outbound_messages language sql security definer set search_path = public as $$
  update outbound_messages set status = 'sending', attempts = attempts + 1, claimed_at = now()
  where id = (
    select id from outbound_messages
    where channel_id = p_channel_id and status = 'pending'
    order by priority, created_at
    for update skip locked limit 1
  )
  returning *;
$$;

-- Envíos que quedaron "enviando" hace más de p_seconds: no se sabe si salieron.
-- No se reintentan (podría duplicarse en el teléfono del cliente): se marcan para revisar a mano.
create or replace function fail_stale_sending(p_channel_id uuid, p_seconds int default 120)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record;
begin
  for r in update outbound_messages set status = 'failed', error = 'interrumpido: revisar en WhatsApp si salió'
    where channel_id = p_channel_id and status = 'sending'
      and coalesce(claimed_at, created_at) < now() - make_interval(secs => p_seconds)
    returning id, conversation_id
  loop
    v_count := v_count + 1;
    update conversations set needs_attention = true, attention_reason = 'Un envío quedó interrumpido'
      where id = r.conversation_id;
    insert into audit_log (conversation_id, event, summary, details) values (
      r.conversation_id, 'send_failed', 'Envío interrumpido: revisar si salió', jsonb_build_object('outbound_id', r.id));
  end loop;
  return v_count;
end $$;

-- ───────── Meta avisa que un mensaje ya enviado no se entregó ─────────
create or replace function mark_delivery_failed(p_wa_message_id text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare v_msg messages;
begin
  select * into v_msg from messages where wa_message_id = p_wa_message_id and author in ('ai', 'human') limit 1;
  if v_msg.id is null then return; end if;
  update outbound_messages set status = 'failed', error = left(p_error, 300) where message_id = v_msg.id;
  update conversations set needs_attention = true, attention_reason = 'WhatsApp no entregó un mensaje'
    where id = v_msg.conversation_id;
  insert into audit_log (conversation_id, event, summary, details) values (
    v_msg.conversation_id, 'send_failed', 'WhatsApp no entregó el mensaje',
    jsonb_build_object('message_id', v_msg.id, 'error', left(p_error, 300)));
end $$;

-- ───────── Un dueño reintenta un envío fallido desde el panel ─────────
create or replace function retry_outbound(p_outbound_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_out outbound_messages;
begin
  select * into v_out from outbound_messages where id = p_outbound_id for update;
  if v_out.id is null then raise exception 'envío inexistente'; end if;
  if v_out.status <> 'failed' then raise exception 'solo se reintenta un envío fallido'; end if;
  update outbound_messages set status = 'pending', attempts = 0, error = null, claimed_at = null where id = p_outbound_id;
  insert into audit_log (conversation_id, event, summary, details) values (
    v_out.conversation_id, 'send_retry', 'Un dueño reintentó un envío', jsonb_build_object('outbound_id', p_outbound_id, 'by', p_user));
end $$;

revoke execute on function claim_outbound, fail_stale_sending, mark_delivery_failed, retry_outbound
  from public, anon, authenticated;
