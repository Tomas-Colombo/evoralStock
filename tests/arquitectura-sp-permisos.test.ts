/**
 * Regla de arquitectura: autorización en base de datos para procedimientos almacenados sp_*.
 *
 * Cada procedimiento almacenado de mutación/escritura vivo en las migraciones de Supabase
 * debe verificar permisos mediante `auth_tiene_permiso(...)` en el motor de base de datos,
 * o bien estar expresamente inventariado en `SP_SIN_CHEQUEO` con su debida justificación.
 */

import { describe, expect, it } from 'vitest'
import {
  leerMigraciones,
  obtenerSpVivos,
  tieneChequeoPermiso,
  type ArchivoMigracion,
} from '../scripts/sp-parser.mts'

/**
 * Procedimientos almacenados sp_* que no requieren chequeo de `auth_tiene_permiso` en DB.
 * Cada entrada debe contar con un motivo documentado y no vacío.
 */
export const SP_SIN_CHEQUEO: Record<string, string> = {
  // Service-role, plataforma (6): ejecutan con cliente administrativo sin JWT de usuario
  sp_alta_tenant: 'Service-role / superadmin plataforma (sin JWT de usuario tenant)',
  sp_cambiar_estado_tenant: 'Service-role / superadmin plataforma (sin JWT de usuario tenant)',
  sp_toggle_tenant_modulo_admin: 'Service-role / superadmin plataforma (sin JWT de usuario tenant)',
  sp_registrar_cargo_tenant: 'Service-role / superadmin plataforma (sin JWT de usuario tenant)',
  sp_registrar_pago_tenant: 'Service-role / superadmin plataforma (sin JWT de usuario tenant)',
  sp_anular_movimiento_tenant: 'Service-role / superadmin plataforma (sin JWT de usuario tenant)',

  // Service-role, revendedoras (2): llamados durante provisionamiento/alta con service_role
  sp_enlazar_revendedora_usuario: 'Service-role en creación unificada de revendedora (SECURITY DEFINER)',
  sp_reactivar_acceso_revendedora: 'Service-role en reactivación de acceso revendedora',

  // Portal de revendedora (2): gobernados exclusivamente por claim auth_revendedora_id()
  sp_declarar_venta_revendedora: 'Portal de revendedora gobernado por claim auth_revendedora_id()',
  sp_retirar_declaracion: 'Portal de revendedora gobernado por claim auth_revendedora_id()',

  // Execute revocado (2): revocado el execute a authenticated en migraciones posteriores
  sp_crear_consignacion: 'Execute revocado a authenticated (00054/00056); reemplazado por sp_crear_consignacion_con_items',
  sp_toggle_tenant_modulo: 'Execute revocado a authenticated (00117); reemplazado por sp_toggle_tenant_modulo_admin',

  // Chequeo propio sobre auth.uid() (1): no requiere permiso de catálogo, solo identidad
  sp_change_password_user: 'Chequeo propio sobre auth.uid() (is distinct from)',

  // Helper llamado por sp con chequeo (1): función pura de cálculo de SKU
  sp_gen_sku: 'Helper interno de cálculo puro invocado por sp_create_producto y sp_importar_remito',

  // Solo lectura, acotada por RLS (10): funciones de solo lectura sin efectos colaterales
  sp_calcular_costo_cobro: 'Solo lectura / cálculo puro sin efectos colaterales',
  sp_calcular_precio_venta_snapshot: 'Solo lectura / cálculo puro acotado por RLS',
  sp_control_de_precios: 'Solo lectura acotada por RLS',
  sp_descuentos_disponibles_venta: 'Solo lectura acotada por RLS',
  sp_get_cotizacion_vigente: 'Solo lectura acotada por RLS',
  sp_inventario_resumen: 'Solo lectura acotada por RLS',
  sp_listar_productos: 'Solo lectura acotada por RLS',
  sp_precios_resumen: 'Solo lectura acotada por RLS',
  sp_session_context: 'Solo lectura de contexto de sesión',
  sp_stock_por_talle: 'Solo lectura acotada por RLS',
}

