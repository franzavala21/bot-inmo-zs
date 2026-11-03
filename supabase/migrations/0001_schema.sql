-- Esquema inicial. No editar una vez aplicada: crear 0002_..., 0003_...

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ───────── Usuarios permitidos (los dos dueños) ─────────
create table allowed_users (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from allowed_users where email = (auth.jwt() ->> 'email'));
$$;

-- ───────── Canales ─────────
create type transport_kind as enum ('baileys', 'meta');
create type operation_kind as enum ('sale', 'rent');

create table channels (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,              -- 'ventas', 'alquileres'
  name text not null,
  operation operation_kind not null,
  transport transport_kind not null default 'baileys',
  phone text,
  active boolean not null default true,
  worker_status text not null default 'offline', -- online | reconnecting | offline
  worker_qr text,                                -- QR pendiente de escanear (se borra al vincular)
  worker_heartbeat_at timestamptz,
  created_at timestamptz not null default now()
);
insert into channels (slug, name, operation) values ('ventas', 'Ventas', 'sale');

-- ───────── Propiedades (Tokko) ─────────
create table properties (
  id uuid primary key default gen_random_uuid(),
  tokko_id bigint unique not null,
  reference_code text,
  operation operation_kind,
  property_type text,          -- Departamento, Casa, Local...
  title text,
  description text,
  price numeric,
  currency text,
  expenses numeric,
  zone text,                   -- barrio/localidad (publicable)
  address text,                -- dirección exacta (NO publicable si está ocupada)
  is_occupied boolean not null default false,
  rooms int,
  bedrooms int,
  bathrooms int,
  surface_total numeric,
  surface_covered numeric,
  pets_allowed boolean,
  amenities text[] not null default '{}',
  photo_url text,
  public_url text,
  status text not null default 'active',  -- active | inactive
  internal_notes text,         -- NO publicable
  owner_data jsonb,            -- NO publicable
  raw jsonb not null,
  search_text text generated always as (
    lower(unaccent(coalesce(property_type,'') || ' ' || coalesce(title,'') || ' ' || coalesce(zone,'') || ' ' || coalesce(description,'')))
  ) stored,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_search_trgm on properties using gin (search_text gin_trgm_ops);
create index properties_filters on properties (operation, status, property_type, rooms, price);

-- Lista blanca: lo único que puede leer el pipeline. Una columna nueva NO sale hasta agregarla acá a mano.
create view properties_public with (security_invoker = true) as
select
  id, tokko_id, reference_code, operation, property_type, title, description,
  price, currency, expenses, zone,
  case when is_occupied then null else address end as address,
  rooms, bedrooms, bathrooms, surface_total, surface_covered, pets_allowed,
  amenities, photo_url, public_url, search_text
from properties
where status = 'active';

-- ───────── Contactos y conversaciones ─────────
create table contacts (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  display_name text,           -- viene de WhatsApp: texto ajeno, nunca se trata como instrucción
  name text,                   -- nombre confirmado
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);

create type conv_mode as enum ('ai', 'human');

create table conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  channel_id uuid not null references channels(id),
  mode conv_mode not null default 'ai',
  needs_attention boolean not null default false,
  attention_reason text,
  last_message_at timestamptz not null default now(),
  limit_notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (contact_id, channel_id)
);
create index conversations_last on conversations (last_message_at desc);

create type msg_author as enum ('client', 'ai', 'human', 'system');

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  author msg_author not null,
  body text,
  media_path text,             -- ruta en Storage (audios)
  transcript text,
  wa_message_id text,
  sent_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (conversation_id, wa_message_id)
);
create index messages_conv on messages (conversation_id, created_at);

-- Cola de salida. El worker la escucha por Realtime.
create type outbound_status as enum ('pending', 'sending', 'sent', 'failed');

