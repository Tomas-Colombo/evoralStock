# Tareas — costo-unico

Strict TDD: el test va primero y se lo ve fallar. Cada `sp_*` se modifica
partiendo de `pnpm sp:last <nombre>`. Migración con el siguiente número libre y
bloque `-- DOWN:`.

## 0. Gate humano

- [ ] La persona aprueba `proposal.md` §5 (valuación a costo de reposición).
- [ ] La persona aprueba el escenario de `specs/golden.md` (tarea 1.2).

## 1. Verificación y golden

- [x] 1.1 Confirmar con `rg` que ni la reserva (`00048:83`) ni el paso a
      `en_revendedora` copian el costo a otra tabla. Si alguno lo copia,
      parar y avisar antes de sincronizar ese estado.
- [x] 1.2 Escenario golden a mano: compra de 5 unidades a $1.000, venta de 1,
      reestock de 5 a $1.300, venta de 1 vieja y 1 nueva. Capital y ganancia
      antes y después.

## 2. SQL (una migración)

- [x] 2.1 Tests en `tests/db/costo-unico.test.ts`:
      reestock actualiza vigente; sincroniza `disponible`/`reservado`/
      `en_revendedora` de `compra`; no toca vendidas, devueltas, bajas ni
      consignación; marca precio
      desactualizado; mismo costo = no-op sin auditoría; otro tenant 0 filas;
      `costos-distintos-mismo-producto`; consignación actualiza vigente sin
      sincronizar.
- [x] 2.2 `sp_aplicar_ultimo_costo` (INVOKER, sin grant a `authenticated`).
- [x] 2.3 `sp_confirmar_ingreso` llama a D1 por producto.
- [x] 2.4 `sp_importar_remito` rechaza costos distintos del mismo producto.
- [x] 2.5 `sp_crear_stock_directo`, `sp_set_costo_producto` y
      `sp_revaluar_costos_usd_vigentes` usan D1.

## 3. App

- [x] 3.1 Slug `costos-distintos-mismo-producto` en `lib/errores/mensajes.ts`
      y en el inventario de `mensajes.test.ts`.
- [x] 3.2 `rg setCostoProducto`: si no hay llamadores, borrar la action y la
      función del DAL.
- [x] 3.3 Corregir el comentario de `NuevoIngresoView.tsx` sobre el costo vigente.
- [x] 3.4 `lib/ayuda/guia/inventario.ts`: entrada sobre qué pasa con el costo y
      el precio al reestockear.

## 4. Cierre

- [ ] 4.1 `pnpm gate:db` y reportar `.gate/report.txt`.
