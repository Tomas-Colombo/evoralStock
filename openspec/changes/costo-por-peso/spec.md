# Spec — costo-por-peso / inventario

**Change**: `costo-por-peso` · **Requisitos**: `REQ-CPP-01…05` · **Decisiones**: `DR-CPP-01…07`

## 1. Requisitos

### REQ-CPP-01 — Flag `lleva_peso` en categoría

`categoria.lleva_peso` (`boolean not null default false`) habilita la carga de peso y el cálculo por peso en los productos de esa categoría. MUST NOT borrar `producto.peso_gramos` al desmarcar `lleva_peso`; solo oculta los campos en la UI.

- **Feliz**: usuario con `inventario.crear` o `inventario.editar` marca "Lleva peso" al crear o editar una categoría (`CategoriaForm.tsx`, `CategoriasView.tsx`, `NuevaCategoriaModal.tsx`) y se persiste `lleva_peso = true`.
- **N1**: actor sin permiso `inventario.crear` / `inventario.editar` → rechazo con `no-permission`.
- **N2**: otro tenant → RLS impide ver o modificar categorías ajenas (0 filas).
- **N3**: módulo inventario apagado → `module-disabled`.
- **N4**: desmarcar `lleva_peso` en categoría con productos que tienen `peso_gramos` → los valores en `producto.peso_gramos` se conservan intactos.

### REQ-CPP-02 — Peso en gramos en producto (`producto.peso_gramos`)

`producto.peso_gramos` (`numeric nullable`, `check (peso_gramos > 0)`) es siempre opcional, incluso en categorías con `lleva_peso = true`. No es dinero: NO vive en tablas satélite.

- **Feliz**: alta o edición de producto con `peso_gramos` positivo (o `null`) persiste correctamente.
- **N1**: `peso_gramos <= 0` o por encima del tope razonable en Zod / DB → rechazo por validación o check constraint.
- **N2**: otro tenant → RLS impide acceso (0 filas).
- **N3**: módulo inventario apagado → `module-disabled`.
- **N4**: cambio de categoría a una con `lleva_peso = false` en alta → el formulario oculta el campo y no envía `peso_gramos`.

### REQ-CPP-03 — Calculadora de costo por peso en alta y edición de producto

Componente compartido en `components/inventario/` con toggle discreto "Calcular por peso" y dos inputs: peso (g) y costo por gramo. Completa el campo de costo existente en la misma moneda (el flujo USD/cotización actual no cambia). Si el usuario edita el costo a mano, manda el costo. El costo por gramo NO se guarda en ningún lado.

- **Feliz**: en categoría con `lleva_peso = true`, al activar el toggle e ingresar peso y costo por gramo, se completa el costo total (`peso × costo_por_gramo`) y al servidor llega solo el costo total (y `peso_gramos` si corresponde).
- **N1**: costo resultante o `peso_gramos` inválido → rechazo por validación Zod en el Server Action.
- **N2**: categoría con `lleva_peso = false` → el componente no se muestra.
- **N3**: edición manual del campo costo luego de calcular → prevalece el valor editado a mano.
- **N4**: N/A (cálculo puramente de UI antes del submit).

### REQ-CPP-04 — Calculadora de costo por peso en líneas de ingreso

En `NuevoIngresoView.tsx` e `IngresoDetalleView.tsx`, la calculadora aparece solo si la categoría del producto elegido tiene `lleva_peso = true`, con el peso precargado desde `producto.peso_gramos`. El peso tipeado en la línea es solo para calcular y NO se guarda en `producto`. `lleva_peso` y `peso_gramos` se traen en la misma consulta que carga los productos (sin N+1). `RemitoImportPanel` queda fuera de alcance.

- **Feliz**: al seleccionar un producto cuya categoría lleva peso, el toggle aparece con `peso_gramos` precargado; al calcular, actualiza el costo unitario de la línea.
- **N1**: valores negativos o cero → validación en UI / Server Action existente.
- **N2**: otro tenant → productos filtrados por RLS.
- **N3**: producto cuya categoría tiene `lleva_peso = false` → la calculadora no aparece en la línea.
- **N4**: modificar el peso en la línea de ingreso → no muta `producto.peso_gramos`.

