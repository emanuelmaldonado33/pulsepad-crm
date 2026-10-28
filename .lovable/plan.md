# Terminar el despliegue (en espera de que lleguen los cambios desde Git)

Estado: me detuve sin cambiar nada. Este proyecto no tiene las migraciones 0008 ni 0009, ni `.github/workflows/db-security.yml`. El último cambio es "Add project README" (24 oct 2026).

## Paso 0 (lo haces tú)
- Revisa Configuración del proyecto → Git y haz push de tus cambios de main a la rama sincronizada.
- Avísame cuando esté listo.

## Pasos que sigo después, en orden estricto y deteniéndome ante el primer error
1. Confirmo que existen la 0008 y la 0009 y te digo cuál es el último cambio que veo.
2. Respaldo: exporto la tabla de mensajes completa a un archivo CSV en Archivos y te confirmo que existe.
3. Aplico la 0008 y luego la 0009 sin modificarlas. Si alguna falla, te paso el error exacto y me detengo.
4. Verifico que todas las cuentas tengan un propietario (la consulta debe devolver 0 filas).
5. Te pido ANTHROPIC_API_KEY con el formulario seguro (no lo veo ni lo escribo en ningún lado).
6. Reviso que la tarea de cada minuto que llama a flows-tick exista y esté activa. No la creo sin tu confirmación.
7. Publico la app.
8. Pruebas a–d con el resultado y la evidencia de cada una. Te pido ayuda con la prueba b (un mensaje de WhatsApp real).

No toco archivos de src/ ni las migraciones.
