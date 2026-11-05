# Estudio: qué le falta a Utopía para otros rubros (joyería primero)

Relevado el 2026-11-05 sobre `main` (12fbc66). Reemplaza el estudio anterior,
que no quedó escrito. Es un diagnóstico, no un plan aprobado.

## Lo que ya sirve (no tocar)

| Capacidad | Evidencia | Por qué sirve en joyería |
| --- | --- | --- |
| Una fila por unidad física con QR único | `item_producto` (00015) | Pieza única = trazabilidad individual, gratis |
| Talles configurables por categoría | `categoria.talles` (00032) | Cubre medidas de anillo (el comentario de 00032 ya pone "Anillos [16,18,20]") |
| Revendedoras: consignación saliente, comisiones, liquidación, portal | 00076–00115 | Es el modelo de negocio de Glam Joyas |
| Cambios de venta | `cambio_venta` (00098–00101) | Ya resuelto |
| Módulos por tenant | `tenant_modulo` (00003, 00117) | Mecanismo para encender features de rubro |

## Brechas para joyería, por impacto

| # | Brecha | Estado | Costo | Nota |
| --- | --- | --- | --- | --- |
| 1 | Peso por pieza (`peso_gramos`) | Ausente | Medio | Va en `item_producto`, no en `producto`: cada pieza pesa distinto |
| 2 | Precio por peso / cotización del metal | Ausente | Alto | Precio = gramos × cotización + hechura. Nuevo tipo de `regla_precio` + tabla de cotizaciones |
| 3 | Multi-moneda (USD) | Cosmética | Alto, transversal | `costo_producto.moneda` es etiqueta inerte; `lib/utils/moneda.ts` fija ARS |
| 4 | Atributos de producto (material, ley 925/18k, quilates, piedra) | Ausente | Medio–alto | Hoy hay un solo eje (`talle`). Opción barata: `atributos jsonb` por producto con claves definidas por categoría |
| 5 | Fotos de producto | Ausente | Medio | Solo existe el bucket `tenant-logos` (00109). La revendedora vende por imagen |
| 6 | Órdenes de servicio (arreglos, grabados, encargos) | Ausente | Alto (módulo nuevo) | Solo existe `reserva` (00022), que retiene items existentes |
| 7 | Vocabulario de ropa en la UI y en la guía | Presente en todos lados | Bajo–medio | "prenda", "Talle:" en etiquetas, `mensajes.ts:14` "El que lee esto vende ropa", `categoria-match.ts` (campera/pantalón), `lib/ayuda/guia` |
| 8 | DNI de cliente/revendedora | Ausente | Bajo | Columna + validación |
| 9 | Certificados / gemas / número de serie | Ausente | Bajo–medio | Solo si el cliente lo pide |
| 10 | Catálogo público | Ausente | Medio | Lo pedía Glam; el portal `(revendedora)` es autenticado |

## Transversal a cualquier rubro

- **No existe el concepto de rubro.** Ni plantilla de categorías al dar de alta:
  `provision-tenant.mts` no siembra nada y el seed demo es de indumentaria
  (`seed_demo_tenants.sql:37-52`).
- **"Talle" está en ~198 archivos (74 migraciones).** Renombrar la etiqueta a
  algo configurable ("Talle" / "Medida" / "Variante") es barato si se hace solo
  en UI; generalizar a N ejes es un cambio de esquema grande. Recomendación:
  etiqueta configurable por tenant + `atributos jsonb`, no N ejes.
- **Cantidades enteras solamente** (`lib/inventario/limites.ts:49-53`) y una fila
  por unidad: bloquea rubros a granel (ferretería, telas, kg).
- **Sin lote ni vencimiento de producto**: los "vencimiento" del esquema son de
  cuotas y reservas. Bloquea cosmética/farmacia.
- **Locale es-AR/ARS fijo** (~197 lugares) y facturación sin AFIP/ARCA
  (`comprobante` es solo metadato, 00021).
- **Branding mezclado**: "EvoralStock", "| Utopía", claves `utopia-*`.

## Encaje por rubro

| Rubro | Encaje hoy | Bloqueante principal |
| --- | --- | --- |
| Calzado | Alto | Falta segundo eje (color) |
| Joyería | Medio | Peso + precio por cotización + USD + fotos |
| Accesorios / regalería | Alto | Solo vocabulario |
| Cosmética | Bajo | Lote y vencimiento |
| Ferretería / telas | Muy bajo | Cantidades decimales y stock a granel |

## Cambios que ya estaban identificados y siguen sin proposal

`multi-moneda`, `comprobantes-proveedor` (IVA/descuento en
`ingreso_mercaderia`) y `rls-por-usuario`. Ninguno tiene carpeta en
`openspec/changes/`; `finanzas-panel/proposal.md:72` excluye multi-moneda.

## Orden sugerido para joyería

1. Vocabulario neutro + etiqueta de variante configurable (barato, destraba la demo).
2. Fotos de producto.
3. `peso_gramos` en `item_producto` + `atributos jsonb`.
4. Multi-moneda (prerrequisito real del punto 5).
5. Regla de precio por peso × cotización.
6. Órdenes de servicio, solo si el cliente lo confirma.