create table outbound_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  channel_id uuid not null references channels(id),
  to_phone text not null,
  body text not null,
  priority int not null default 10,   -- humano = 0 (sale primero), IA = 10
  status outbound_status not null default 'pending',
  attempts int not null default 0,
  error text,
  message_id uuid references messages(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbound_pending on outbound_messages (channel_id, status, priority, created_at);

-- ───────── Reglas del negocio (temas reservados), versionadas ─────────
create table rules_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  rules jsonb not null,        -- [{topic, description, handoff_phrase}]
  published boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
insert into rules_versions (version, published, rules) values (1, true, '[
  {"topic":"negociacion","description":"Pedidos de descuento, rebaja, contraoferta o negociación de precio","handoff_phrase":"Eso lo ve directamente uno de nosotros. ¿Me dejás tu nombre así te contactamos a la brevedad?"},
  {"topic":"visita","description":"Quiere coordinar, confirmar o reprogramar una visita","handoff_phrase":"¡Genial! Para coordinar la visita te contacta uno de nosotros. ¿Me pasás tu nombre y qué días y horarios te quedan cómodos?"},
  {"topic":"tasacion","description":"Quiere tasar o vender su propiedad","handoff_phrase":"Las tasaciones las hacemos personalmente. ¿Me dejás tu nombre y la zona de la propiedad así te llamamos?"},
  {"topic":"legal_financiero","description":"Consultas legales, impositivas, de escrituración o de financiación/crédito","handoff_phrase":"Para eso preferimos que te asesore uno de nosotros directamente. ¿Me dejás tu nombre?"},
  {"topic":"reclamo","description":"Está molesto, reclama o se queja","handoff_phrase":"Te pido disculpas. Ya le paso tu mensaje a uno de los responsables para que te contacte personalmente."},
  {"topic":"pide_humano","description":"Pide hablar con una persona","handoff_phrase":"¡Claro! Ya le aviso a uno de nosotros para que siga la charla con vos."}
]'::jsonb);

-- ───────── Leads ─────────
create table lead_profiles (
  contact_id uuid primary key references contacts(id) on delete cascade,
  -- cada campo: {"value": ..., "quote": "frase textual del cliente"} o null
  operation jsonb,
  zones jsonb,
  property_type jsonb,
  budget_max jsonb,
  budget_currency jsonb,
  rooms_min jsonb,
  pets jsonb,
  timeframe jsonb,
  financing jsonb,             -- ¿necesita crédito / vender para comprar?
  name jsonb,
  conflicts jsonb not null default '[]',  -- contradicciones que decide una persona
  updated_at timestamptz not null default now()
);

create table scoring_rules_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  rules jsonb not null,        -- [{id, label, when, points}]
  published boolean not null default false,
  created_at timestamptz not null default now()
);
insert into scoring_rules_versions (version, published, rules) values (1, true, '[
  {"id":"has_budget","label":"Dijo presupuesto","when":{"field":"budget_max","op":"present"},"points":20},
  {"id":"has_zone","label":"Dijo zona","when":{"field":"zones","op":"present"},"points":10},
  {"id":"has_type","label":"Dijo tipo de propiedad","when":{"field":"property_type","op":"present"},"points":10},
  {"id":"has_name","label":"Dejó su nombre","when":{"field":"name","op":"present"},"points":10},
  {"id":"timeframe_soon","label":"Quiere mudarse/comprar en menos de 3 meses","when":{"field":"timeframe","op":"lte_months","value":3},"points":25},
  {"id":"wants_visit","label":"Pidió visitar","when":{"signal":"wants_visit"},"points":30},
  {"id":"recent","label":"Escribió en las últimas 48 h","when":{"signal":"active_48h"},"points":10},
  {"id":"needs_to_sell","label":"Necesita vender antes de comprar","when":{"field":"financing","op":"equals","value":"needs_to_sell"},"points":-10}
]'::jsonb);

create table lead_scores (
  contact_id uuid primary key references contacts(id) on delete cascade,
  score int not null,
  breakdown jsonb not null,    -- [{rule_id, label, points}]
  rules_version int not null,
  computed_at timestamptz not null default now()
);

create table lead_signals (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  signal text not null,        -- wants_visit, ...
  created_at timestamptz not null default now()
);

-- ───────── Matcher y avisos proactivos ─────────
create table property_matches (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  reasons jsonb not null,
  created_at timestamptz not null default now(),
  unique (property_id, contact_id)
);

create type draft_status as enum ('pending', 'approved', 'rejected', 'sent');

