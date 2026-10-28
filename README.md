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

Las cuentas que ya existían antes de la migración (incluidas las cuentas de
demostración) quedan sin propietario de forma intencional: no se asignan al primer
usuario que se registre. Después de aplicar la migración, un administrador debe
consultar el UUID del usuario autorizado en `auth.users` y registrar su membresía
propietaria. En el SQL Editor de Supabase, con el UUID real, ejecutar por cada
cuenta que deba conservarse:

```sql
INSERT INTO public.account_memberships (account_id, user_id, role)
VALUES ('espacio-fx', 'UUID-REAL-DEL-USUARIO', 'owner')
ON CONFLICT (account_id, user_id) DO NOTHING;
```

Repetir para `preventa-terrenos` u otras cuentas existentes. No habilitar el
acceso de una cuenta compartida a todos los usuarios autenticados.

Los propietarios pueden agregar usuarios como miembros desde el SQL Editor
mientras el producto no incluya una pantalla de invitaciones. La tabla
`account_memberships` exige que el usuario invitado exista en `auth.users`.
