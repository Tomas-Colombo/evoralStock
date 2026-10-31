-- Utopia demo tenants and fixtures for local development.
-- Kept in seeds/, outside config.toml's sql_paths, so `supabase db reset --linked`
-- never loads it into a cloud database. Load it locally with `pnpm db:seed:local`.

-- Slice 5 seed part 2: demo tenants + 1 rol each + all 7 modulos linked +
-- 1 configuracion each (design §14, REQ-MTD-11, spec 3.5). Idempotent.
insert into tenant (nombre_comercial, subdominio) values
  ('Utopía Demo', 'utopia-demo'),
  ('Boutique Alfa', 'boutique-alfa')
on conflict (subdominio) do nothing;

insert into rol (id_tenant, nombre, permisos)
select t.id_tenant, 'Administrador', '{
    "administracion": ["ver", "crear", "editar"],
    "inventario": ["ver", "crear", "editar", "eliminar"],
    "ventas": ["ver", "crear"]
  }'::jsonb
from tenant t
where t.subdominio in ('utopia-demo', 'boutique-alfa')
  and not exists (
    select 1 from rol r where r.id_tenant = t.id_tenant and r.nombre = 'Administrador'
  );

insert into tenant_modulo (id_tenant, id_modulo, habilitado)
select t.id_tenant, m.id_modulo, true
from tenant t
cross join modulo m
where t.subdominio in ('utopia-demo', 'boutique-alfa')
on conflict (id_tenant, id_modulo) do nothing;

insert into configuracion (id_tenant, seccion, clave, valor, tipo)
select t.id_tenant, 'perfil', 'theme', '"light"'::jsonb, 'string'
from tenant t
where t.subdominio in ('utopia-demo', 'boutique-alfa')
on conflict (id_tenant, seccion, clave) do nothing;

-- Etapa 3 seed: categorías base de indumentaria (Planificacion.txt Etapa 3 §62
-- "seed de categorías base + alta desde la app"). Idempotente por (id_tenant, lower(nombre)).
insert into categoria (id_tenant, nombre, descripcion)
select t.id_tenant, cat.nombre, cat.descripcion
from tenant t
cross join (values
    ('Remeras', 'Remeras y musculosas'),
    ('Camisas', 'Camisas manga corta y larga'),
    ('Pantalones', 'Jeans, chinos, joggers'),
    ('Shorts', 'Bermudas y shorts'),
    ('Vestidos', 'Vestidos casuales y de fiesta'),
    ('Camperas', 'Camperas y abrigos'),
    ('Buzos', 'Buzos y sweaters'),
    ('Calzado', 'Zapatillas, zapatos, botas'),
    ('Accesorios', 'Cinturones, gorras, medias'),
    ('Ropa Interior', 'Ropa interior y pijamas')
  ) as cat(nombre, descripcion)
where t.subdominio in ('utopia-demo', 'boutique-alfa')
  and not exists (
    select 1 from categoria c
     where c.id_tenant = t.id_tenant and lower(c.nombre) = lower(cat.nombre)
  );

-- Etapa 3 seed: 2 proveedores demo por tenant.
insert into proveedor (id_tenant, nombre, tipo, telefono, dias_rotacion)
select t.id_tenant, prov.nombre, prov.tipo::tipo_proveedor, prov.telefono, prov.dias_rotacion
from tenant t
cross join (values
    ('Textiles Central', 'mayorista', '+5491122334455', 30),
    ('Distribuidora Norte', 'consignatario', '+5491199887766', 45)
  ) as prov(nombre, tipo, telefono, dias_rotacion)
where t.subdominio in ('utopia-demo', 'boutique-alfa')
  and not exists (
    select 1 from proveedor p
     where p.id_tenant = t.id_tenant and lower(p.nombre) = lower(prov.nombre)
  );

-- Etapa 4 seed: reglas base de precios (Planificacion.txt §79-84).
--   - Un margen global 50% por defecto (producto = costo × 1.50).
--   - Recargo por cuotas: efectivo 0% (implícito, no se guarda),
--     2 cuotas +15%, 3 cuotas +25%.
-- Idempotente por (id_tenant, nombre).
insert into regla_precio (id_tenant, nombre, tipo_regla, tipo_valor, valor,
                          alcance, forma_pago, prioridad)
select t.id_tenant, r.nombre, r.tipo_regla::tipo_regla,
       r.tipo_valor::tipo_valor_regla, r.valor,
       r.alcance::alcance_regla,
       nullif(r.forma_pago, '')::forma_pago, r.prioridad
from tenant t
cross join (values
    ('Margen global default 50%', 'margen',  'porcentaje', 0.50, 'global', '',         0),
    ('Recargo 2 cuotas 15%',      'recargo', 'porcentaje', 0.15, 'global', 'cuotas_2', 0),
    ('Recargo 3 cuotas 25%',      'recargo', 'porcentaje', 0.25, 'global', 'cuotas_3', 0)
  ) as r(nombre, tipo_regla, tipo_valor, valor, alcance, forma_pago, prioridad)
where t.subdominio in ('utopia-demo', 'boutique-alfa')
  and not exists (
    select 1 from regla_precio rp
     where rp.id_tenant = t.id_tenant and rp.nombre = r.nombre
  );

-- Configuración de precios por tenant (sección `precios`).
insert into configuracion (id_tenant, seccion, clave, valor, tipo)
select t.id_tenant, 'precios', c.clave, c.valor::jsonb, c.tipo
from tenant t
cross join (values
    ('moneda_default', '"ARS"',   'string'),
    ('iva_incluido',   'true',    'boolean'),
    ('redondeo',       '"none"',  'string')  -- 'none' | 'unidad' | 'decena' | 'centena'
  ) as c(clave, valor, tipo)
where t.subdominio in ('utopia-demo', 'boutique-alfa')
on conflict (id_tenant, seccion, clave) do nothing;

-- Etapa 7 seed: categorías de gasto base (Ejecucion §L46 / §L117).
insert into categoria_gasto (id_tenant, nombre, descripcion, presupuesto_mensual)
select t.id_tenant, cg.nombre, cg.descripcion, cg.presupuesto
from tenant t
cross join (values
    ('Alquiler',       'Alquiler del local',                   null::numeric),
    ('Marketing',      'Publicidad digital y offline',         null::numeric),
    ('Publicidad',     'Vía pública y medios tradicionales',   null::numeric),
    ('Canjes',         'Canjes por publicidad o servicios',    null::numeric),
    ('Servicios',      'Luz, agua, internet',                  null::numeric),
    ('Sueldos',        'Personal empleado',                    null::numeric),
    ('Impuestos',      'Impuestos y contribuciones',           null::numeric),
    ('Otros',          'Sin categoría específica',             null::numeric)
  ) as cg(nombre, descripcion, presupuesto)
where t.subdominio in ('utopia-demo', 'boutique-alfa')
  and not exists (
    select 1 from categoria_gasto cga
     where cga.id_tenant = t.id_tenant and lower(cga.nombre) = lower(cg.nombre)
  );