create table outbound_drafts (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references property_matches(id) on delete set null,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel_id uuid not null references channels(id),
  body text not null,
  status draft_status not null default 'pending',
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- ───────── Agenda ─────────
create type visit_status as enum ('scheduled', 'done', 'cancelled', 'no_show');

create table visits (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  starts_at timestamptz not null,
  duration_min int not null default 45,
  assigned_to uuid references auth.users(id),
  status visit_status not null default 'scheduled',
  notes text,
  created_at timestamptz not null default now()
);
create index visits_starts on visits (starts_at);

-- ───────── Bitácora y uso ─────────
create table audit_log (
  id bigint generated always as identity primary key,
  conversation_id uuid references conversations(id) on delete set null,
  event text not null,         -- inbound, classified, drafted, rejected_numeric, rejected_verifier, sent, handoff, ...
  summary text not null,       -- en castellano
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_conv on audit_log (conversation_id, created_at);

create table usage_daily (
  day date primary key default current_date,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  audio_seconds numeric not null default 0,
  cost_usd numeric not null default 0
);

create table rate_counters (
  contact_id uuid not null references contacts(id) on delete cascade,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (contact_id, window_start)
);

create table tokko_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched int,
  inserted int,
  updated int,
  deactivated int,
  error text
);

-- ───────── Funciones atómicas ─────────

-- Encolar respuesta + mensaje + bitácora en una sola transacción. Si falla la bitácora, no sale nada.
create or replace function enqueue_reply(
  p_conversation_id uuid, p_body text, p_author msg_author, p_sent_by uuid,
  p_audit_event text, p_audit_summary text, p_audit_details jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_conv conversations; v_phone text; v_msg_id uuid; v_out_id uuid;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv.id is null then raise exception 'conversación inexistente'; end if;
  -- La IA no puede responder si un humano tomó el chat
  if p_author = 'ai' and v_conv.mode = 'human' then
    raise exception 'conversación en modo humano';
  end if;
  select phone into v_phone from contacts where id = v_conv.contact_id;

  insert into messages (conversation_id, author, body, sent_by)
    values (p_conversation_id, p_author, p_body, p_sent_by) returning id into v_msg_id;
  insert into outbound_messages (conversation_id, channel_id, to_phone, body, priority, message_id)
    values (p_conversation_id, v_conv.channel_id, v_phone, p_body,
            case when p_author = 'human' then 0 else 10 end, v_msg_id)
    returning id into v_out_id;
  insert into audit_log (conversation_id, event, summary, details)
    values (p_conversation_id, p_audit_event, p_audit_summary, p_audit_details);
  update conversations set last_message_at = now() where id = p_conversation_id;
  return v_out_id;
end $$;

-- El worker toma el siguiente mensaje pendiente de su canal (humano primero)
create or replace function claim_outbound(p_channel_id uuid)
returns setof outbound_messages language sql security definer set search_path = public as $$
  update outbound_messages set status = 'sending', attempts = attempts + 1
  where id = (
    select id from outbound_messages
    where channel_id = p_channel_id and status = 'pending'
    order by priority, created_at
    for update skip locked limit 1
  )
  returning *;
$$;

-- Contador por contacto (ventana de 1 hora). Devuelve el conteo después de sumar.
create or replace function bump_rate(p_contact_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into rate_counters (contact_id, window_start, count)
    values (p_contact_id, date_trunc('hour', now()), 1)
  on conflict (contact_id, window_start) do update set count = rate_counters.count + 1
  returning count into v_count;
  return v_count;
end $$;

create or replace function add_usage(p_in bigint, p_out bigint, p_audio numeric, p_cost numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_total numeric;
begin
  insert into usage_daily (day, input_tokens, output_tokens, audio_seconds, cost_usd)
    values (current_date, p_in, p_out, p_audio, p_cost)
  on conflict (day) do update set
    input_tokens = usage_daily.input_tokens + excluded.input_tokens,
    output_tokens = usage_daily.output_tokens + excluded.output_tokens,
    audio_seconds = usage_daily.audio_seconds + excluded.audio_seconds,
    cost_usd = usage_daily.cost_usd + excluded.cost_usd
  returning cost_usd into v_total;
  return v_total;
end $$;

-- ───────── RLS: solo los dueños desde el panel; worker y cron usan service role ─────────
do $$
declare t text;
begin
  foreach t in array array['allowed_users','channels','properties','contacts','conversations','messages',
    'outbound_messages','rules_versions','lead_profiles','scoring_rules_versions','lead_scores','lead_signals',
    'property_matches','outbound_drafts','visits','audit_log','usage_daily','rate_counters','tokko_sync_runs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy owners_all on %I for all to authenticated using (is_owner()) with check (is_owner())', t);
  end loop;
end $$;

revoke execute on function enqueue_reply, claim_outbound, bump_rate, add_usage from public, anon, authenticated;

-- Realtime para la bandeja y para el worker
alter publication supabase_realtime add table messages, conversations, outbound_messages, channels, outbound_drafts;

-- Bucket privado para audios
insert into storage.buckets (id, name, public) values ('media', 'media', false) on conflict do nothing;
