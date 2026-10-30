# Pulsepad Crm

Crea un CRM inmobiliario y de productos high-ticket con arquitectura multi-cuenta (subcuentas y marca blanca), que incluya:

1. Selector de subcuentas en el encabezado con soporte para branding personalizado (logo, nombre y colores de marca por subcuenta).
2. Pipeline Kanban interactivo con etapas de calificación (P0 Nuevo Lead, P1 Contactado, P2 En Calificación, P3 Material/Video Enviado, P4 Perfilado con Monto/Plazo, P5 Cita Agendada, P6 Sesión/Seguimiento, P7 Ganado / No Califica), con filtros rápidos y vista de valor total.
3. Bandeja de entrada híbrida (Inbox estilo WhatsApp) con alternador para pausar o reactivar el bot de IA de forma manual, transcripción de mensajes y ficha lateral con el expediente del lead (presupuesto, enganche, plazos, etiquetas y notas del asesor).
4. Simulador interactivo / Playground para probar la conversación de WhatsApp en tiempo real, observando cómo la IA extrae datos y dispara cambios de etiquetas y de etapa.
5. Automatización bidireccional de etiquetas: las etiquetas asignadas mueven al lead en el pipeline y activan o desactivan al bot automáticamente.
6. Módulo de Citas y Agenda con resumen previo de la llamada para el asesor (datos clave del lead antes de hablar con él).
7. Precargado con datos de demostración para dos subcuentas: "Espacio FX" y "Preventa de Terrenos".

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://pulsepad-crm.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/05b83479-0513-4d83-bc68-76dc2ec1d116).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Aislamiento multi-cuenta

La migración `0008_tenant_whatsapp_hardening.sql` limita cada cuenta, sus leads,
mensajes, citas, flujos, materiales, uso de IA y archivos de Storage a sus miembros.
Las cuentas nuevas asignan como propietario al usuario autenticado que las crea.

### Propietario de las cuentas existentes

El negocio confirmó un único propietario para todas las cuentas que ya existían:
`723bdc1b-0db6-4118-9d97-c8a033df9b9f`. La migración lo registra como `owner` de
cada cuenta en el mismo paso en que activa las políticas, así que nadie pierde el
acceso. Antes de cambiar nada, la migración comprueba que ese usuario exista en
`auth.users` y que ningún `phone_number_id` esté repetido; si algo falla, se detiene
sin aplicar cambios.

Para confirmar el UUID antes de desplegar (solo lectura):

```sql
SELECT id, email FROM auth.users WHERE lower(email) = lower('tu-correo@empresa.com');
```

Después de desplegar, esta consulta debe devolver cero filas:

```sql
SELECT a.id FROM public.accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM public.account_memberships m
  WHERE m.account_id = a.id AND m.role = 'owner'
);
```

Una cuenta sin propietario no responde con el bot: los mensajes entrantes se guardan
con `ai_status = 'held'` para que un asesor los vea y los flujos de seguimiento no
envían nada. Para dar acceso a un asesor como miembro:

```sql
INSERT INTO public.account_memberships (account_id, user_id, role)
VALUES ('espacio-fx', 'UUID-DEL-ASESOR', 'member')
ON CONFLICT (account_id, user_id) DO NOTHING;
```

## WhatsApp entrante

El webhook guarda cada mensaje una sola vez (`wa_message_id` único) y responde 200 a
Meta en cuanto queda guardado; solo responde 500 si no pudo guardarlo. La IA se
ejecuta después: `claim_inbound_message` reserva un mensaje por lead a la vez, cuenta
los intentos (máximo 5) y no responde mensajes de más de 24 horas. Si la IA falla, el
mensaje queda en `error` y el cron `/api/public/flows-tick` lo reintenta. Una
respuesta se aplica una sola vez (`ai_applied_at`), aunque Meta reintente.

Un `phone_number_id` solo puede pertenecer a una cuenta y solo se guarda cuando Meta
lo confirma con el Access Token de esa cuenta.

## Bot con Claude

Cada subcuenta elige su modelo en Configuración → Modelo de IA. Los modelos de OpenAI
usan la pasarela de Lovable (`LOVABLE_API_KEY`). Los modelos de Claude
(`anthropic/claude-opus-5-5`, `anthropic/claude-sonnet-5-5`,
`anthropic/claude-haiku-5-5`) usan tu propia API key de Anthropic: guárdala como
secreto `ANTHROPIC_API_KEY` en Lovable Cloud. El bot pide a Claude una respuesta con el
mismo formato estructurado (respuesta, datos, intención, etiquetas, cita) y activa el
respaldo automático de Anthropic si el modelo declina un mensaje.

## Notas de voz e imágenes

Cuando el lead manda una nota de voz o una foto, el webhook la descarga de Meta con el
token del canal y la guarda como texto antes de que la lea la IA, así el bot, las
palabras clave de los flujos y el asesor la ven igual que un mensaje escrito:

- Notas de voz: se transcriben con la API de OpenAI (`gpt-4o-mini-transcribe`, unos
  US$0.003 por minuto). Guarda el secreto `OPENAI_API_KEY` en Lovable Cloud.
- Fotos: las describe Claude Haiku 5.5 (incluido el texto que se lea en ellas) con el
  mismo `ANTHROPIC_API_KEY` del bot. El texto que el lead escriba junto a la foto se
  conserva.
- Videos y documentos no se analizan: se anotan con su nombre y su texto.

Si falta la clave o el servicio falla, el mensaje se guarda igual ("nota de voz que no
se pudo transcribir") y el bot le pide al lead que lo escriba. Los modelos se pueden
cambiar con `WHATSAPP_TRANSCRIBE_MODEL` y `WHATSAPP_VISION_MODEL`.

El bot solo comparte enlaces de la biblioteca de materiales de la cuenta. Si no hay
material cargado, no envía enlaces.

## Pruebas

```sh
npm test          # pruebas unitarias (incluye webhook, cola de IA y credenciales)
npm run test:db   # RLS y permisos sobre un Postgres local desechable
```

`npm run test:db` usa las variables `PGHOST`, `PGPORT` y `PGUSER` de un Postgres
local donde se puedan crear bases y roles. Nunca lo apuntes a Lovable Cloud.
