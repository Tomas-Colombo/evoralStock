# Spec — <cambio> / <área>

> Plantilla. Todas las secciones son obligatorias; si una no aplica, escribir
> "No aplica" y por qué. Copiar a `openspec/changes/<cambio>/specs/<REQ-...>.md`.

**Change**: `<cambio>` · **Requisitos**: `REQ-<...>-01…NN` · **Decisiones**: `DR-<...>`

## 1. Requisitos

Cada requisito con su escenario feliz y sus casos **negativos numerados**. Cada
caso negativo es un test: el número del caso va en el nombre del test.

### REQ-<...>-01 — <título>

<Qué debe pasar, en una o dos oraciones. MUST / MUST NOT.>

- **Feliz**: <dado / cuando / entonces>.
- **N1**: <entrada inválida o actor sin permiso> → rechazo con slug `<slug-kebab>`.
- **N2**: <otro tenant> → no ve / no modifica nada (0 filas, sin error que filtre existencia).
- **N3**: <módulo apagado> → `module-disabled` o el slug del módulo.
- **N4**: <estado incompatible, doble ejecución, carrera> → <rechazo / idempotencia>.

## 2. Matriz de permisos

Una fila por cada función nueva o modificada (`sp_*`, `rf_*`, `rvp_*`). Cada
celda es un test.

| Función | Operador con permiso | Operador sin permiso | Revendedora | Módulo apagado | Otro tenant |
| --- | --- | --- | --- | --- | --- |
| `sp_<...>` | ok | `no-permission` | rechazo | `module-disabled` | rechazo / 0 filas |
| `rf_<...>` | filas propias | — (lo filtra la guarda) | 0 filas (RLS restrictiva) | 0 / vacío | 0 filas |
| `rvp_<...>` | — | — | solo lo suyo, columnas de la whitelist | vacío | 0 filas |

## 3. Cifras financieras

Para cada cifra que el cambio crea o modifica:

| Cifra | Fecha del evento que la imputa | Criterio | Fuente |
| --- | --- | --- | --- |
| `<columna>` | <fecha de la venta / de la liquidación / del pago / del cambio> | <devengado / percibido; qué suma y qué resta> | `<rf_* o vista>` |

Si cambia una cifra existente: escenario en `specs/golden.md` calculado a mano
**antes** de implementar, y aprobado por la persona.

## 4. INVOKER contra RLS restrictiva

Las funciones son INVOKER: corren con los permisos de quien llama, así que una
lectura que cruza una tabla con policy restrictiva de revendedora devuelve
menos filas para ella. Por cada función, decir cómo se resuelve:

- **Filtra por diseño**: la revendedora debe ver solo lo suyo y la RLS ya lo hace. Test de 0 filas ajenas.
- **Necesita un hecho puntual de una fila que no ve**: exponerlo con una función
  chica y acotada al estilo `rvp_item_en_mi_poder(id_item) returns boolean`
  (identidad solo de `auth_revendedora_id()`, devuelve un booleano, no la fila).
- **DEFINER**: solo `rvp_*` de lectura con whitelist de columnas (DR-13). Cualquier otra, PARAR y preguntar.

## 5. Migraciones

- Número: **el siguiente número libre** al momento de aplicar (`ls supabase/migrations | tail -1`).
  Nunca fijar un número en el spec: otro cambio puede tomarlo antes.
- Un `sp_*` existente se modifica partiendo de `pnpm sp:last <nombre>`.
- Cada migración lleva `-- DOWN:` ejecutable (prosa con `-- NOTE:`), verificado por `pnpm gate:db`.
- Nunca editar una migración que ya está en main: se corrige con una nueva.

## 6. Ubicación del código

Una fila por cada archivo nuevo o movido, salvo las migraciones. La dirección de
dependencias está en `AGENTS.md` y la hace cumplir `tests/arquitectura-imports.test.ts`.

| Archivo | Quién lo consume | Por qué va ahí |
| --- | --- | --- |
| `app/(app)/<modulo>/<Archivo>.tsx` | <rutas que lo importan> | Un solo módulo: el ancestro común dentro de `app/`. |
| `components/<area>/<Archivo>.tsx` | <dos módulos o más> | Compartido y sin importar nada de `app/`. |
| `lib/<dominio>/actions.ts` | <dos módulos o grupos de rutas> | Server Action compartida. |

Una Server Action vive en el módulo que la consume, no en el que se le parece
por afinidad ni en el que comparte su permiso.
