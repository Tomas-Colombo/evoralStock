# Asistente de ayuda (Chat IA)

Guía operativa para despliegue, configuración y mantenimiento del módulo `ayuda`.

## Variables de entorno

- `GEMINI_API_KEY` (opcional, solo servidor): Clave de API de Google AI Studio. Sin esta variable el panel de ayuda no se renderiza en ninguna pantalla y las Server Actions retornan `ayuda-no-disponible`. Nunca se expone al cliente ni se registra en logs.
- `GEMINI_MODEL` (opcional, solo servidor, valor por defecto: `gemini-3-flash-preview`): Identificador del modelo de lenguaje. Al ser una versión preview, Google puede modificarla o darla de baja con poca anticipación; por esta razón se configura mediante variable de entorno y no fija en código.

> **Importante:** No incluir claves reales ni placeholders sensibles en archivos versionados.

## Configuración en Google Cloud

1. **Facturación activa**: La API requiere una cuenta de facturación vinculada al proyecto de Google Cloud / Google AI Studio.
2. **Cuota diaria obligatoria**: Configurar un límite diario de solicitudes o tokens en la consola de Google Cloud APIs.
3. **Alertas de presupuesto**: Los presupuestos configurados en Google Cloud **solo alertan** por correo cuando se superan umbrales; **no cortan el gasto**. El techo real de contención financiera es la cuota diaria del proyecto.
4. **Política de uso en v1**: No existe un límite diario por usuario (DR-AYUDA-7). El consumo total queda acotado exclusivamente por la cuota diaria global del proyecto.

## Tratamiento y privacidad de datos

- **Sin región fija de datos**: La API de Google AI Studio / Gemini no ofrece garantías de residencia regional; Google puede procesar y cachear los datos en centros de cómputo de cualquier país.
- **Aislamiento absoluto del tenant**: Bajo ninguna circunstancia se envían datos del tenant (clientes, ventas, montos ni stock) al modelo (REQ-AYUDA-09, garantizado por `lib/ayuda/imports.test.ts`).
- **Prompt seguro**: El modelo únicamente recibe la guía tipada curada de pantallas y pasos, el historial reciente de la conversación (hasta 6 mensajes) y la pregunta del operador.
- **Advertencia en UI**: El panel de ayuda informa expresamente al usuario: *"No escribas datos de clientes."*

## Costos y precios

Tarifas de referencia para `gemini-3-flash-preview` (tier pago estándar, vigentes al 2026-11-03 según <https://ai.google.dev/gemini-api/docs/pricing>):
- **Entrada**: USD 0,50 por millón de tokens.
- **Salida**: USD 3,00 por millón de tokens (el pensamiento o reasoning tokens se facturan como tokens de salida).

> **Aviso:** Re-verificar los precios en la documentación oficial de Google antes de cada deploy.

## Cómo cambiar de modelo

Antes de actualizar `GEMINI_MODEL`:
1. Medir latencia y disponibilidad real ejecutando:
   ```bash
   node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts <modelo-a-probar>
   ```
   Verificar que el tiempo p50 de respuesta sea menor a 3 segundos. El listado público de modelos de Google no garantiza que el endpoint `generateContent` esté habilitado o funcione con nuestra clave.
2. Definir la variable `GEMINI_MODEL=<modelo-elegido>` en el entorno de ejecución (ej. Vercel).

## Habilitación del paquete por tenant

- **Gestión por Super Admin**: `ayuda` es un paquete opcional (`PAQUETES_OPCIONALES.ayuda = ['ayuda']`). Lo activa o desactiva el super admin desde `/plataforma/[id]`. El administrador del tenant no tiene permisos para modificarlo (migración 00117).
- **Asignación de permisos**: El rol `Administrador` de cada tenant ya incluye el permiso `ayuda.consultar`. Para otros roles, se asigna manualmente desde el editor de roles en `/administracion`.

## Reglas de mantenimiento

- Si agregás o modificás una pantalla, un botón o un permiso en el sistema, actualizá el archivo de área correspondiente en `lib/ayuda/guia/`.
- El test automatizado `lib/ayuda/guia/cobertura.test.ts` valida que toda ruta de la guía exista en `app/(app)` y que ninguna página estática nueva quede sin cobertura explicada.
