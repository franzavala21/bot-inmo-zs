# Especificación funcional

## Problema
Las consultas de WhatsApp (muchas de noche, los fines de semana y por audio) quedan sin respuesta. Las preguntas se repiten (precio, expensas, mascotas, requisitos) y no hay forma de saber qué leads están calificados para atenderlos primero.

## Reglas que no se negocian
- No dar la dirección exacta de una propiedad ocupada.
- No negociar precios ni confirmar visitas o reservas por WhatsApp.
- Ningún mensaje proactivo sale sin la aprobación de una persona.
- No inventar datos: si no está en Tokko o en `info-negocio`, el bot no lo dice.
- No dar consejo legal ni financiero. No compartir datos de otros clientes.

## Funciones
| ID | Función | Fase |
|---|---|---|
| F-01 | Login al panel con Supabase Auth (solo emails permitidos) | 1 |
| F-02 | Sincronización de propiedades desde Tokko Broker (cron) | 1 |
| F-03 | Proyección publicable de propiedades (lista blanca) | 1 |
| F-04 | Buscador de propiedades con sinónimos | 1 |
| F-05 | Conexión WhatsApp por Baileys (worker), intercambiable por Meta | 2 |
| F-06 | Bandeja de conversaciones en tiempo real | 2 |
| F-07 | Interruptor IA/humano por chat y envío desde el panel | 2 |
| F-08 | Bot que responde con datos reales (clasificador, búsqueda, redactor) | 3 |
| F-09 | Transcripción de audios | 3 |
| F-10 | Control numérico + verificador + degradación a humano | 3 |
| F-11 | Bitácora de decisiones (`audit_log`) | 3 |
| F-12 | Ficha de lead con evidencia textual (extractor) | 4 |
| F-13 | Puntaje por reglas editables y lista "A quién llamar" | 4 |
| F-14 | Matcher de propiedades nuevas con interesados | 5 |
| F-15 | Borradores de avisos proactivos con aprobación de a uno | 5 |
| F-16 | Agenda interna de visitas | 5 |
| F-17 | Salud: healthcheck, canario, métricas, límites de uso y backups | 6 |

## Fases
- **Fase 0:** base del proyecto.
- **Fase 1:** propiedades (F-01 a F-04).
- **Fase 2:** WhatsApp de punta a punta (F-05 a F-07).
- **Fase 3:** bot inteligente (F-08 a F-11).
- **Fase 4:** CRM de leads (F-12 y F-13).
- **Fase 5:** matcher, avisos y agenda (F-14 a F-16).
- **Fase 6:** cuidado (F-17).

## Fuera de alcance por ahora
- Canal de ALQUILERES (el esquema ya lo soporta con `channels`).
- API oficial de Meta (queda el webhook armado).
- Sincronización con Google Calendar.
- Escribir leads de vuelta en Tokko.
- Roles distintos de dueño.
