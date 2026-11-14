-- Consultas que entran a Tokko desde los portales (Zonaprop, Mercadolibre, web...), para verlas en el panel
-- y escribirles por WhatsApp con una plantilla aprobada, de a una y con aprobación de un dueño.

create type portal_lead_status as enum ('new', 'contacted', 'dismissed');

create table portal_leads (
  id uuid primary key default gen_random_uuid(),
  tokko_contact_id bigint unique not null,
  name text,
  phone text,                  -- normalizado a 549XXXXXXXXXX (como WhatsApp); null si no se pudo
  phone_raw text,
  email text,
  origin text,                 -- Zonaprop, Mercadolibre, Web, Contacto por Whatsapp...
  operation operation_kind,    -- de las etiquetas de Tokko (Venta / Alquiler)
  property_type text,
  zones text[] not null default '{}',
  tags text[] not null default '{}',
  tokko_status text,           -- estado del lead en Tokko (Sin Contactar, Pendiente contactar, Cerrado)
  tokko_created_at timestamptz not null,
  status portal_lead_status not null default 'new',
  contact_id uuid references contacts(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  synced_at timestamptz not null default now()
);
create index portal_leads_list on portal_leads (status, tokko_created_at desc);

alter table portal_leads enable row level security;
create policy owners_all on portal_leads for all to authenticated using (is_owner()) with check (is_owner());

-- ───────── Un dueño aprueba escribirle: crea (o usa) el contacto y el chat, encola la plantilla y lo anota ─────────
create or replace function contact_portal_lead(p_lead_id uuid, p_user uuid, p_channel_slug text, p_body text, p_template jsonb)
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
  return jsonb_build_object('conversation_id', v_conv, 'outbound_id', v_out);
end $$;

create or replace function dismiss_portal_lead(p_lead_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update portal_leads set status = 'dismissed', decided_by = p_user, decided_at = now() where id = p_lead_id and status = 'new';
  insert into audit_log (conversation_id, event, summary, details) values (null, 'portal_dismissed',
    'Un dueño descartó una consulta de portal', jsonb_build_object('portal_lead_id', p_lead_id, 'by', p_user));
end $$;

revoke execute on function contact_portal_lead, dismiss_portal_lead from public, anon, authenticated;
