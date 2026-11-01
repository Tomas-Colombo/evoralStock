# Mapa de módulos

"Módulo" significa tres cosas distintas. Esta tabla las une. Fuente de verdad
de los permisos: `CATALOGO_PERMISOS` en `lib/types/administracion.ts` y el seed
de la tabla `modulo`. Si cambia el mapeo, se actualiza acá en el mismo commit.

| Ruta `app/(app)/` | Permiso que exige el layout (`ver`) | Dominio DAL `lib/dal/` |
| --- | --- | --- |
| `administracion` | `administracion` | `administracion` |
| `clientes` | `ventas` | `clientes` |
| `consignaciones` | `consignaciones` | `consignaciones` |
| `cuotas` | `ventas` | `cuotas` |
| `gastos` | `gastos` | `gastos` |
| `inventario` | `inventario` | `inventario` |
| `precios` | `precios` | `precios` |
| `proveedores` | `inventario` | (dentro de `inventario`) |
| `rendiciones` | `rendiciones` | `rendiciones` |
| `reportes` | `reportes` | `reportes` |
| `revendedoras` | `revendedoras` | `revendedoras` |
| `app/(revendedora)/mi-cuenta` | `revendedoras` (`ver_propio`) | `revendedoras` (portal) |
| `ventas` | `ventas` | `ventas` |
| — (sin ruta propia) | — | `reservas` |


Permisos existentes (9): administracion, consignaciones, gastos, inventario,
precios, rendiciones, reportes, revendedoras, ventas. **No existen** `clientes`, `cuotas` ni
`proveedores` como permiso.

Esto es deliberado: clientes y cuotas viven bajo el permiso de ventas;
proveedores bajo el de inventario.

Verificado contra los `layout.tsx` el 2026-10-06. La columna DAL sale del
listado de `lib/dal/`; el vínculo `proveedores` → `inventario` en DAL no está
verificado (revisar antes de afirmarlo).

## Provisión de nuevos clientes (Tenants)

Al ejecutar el script de provisión de tenants (`pnpm provision-tenant`), el comportamiento por defecto (sin pasar la opción `--modulos`) habilita **todo** el catálogo de módulos.
Es importante notar que **Revendedoras** es un módulo opcional y vendible por separado. Si un cliente no contrata este módulo, se debe aprovisionar pasando explícitamente la bandera `--modulos` con la lista exacta de módulos que sí contrató, excluyendo a `revendedoras` (por ejemplo: `--modulos ventas,inventario,administracion,precios`).


## Núcleo y paquetes opcionales

El sistema divide los módulos en **núcleo** (siempre habilitado, no apagable) y **paquetes opcionales** (contratables por separado):

### Núcleo (siempre activo)
Los 6 módulos base del sistema:
- `administracion`
- `inventario`
- `ventas`
- `precios`
- `gastos`
- `reportes`

### Paquetes opcionales
Cada paquete agrupa uno o más códigos de módulo de `tenant_modulo`:
- **`revendedoras`**: código `['revendedoras']`. Canal de venta externa, stock en poder, portal y liquidaciones.
- **`consignacionProveedor`**: códigos `['consignaciones', 'rendiciones']`. Ingreso de mercadería por consignación, tipo de proveedor consignatario, devoluciones a proveedor y rendiciones de ventas. Se habilitan y apagan siempre de a par (invariante en DB).

### Regla de capacidades en la UI
La UI y los Server Actions **nunca** chequean códigos de módulos sueltos directamente (`session.modulosHabilitados.includes(...)` está prohibido en `app/` y `components/`). Toda consulta funcional deriva de **capacidades**:

```ts
import { capacidades, modulosDePermisoVisibles } from '@/lib/modulos/capacidades'

const cap = capacidades(session.modulosHabilitados)
// cap.revendedoras: boolean
// cap.consignacionProveedor: boolean (true solo si están consignaciones Y rendiciones)
```

Los puntos de extensión del núcleo (selectores de tipo en ingresos y proveedores, KPIs y tablas en la ficha de proveedor, filas y bloques en reportes, opciones del editor de roles) preguntan siempre por la capacidad correspondiente.
