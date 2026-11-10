# CLAUDE.md: manual de operaciones del proyecto

Bot de WhatsApp + CRM para la inmobiliaria. Los dos usuarios son los dueños (el usuario y su hermano), ambos con rol de dueño.

## Qué manda si hay contradicciones
1. `docs/especificacion.md`
2. Este archivo
3. `estado.md`

Al arrancar cada sesión: leer `estado.md`. Al cerrar: actualizarlo (fase, avance, pendientes).

## Arquitectura
- `apps/web`: Next.js en Vercel. Contiene el panel CRM, el webhook de Meta `/api/whatsapp/meta` (firmado con el App Secret; recibe y, para canales `transport = 'meta'`, también envía), `/api/inbound` (del worker, HMAC) y los cron (sync de Tokko y canario).
- `apps/wa-worker`: Baileys en Railway, **solo para canales `transport = 'baileys'`** (hoy ninguno: el chip fue bloqueado el 2026-11-09). Solo transporte. Si el canal es de Meta, el worker no hace nada.
- `packages/core`: pipeline, agentes, controles, búsqueda, puntaje, matcher y cliente de Tokko.
- `supabase/migrations`: esquema. Todo cambio de base va en una migración nueva; nunca se edita una ya aplicada.
- Canales: `channels` (ventas ahora, alquileres después). Todo lleva `channel_id`.

## Reglas
- La IA va solo donde hay que interpretar o redactar. Si la respuesta correcta se puede verificar, va con código: el orquestador, el puntaje, el matcher, la búsqueda y el control numérico son código.
- Agentes con IA: clasificador, redactor, verificador, extractor y redactor de avisos. Cada uno tiene un contrato con objetivo, límites, formato (zod) y salida de emergencia.
- El pipeline lee propiedades **solo** de `properties_public` (lista blanca).
- Ante la duda, derivar a humano.
- Al diagnosticar, mostrar la línea de log que sostiene cada conclusión. Si no la hay, decir que es una hipótesis.
- Un archivo tiene un solo dueño mientras trabajan subagentes en paralelo.
- El revisor solo lee: nunca tiene permiso de escritura.

## PROHIBIDO (con motivo)
- Poner claves en el código, en el chat o en commits. **Motivo:** quien tenga la clave gasta nuestra plata o lee nuestros datos.
- Que el pipeline lea la tabla `properties` directo. **Motivo:** ahí está la dirección exacta y los datos internos. Al modelo no se le pide que calle un dato: se le niega la llave.
- Enviar un mensaje proactivo sin aprobación humana. **Motivo:** sale hacia un tercero, no se puede deshacer y con Baileys arriesga el número.
- Agregar un botón de "aprobar todo". **Motivo:** la gente aprieta sí sin leer y el freno desaparece.
- Que el bot confirme visitas, reservas, descuentos o precios negociados. **Motivo:** el bot informa y acerca; la persona compromete.
- Usar el número principal de la inmobiliaria con Baileys. **Motivo:** riesgo de bloqueo (ya bloquearon un chip). El número principal solo va por la API oficial.
- Mandar texto libre pasadas 24 h del último mensaje del cliente. **Motivo:** Meta lo rechaza y castiga la calidad del número; fuera de la ventana solo plantillas aprobadas.
- Enviar una respuesta sin escribir `audit_log` en la misma transacción. **Motivo:** lo que no queda anotado no se puede auditar.
- Guardar teléfonos o texto de clientes en los logs de la app. **Motivo:** privacidad; se loguea solo el id de conversación.
- Borrar volúmenes de Railway o datos de Supabase sin pedirlo explícitamente. **Motivo:** ahí está la sesión de WhatsApp y las fichas.
- Usar el modelo para calcular el puntaje. **Motivo:** con los mismos datos tiene que dar siempre lo mismo y poder explicarse línea por línea.