describe('Chequeo de permisos en procedimientos almacenados sp_* en migraciones', () => {
  const migraciones = leerMigraciones('supabase/migrations')
  const vivos = obtenerSpVivos(migraciones)

  it('todos los sp_* vivos tienen auth_tiene_permiso o están en SP_SIN_CHEQUEO', () => {
    const faltantesChequeo: string[] = []

    for (const [nombre, sp] of vivos.entries()) {
      const tieneChequeo = tieneChequeoPermiso(sp.cuerpo)
      if (!tieneChequeo && !(nombre in SP_SIN_CHEQUEO)) {
        faltantesChequeo.push(`${nombre} (${sp.archivo}:${sp.linea})`)
      }
    }

    expect(faltantesChequeo, 'Procedimientos sp_* vivos sin chequeo de permiso ni exención').toEqual([])
  })

  it('la lista SP_SIN_CHEQUEO no tiene entradas obsoletas, duplicadas ni con motivo vacío', () => {
    for (const [nombre, motivo] of Object.entries(SP_SIN_CHEQUEO)) {
      expect(motivo.trim().length, `El motivo de exención para ${nombre} no puede estar vacío`).toBeGreaterThan(0)
      expect(vivos.has(nombre), `Entrada en SP_SIN_CHEQUEO que ya no existe viva: ${nombre}`).toBe(true)

      const sp = vivos.get(nombre)!
      const tieneChequeo = tieneChequeoPermiso(sp.cuerpo)
      expect(
        tieneChequeo,
        `Entrada ${nombre} está en SP_SIN_CHEQUEO pero ya posee chequeo auth_tiene_permiso; debe removerse de la lista de exenciones`,
      ).toBe(false)
    }
  })
})

describe('Casos sintéticos de la función pura de sp vivos y chequeo de permisos', () => {
  it('sin chequeo → reportado como sin permiso', () => {
    const migraciones: ArchivoMigracion[] = [
      {
        archivo: 'supabase/migrations/00001_sintetico.sql',
        contenido: `
          create or replace function sp_test_sin_chequeo() returns void as $$
          begin
            insert into tabla values (1);
          end;
          $$ language plpgsql;
        `,
      },
    ]

    const vivos = obtenerSpVivos(migraciones)
    expect(vivos.has('sp_test_sin_chequeo')).toBe(true)
    const sp = vivos.get('sp_test_sin_chequeo')!
    expect(tieneChequeoPermiso(sp.cuerpo)).toBe(false)
  })

  it('auth_tiene_permiso solo en un comentario → reportado como sin permiso', () => {
    const migraciones: ArchivoMigracion[] = [
      {
        archivo: 'supabase/migrations/00001_sintetico.sql',
        contenido: `
          create or replace function sp_test_comentario() returns void as $$
          -- if not auth_tiene_permiso('ventas', 'crear') then raise exception 'no-permission'; end if;
          /* auth_tiene_permiso('ventas', 'editar') */
          begin
            null;
          end;
          $$ language plpgsql;
        `,
      },
    ]

    const vivos = obtenerSpVivos(migraciones)
    expect(vivos.has('sp_test_comentario')).toBe(true)
    const sp = vivos.get('sp_test_comentario')!
    expect(tieneChequeoPermiso(sp.cuerpo)).toBe(false)
  })

  it('versión vieja con chequeo y última sin chequeo → reportado como sin permiso', () => {
    const migraciones: ArchivoMigracion[] = [
      {
        archivo: 'supabase/migrations/00001_v1.sql',
        contenido: `
          create or replace function sp_test_regresion() returns void as $$
          begin
            if not auth_tiene_permiso('ventas', 'crear') then
              raise exception 'no-permission';
            end if;
          end;
          $$ language plpgsql;
        `,
      },
      {
        archivo: 'supabase/migrations/00002_v2.sql',
        contenido: `
          create or replace function sp_test_regresion() returns void as $$
          begin
            null;
          end;
          $$ language plpgsql;
        `,
      },
    ]

    const vivos = obtenerSpVivos(migraciones)
    expect(vivos.has('sp_test_regresion')).toBe(true)
    const sp = vivos.get('sp_test_regresion')!
    expect(sp.archivo).toBe('supabase/migrations/00002_v2.sql')
    expect(tieneChequeoPermiso(sp.cuerpo)).toBe(false)
  })

  it('dropeado → ignorado (no vivo)', () => {
    const migraciones: ArchivoMigracion[] = [
      {
        archivo: 'supabase/migrations/00001_v1.sql',
        contenido: `
          create or replace function sp_test_dropeado() returns void as $$
          begin
            null;
          end;
          $$ language plpgsql;
        `,
      },
      {
        archivo: 'supabase/migrations/00002_v2.sql',
        contenido: `
          drop function if exists sp_test_dropeado();
        `,
      },
    ]

    const vivos = obtenerSpVivos(migraciones)
    expect(vivos.has('sp_test_dropeado')).toBe(false)
  })
})
