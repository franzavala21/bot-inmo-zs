-- Reintentar un envío fallido con el mensaje rearmado (p. ej. la consulta de portal, ahora con la propiedad y su link).
-- Cambia texto y plantilla del envío y del mensaje del chat, lo vuelve a encolar y deja todo en audit_log, en una sola transacción.
create or replace function retry_outbound_rebuilt(
  p_outbound_id uuid, p_user uuid, p_body text, p_template jsonb, p_property_codes jsonb default '[]'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_out outbound_messages;
begin
  select * into v_out from outbound_messages where id = p_outbound_id for update;
  if v_out.id is null then raise exception 'envío inexistente'; end if;
  if v_out.status <> 'failed' then raise exception 'solo se reintenta un envío fallido'; end if;
  update outbound_messages set body = p_body, template = p_template, status = 'pending', attempts = 0, error = null, claimed_at = null
    where id = p_outbound_id;
  if v_out.message_id is not null then
    update messages set body = p_body where id = v_out.message_id;
  end if;
  insert into audit_log (conversation_id, event, summary, details) values (
    v_out.conversation_id, 'send_retry', 'Un dueño reintentó un envío (mensaje rearmado)',
    jsonb_build_object('outbound_id', p_outbound_id, 'by', p_user, 'template', p_template->>'name', 'previous_template', v_out.template->>'name'));
  if jsonb_array_length(coalesce(p_property_codes, '[]'::jsonb)) > 0 then
    insert into audit_log (conversation_id, event, summary, details) values (v_out.conversation_id, 'sent',
      'Propiedad que consultó en el portal', jsonb_build_object('property_codes', p_property_codes, 'portal', true));
  end if;
end $$;
revoke execute on function retry_outbound_rebuilt from public, anon, authenticated;
