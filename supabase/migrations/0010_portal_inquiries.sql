-- Avisos de "Nueva consulta" de Tokko (llegan por email): traen la propiedad consultada y el mensaje,
-- que la API de Tokko no expone. Los manda un script de Google Apps Script desde la casilla de un dueño.
-- No se guarda el HTML ni la dirección de la propiedad: solo los campos de abajo.
create table portal_inquiries (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text unique not null,
  received_at timestamptz not null,
  name text,
  email text,
  phone text,                  -- normalizado 549XXXXXXXXXX
  tags text[] not null default '{}',
  message text,
  property_codes text[] not null default '{}',
  property_title text,         -- ej. "Casa en Colon | Salsipuedes" (sin calle)
  webcontact_id bigint,
  created_at timestamptz not null default now()
);
create index portal_inquiries_phone on portal_inquiries (phone);
create index portal_inquiries_email on portal_inquiries (lower(email));

alter table portal_inquiries enable row level security;
create policy owners_all on portal_inquiries for all to authenticated using (is_owner()) with check (is_owner());

-- contact_portal_lead ahora anota la propiedad consultada (si se sabe por el email de Tokko):
-- así, si el cliente responde "sí, sigo interesado", el bot sabe de qué ficha habla.
drop function if exists contact_portal_lead(uuid, uuid, text, text, jsonb);
create or replace function contact_portal_lead(p_lead_id uuid, p_user uuid, p_channel_slug text, p_body text, p_template jsonb,
  p_property_codes jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l portal_leads; v_channel uuid; v_contact uuid; v_opt boolean; v_conv uuid; v_msg uuid; v_out uuid;
begin
  select * into v_l from portal_leads where id = p_lead_id for update;
  if v_l.id is null or v_l.status <> 'new' then raise exception 'la consulta ya no está pendiente'; end if;
  if v_l.phone is null then raise exception 'la consulta no tiene un teléfono válido'; end if;
  select id into v_channel from channels where slug = p_channel_slug and active;
  if v_channel is null then raise exception 'canal inexistente'; end if;

  insert into contacts (phone, wa_jid, name) values (v_l.phone, v_l.phone || '@s.whatsapp.net', v_l.name)
    on conflict (phone) do update set name = coalesce(contacts.name, excluded.name)
    returning id, proactive_opt_out into v_contact, v_opt;
  if v_opt then raise exception 'el contacto pidió no recibir mensajes'; end if;
  insert into conversations (contact_id, channel_id) values (v_contact, v_channel) on conflict (contact_id, channel_id) do nothing;
  select id into v_conv from conversations where contact_id = v_contact and channel_id = v_channel;

  insert into messages (conversation_id, author, body, sent_by) values (v_conv, 'human', p_body, p_user) returning id into v_msg;
  insert into outbound_messages (conversation_id, channel_id, to_phone, body, priority, message_id, template)
    values (v_conv, v_channel, v_l.phone || '@s.whatsapp.net', p_body, 0, v_msg, p_template) returning id into v_out;
  update conversations set last_message_at = now() where id = v_conv;
  update portal_leads set status = 'contacted', contact_id = v_contact, conversation_id = v_conv, decided_by = p_user, decided_at = now()
    where id = p_lead_id;
  insert into audit_log (conversation_id, event, summary, details) values (v_conv, 'portal_contacted',
    'Un dueño aprobó escribirle por una consulta de ' || coalesce(v_l.origin, 'un portal'),
    jsonb_build_object('portal_lead_id', p_lead_id, 'tokko_contact_id', v_l.tokko_contact_id, 'by', p_user, 'outbound_id', v_out));
  if jsonb_array_length(coalesce(p_property_codes, '[]'::jsonb)) > 0 then
    insert into audit_log (conversation_id, event, summary, details) values (v_conv, 'sent',
      'Propiedad que consultó en el portal', jsonb_build_object('property_codes', p_property_codes, 'portal', true));
  end if;
  return jsonb_build_object('conversation_id', v_conv, 'outbound_id', v_out);
end $$;
revoke execute on function contact_portal_lead from public, anon, authenticated;