### REQ-CPP-05 — `sp_create_producto` y validación Zod

`sp_create_producto` suma `p_peso_gramos numeric default null` y dropea la firma anterior para no dejar overload. Los schemas Zod en `lib/validation/**` usan `strictObject` con `peso_gramos` positivo y tope razonable, manteniendo los tres gates en cada Server Action.

- **Feliz**: `sp_create_producto` recibe `p_peso_gramos` opcional y lo inserta en `producto`.
- **N1**: `p_peso_gramos <= 0` → error de check constraint en `producto`.
- **N2**: otro tenant → `auth_tenant_id()` aísla el insert.
- **N3**: sin permiso `inventario.crear` → `no-permission`.
- **N4**: firma vieja dropeada → no existe ambigüedad de overload en Postgres.

## 2. Matriz de permisos

| Función | Operador con permiso | Operador sin permiso | Revendedora | Módulo apagado | Otro tenant |
| --- | --- | --- | --- | --- | --- |
| `sp_create_producto` | ok | `no-permission` | `no-permission` | `module-disabled` | aislado por `auth_tenant_id()` |

## 3. Cifras financieras

No aplica. Es solo una forma de cargar el costo en UI: al servidor siempre llega el costo total como hoy. Margen, reglas, sellado de precio (`fn_sellar_precio_inicial`) y control de precios no cambian.

## 4. INVOKER contra RLS restrictiva

`sp_create_producto` es `SECURITY INVOKER` y valida `auth_tiene_permiso('inventario', 'crear')`. Las escrituras en `categoria` y `producto` siguen siendo INVOKER protegidas por RLS de tenant y permiso.

## 5. Migraciones

- Número: el siguiente número libre al momento de crear la migración (`ls supabase/migrations`).
- `sp_create_producto` se actualiza partiendo de `pnpm sp:last sp_create_producto`, dropeando la firma previa `(uuid, text, text, integer, text, inet)` y otorgando `execute` a `authenticated`.
- Incluye bloque `-- DOWN:` ejecutable.

## 6. Ubicación del código

| Archivo | Quién lo consume | Por qué va ahí |
| --- | --- | --- |
| `components/inventario/CalculadoraCostoPorPeso.tsx` | `NuevoProductoForm`, `NuevoIngresoView`, `IngresoDetalleView` | Componente compartido dentro de `inventario` sin importar `app/`. |
| `app/(app)/inventario/CategoriaForm.tsx` | Módulo inventario | Edición/alta de categoría dentro de `app/(app)/inventario/`. |
| `app/(app)/inventario/categorias/CategoriasView.tsx` | Ruta categorías | Alta/edición inline en listado de categorías. |
| `app/(app)/inventario/ingresos/nuevo/NuevaCategoriaModal.tsx` | Modal alta rápida en ingreso | Check `lleva_peso` en modal de categoría. |
| `app/(app)/inventario/productos/nuevo/NuevoProductoForm.tsx` | Alta de producto | Campo `peso_gramos` + calculadora condicional. |
| `app/(app)/inventario/productos/[id]/EditarProductoForm.tsx` | Edición de producto | Campo `peso_gramos` condicional según categoría. |
| `app/(app)/inventario/ingresos/nuevo/NuevoIngresoView.tsx` | Alta de ingreso | Calculadora en línea de ingreso. |
| `app/(app)/inventario/ingresos/[id]/IngresoDetalleView.tsx` | Detalle de ingreso | Calculadora en línea de ingreso. |
| `lib/dal/inventario/categoria.ts` | Actions de categoría | `lleva_peso` en `createCategoria` / `updateCategoria`. |
| `lib/dal/inventario/producto.ts` | Actions de producto e ingresos | `peso_gramos` en `createProducto` / `updateProducto` y consultas de producto. |
| `lib/validation/**` | Server Actions | `lleva_peso` y `peso_gramos` en schemas `strictObject`. |
| `lib/ayuda/guia/inventario.ts` | Guía de ayuda | Documentar check de categoría y cálculo por peso. |
