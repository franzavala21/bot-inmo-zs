# Estado del proyecto

**Fase actual:** 1 (Propiedades): código listo, falta conectar las cuentas y validar con datos reales de Tokko.

## Hecho
- Fase 0: monorepo (pnpm), `CLAUDE.md`, `docs/especificacion.md` (F-01 a F-17), `.env.example`, `.gitignore`.
- Esquema completo en `supabase/migrations/0001_schema.sql` (todas las fases), con RLS, la vista `properties_public` y las funciones atómicas `enqueue_reply`, `claim_outbound`, `bump_rate` y `add_usage`.
- `packages/core`: cliente de Tokko, mapper, sync, búsqueda con sinónimos y 7 tests pasando.
- `apps/web`: login por enlace al email, middleware con lista de emails, `/propiedades` con buscador, botón para sincronizar y cron `/api/cron/tokko-sync` cada 30 minutos.

## Pendiente (Fase 1)
- [ ] El usuario crea el proyecto en Supabase, aplica la migración y carga `allowed_users` y `.env`.
- [ ] Correr `pnpm --filter @inmo/core tokko:probe` y ajustar el mapper con los campos y tags reales (mascotas, ocupada, expensas).
- [ ] Decidir cómo se marca en Tokko una propiedad ocupada (hoy se detecta con tags que contengan "ocupad", "inquilin" o "con renta").
- [ ] Deploy en Vercel y verificación de la Fase 1.

## Próximo (Fase 2)
- `apps/wa-worker` (Baileys en Railway), `/api/inbound` con HMAC, bandeja en tiempo real y el interruptor IA/humano.
