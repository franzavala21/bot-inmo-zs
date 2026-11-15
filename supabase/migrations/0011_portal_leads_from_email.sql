-- Las consultas también se crean desde el email "Nueva consulta" de Tokko: así aparecen los clientes viejos que vuelven
-- a consultar (la API solo da contactos nuevos) y aparecen al minuto. Si después la sincronización de Tokko trae ese
-- contacto, se le pone el id a la consulta que creó el email (no se duplica).
alter table portal_leads alter column tokko_contact_id drop not null;
alter table portal_leads add column if not exists source text not null default 'tokko';   -- 'tokko' | 'email'
create index if not exists portal_leads_phone on portal_leads (phone);
create index if not exists portal_leads_email on portal_leads (lower(email));
