# Propuesta — chat-ayuda

**Change**: `chat-ayuda` · **Spec**: `specs/REQ-AYUDA.md` · **Tareas**: `tasks.md`

## Problema

El operador no sabe dónde está cada cosa ("¿cómo cargo un gasto?", "¿dónde
veo las cuotas vencidas?"). Hoy la respuesta es preguntarle al
administrador. Queremos un panel de ayuda que responda con pasos y un link a
la pantalla correcta, sin que el modelo invente pantallas ni permisos.

## Decisión

Un módulo nuevo **`ayuda`** con un solo permiso, `ayuda.consultar`, y un panel
flotante montado en el shell de `app/(app)`. El modelo (Gemini, API de AI
Studio) responde **solo** a partir de una guía curada en TypeScript; nunca
con conocimiento propio y nunca devuelve rutas: devuelve un `entradaId` de
un enum armado por request, y el servidor resuelve la ruta desde la guía.

| Pieza | Dónde vive | Por qué ahí |
| --- | --- | --- |
| Guía tipada (contenido) | `lib/ayuda/guia/*.ts` | dominio puro, un archivo por área → agentes en paralelo sin pisarse |
| Filtro, contexto, resolver, schema de salida | `lib/ayuda/*.ts` | lógica pura, testeable, entra en coverage |
| Orquestación de un turno (`consultarAyuda`) | `lib/ayuda/consultar.ts` | recibe el modelo como puerto: no lee la DB ni conoce Gemini |
| Adaptador Gemini + config de env | `lib/ayuda/gemini.ts`, `lib/ayuda/config.ts` (`server-only`) | única puerta al proveedor; la clave nunca sale de ahí |
| Registro y calificación | `sp_registrar_consulta_ayuda`, `sp_calificar_consulta_ayuda` + `lib/dal/ayuda/` | escrituras por `sp_*`, como el resto |
| Server Actions | ver spec §6 | tres gates: guard → zod → DAL |
| Panel | `components/ayuda/` | presentacional; el contenedor lo monta el layout |

**Datos del tenant al modelo: ninguno.** El turno de consulta no lee la DB.
El modelo ve la guía filtrada por permisos, el historial del chat (≤6) y la
pregunta. Google no ofrece región de datos en esta API: por eso la regla es
dura y tiene test (REQ-AYUDA-09).

**Sin clave, no hay chat.** `GEMINI_API_KEY` es opcional; sin ella el panel
no se monta en ninguna pantalla y las actions devuelven `ayuda-no-disponible`.

## Lo que NO entra

- Historial persistente visible para el usuario (solo registro para análisis).
- Pantalla de métricas de ayuda (se puede leer `consulta_ayuda` a mano).
- Portal de revendedoras (`app/(revendedora)`): fuera de alcance de v1.
- Streaming de la respuesta.

## Abierto (decide la persona antes de aprobar)

- ~~DR-AYUDA-1~~ decidida: paquete opcional, lo maneja el super admin.
- ~~DR-AYUDA-7~~ decidida: sin tope por usuario en v1; techo = cuota diaria de Google Cloud.

## Fuentes de la fase 0

- SDK `@google/genai`: `latest` = 2.32.0 (`npm view`, 2026-11-03). La
  implementación anterior usó 2.10.0. Se fija la versión exacta en el Lote 0.
- Precios: `gemini-3-flash-preview` USD 0,50 / 1M tokens de entrada y
  USD 3,00 / 1M de salida (el pensamiento se cobra como salida), tier pago
  estándar, según <https://ai.google.dev/gemini-api/docs/pricing>.
  **Re-verificar en la página el día del deploy.**
- Hay Flash más nuevos (3.6, 3.7, 3.8). Ninguno se elige sin medir latencia
  con nuestra clave (Lote 0): el listado de modelos miente (2.5-* daban 404,
  3.5-flash-lite tardaba 14–24 s).
