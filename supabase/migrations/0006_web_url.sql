-- Link de cada propiedad en la web de la inmobiliaria (sale del sitemap en cada sincronización con Tokko).
-- El bot lo prefiere al link de la ficha de Tokko, que a veces no abre.
alter table properties add column if not exists web_url text;

-- Lista blanca: se agrega web_url al final (create or replace view solo permite sumar columnas al final).
create or replace view properties_public with (security_invoker = true) as
select
  id, tokko_id, reference_code, operation, property_type, title, description,
  price, currency, expenses, zone,
  case when is_occupied then null else address end as address,
  rooms, bedrooms, bathrooms, surface_total, surface_covered, pets_allowed,
  amenities, photo_url, public_url, search_text, web_url
from properties
where status = 'active';
