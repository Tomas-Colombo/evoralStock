/**
 * Catálogo ÚNICO de mensajes de error para el operador.
 *
 * Antes de esto había catorce traductores ad-hoc repartidos por la app
 * (`explicar`, `traducir`, `traducirAlta`, `traducirReason`, `explicarArancel`,
 * `REASON_LABEL`…), cada uno cubriendo un pedazo. El mismo slug tenía
 * traducciones distintas según la pantalla, y todos terminaban en
 * `return reason`: cualquier slug no mapeado — o el texto crudo de un
 * constraint de Postgres — caía tal cual en un toast.
 *
 * Reglas de este archivo:
 *
 *  1. UN solo lugar. Si un mensaje no está acá, no existe.
 *  2. NADA de jerga. El que lee esto vende ropa, no escribe software: no hay
 *     "SKU", "tenant", "payload", "constraint" ni nombres de tabla.
 *  3. Cuando hay algo que hacer, el mensaje lo dice. Un "no se puede" sin
 *     salida deja al operador mirando la pantalla.
 *  4. `mensajeDeError` NUNCA devuelve el slug crudo. El peor caso es una frase
 *     genérica en español.
 *  5. Voseo y punto final, como el resto de la UI.
 */

/** Lo que el mensaje necesita saber del contexto para ser preciso. */
export interface ContextoMensaje {
  /**
   * Qué estaba intentando hacer el operador, en infinitivo y en minúscula
   * ("editar clientes", "cancelar ingresos"). Sólo lo usan los errores de
   * permiso, que son los únicos que cambian según la pantalla.
   */
  accion?: string
  /**
   * Datos del rechazo que algunos mensajes incorporan.
   *
   * Se declaran los campos que el catálogo realmente lee, y no un
   * `Record<string, unknown>`: así se ve desde acá qué puede llegar, y una
   * `interface` del llamador entra sin tener que darle una index signature que
   * no tiene (eso era lo que rechazaba `LookupFail`).
   */
  extra?: {
    /** Estado del ítem, para `item-no-disponible`. */
    estado?: unknown
    /** Reserva que tiene tomadas las unidades, para `sku-sin-stock-libre`. */
    id_reserva?: unknown
  }
}

/** Los estados del ítem en palabras, para no mostrar el valor del enum crudo. */
const ESTADO_EN_PALABRAS: Record<string, string> = {
  disponible: 'disponible',
  reservado: 'reservado',
  vendido: 'vendido',
  devuelto: 'devuelto al proveedor',
  devuelto_cliente: 'devuelto por el cliente',
  baja: 'dado de baja',
  en_revendedora: 'en manos de una revendedora',
}

/**
 * Mensajes por slug exacto. Agrupados por dominio para poder leerlos; el
 * objeto es plano a propósito, porque la búsqueda es por clave y anidarlo
 * sólo agregaría ceremonia.
 */
const MENSAJES: Record<string, string> = {
  // ─── Sesión y permisos ─────────────────────────────────────────────
  // `accion` los vuelve específicos; sin ella quedan en genérico.
  'no-permission': 'Tu rol no te permite hacer esto.',
  'module-disabled': 'Este módulo no está habilitado para tu negocio.',
  'modulo-nucleo': 'Este módulo es parte del núcleo del sistema y no se puede deshabilitar.',
  'modulo-paquete-incompleto':
    'Consignaciones y Rendiciones funcionan en conjunto y deben habilitarse o deshabilitarse al mismo tiempo.',
  'modulo-con-estado-vivo':
    'No podés deshabilitar este módulo porque tiene operaciones o mercadería pendientes. Cerrá o liquidá los registros activos antes de continuar.',
  'tenant-mismatch': 'Esos datos pertenecen a otro negocio.',
  'no-session': 'Se cerró tu sesión. Volvé a iniciar sesión.',
  'no-tenant': 'Tu sesión no está asociada a ningún negocio. Volvé a iniciar sesión.',
  'zona-horaria-invalida': 'La zona horaria elegida no es válida.',
  'qr-lado-mm-invalido': 'El tamaño del QR debe estar entre 15 y 100 mm.',
  'logo-invalido': 'Elegí una imagen para el logo.',
  'logo-muy-grande': 'La imagen del logo es demasiado pesada. Probá con una más simple o de menor resolución.',
  'logo-formato-invalido': 'El logo tiene que ser una imagen PNG, JPG, WebP o SVG.',
  'logo-no-subido': 'No pudimos subir el logo. Probá de nuevo en unos minutos.',

  // ─── Datos mal formados ────────────────────────────────────────────
  // Nunca deberían verse: la UI arma estos pedidos. Si aparecen, la página
  // quedó vieja o alguien mandó el pedido a mano.
  'payload-invalido': 'Los datos enviados no son válidos. Recargá la página y probá de nuevo.',
  'campo-desconocido': 'Los datos enviados no son válidos. Recargá la página y probá de nuevo.',
  'permisos-no-objeto': 'Los permisos enviados no son válidos. Recargá la página y probá de nuevo.',
  'permisos-no-array': 'Los permisos enviados no son válidos. Recargá la página y probá de nuevo.',
  'modulo-desconocido': 'Uno de los permisos no corresponde a ningún módulo. Recargá la página.',
  'modulo-revendedoras-deshabilitado': 'El módulo de revendedoras no está habilitado.',
  'email-duplicado': 'Ya existe una revendedora con este email.',
  'telefono-invalido': 'El teléfono no es válido o supera los 30 caracteres.',
  'revendedora-not-found': 'Esa revendedora ya no existe. Recargá la página.',
  'revendedora-con-stock': 'No podés dar de baja a una revendedora que tiene mercadería en su poder. Pedile que devuelva lo que le queda o declaralo como faltante.',
  'acceso-duplicado': 'Esta revendedora ya tiene un acceso configurado.',
  'error-invitacion': 'No se pudo crear el acceso.',
  'error-enlazar': 'No se pudo enlazar el usuario a la revendedora.',
  'sin-acceso': 'Esta revendedora no tiene acceso configurado.',
  'error-desvincular': 'No se pudo desvincular el acceso.',
  'error-desactivar': 'No se pudo desactivar el acceso.',
  'error-rol-no-encontrado': 'Rol Revendedora no encontrado para tu cuenta.',
  'accion-invalida':
    'Uno de los permisos no corresponde a ninguna acción de ese módulo. Recargá la página.',
  'acciones-duplicadas': 'Hay un permiso repetido. Recargá la página y probá de nuevo.',
  'id-rol-invalido': 'No se pudo identificar el rol. Recargá la página y probá de nuevo.',
  'id-venta-invalido': 'No se pudo identificar la venta. Recargá la página y probá de nuevo.',
  'id-detalle-invalido': 'No se pudo identificar la línea de la venta. Recargá la página y probá de nuevo.',
  'id-revendedora-invalido': 'No se pudo identificar la revendedora. Recargá la página y probá de nuevo.',
  'id-consignacion-invalido': 'No se pudo identificar la entrega. Recargá la página y probá de nuevo.',
  'id-liquidacion-invalido': 'No se pudo identificar la liquidación. Recargá la página y probá de nuevo.',
  'id-declaracion-invalido': 'No se pudo identificar la venta declarada. Recargá la página y probá de nuevo.',
  'id-cuenta-invalido': 'No se pudo identificar la cuenta. Elegí una cuenta de la lista.',
  'demasiados-items': 'Son demasiadas prendas para una sola operación: el máximo es 200.',
  'fecha-invalida': 'La fecha no es válida.',
  'fecha-desde-invalida': 'La fecha "desde" no es válida.',
  'fecha-hasta-invalida': 'La fecha "hasta" no es válida.',
  'metodo-largo': 'El medio de pago no puede pasar de 50 caracteres.',
  'referencia-larga': 'La referencia no puede pasar de 100 caracteres.',
  'error-desconocido': 'No pudimos completar la operación. Probá de nuevo en un momento.',

  // ─── Nombres y textos ──────────────────────────────────────────────
  'nombre-corto': 'El nombre necesita al menos 2 caracteres.',
  'nombre-largo': 'El nombre no puede pasar de 60 caracteres.',
  'nombre-invalido': 'El nombre no es válido: necesita al menos 2 caracteres.',
  'nombre-requerido': 'Escribí un nombre.',
  'apellido-invalido': 'El apellido no es válido: necesita al menos 2 caracteres.',
  'email-invalido': 'El email no es válido.',
  'password-corto': 'La contraseña necesita al menos 8 caracteres.',
  'password-actual-incorrecta': 'La contraseña actual no es correcta.',
  'passwords-no-coinciden': 'Las contraseñas nuevas no coinciden.',
  'password-actual-requerida': 'Ingresá tu contraseña actual.',
  'error-actualizar-password': 'No se pudo actualizar la contraseña. Probá de nuevo.',
  'motivo-requerido': 'Escribí el motivo.',
  'motivo-invalido': 'El motivo no es válido.',
  'motivo-largo': 'El motivo no puede pasar de 300 caracteres.',
  'descripcion-requerida': 'Escribí una descripción.',
  'observaciones-requeridas': 'Escribí las observaciones.',
  'observaciones-largas': 'Las observaciones no pueden superar los 1000 caracteres.',
  // `vacio`, `formato`, `muy-corto`, `muy-largo` y `reservado` NO van acá: son
  // de `validarSubdominio` (provisioning de tenants), tienen su propio mapa
  // exhaustivamente tipado en `lib/tenant/subdominio.ts` y nunca llegan a un
  // toast del operador. Además `vacio` es substring de `items-vacios` y
  // `proveedor-vacio`, así que traerlos acá sólo agregaba ambigüedad.

  // ─── Roles y usuarios ──────────────────────────────────────────────
  'rol-requerido': 'Elegí un rol.',
  'rol-en-uso': 'No se puede eliminar: hay usuarios con este rol asignado.',
  'rol-not-found': 'Ese rol ya no existe. Recargá la página.',
  'usuario-not-found': 'Ese usuario ya no existe. Recargá la página.',

  // ─── Inventario: ítems ─────────────────────────────────────────────
  'item-not-found': 'No se encontró ningún ítem con ese código.',
  // Lo ven dos pantallas: el carrito de venta y el detalle de consignación.
  // Antes cada una tenía su frase, y la de ventas sugería "cargá esa reserva",
  // que en consignaciones no es una opción. Esta sirve en las dos.
  'item-en-reserva': 'El ítem está en una reserva activa. Cancelá esa reserva primero.',
  'item-ya-reservado': 'El ítem ya está en una reserva activa.',
  'invalid-transition':
    'El ítem cambió de estado y esa operación ya no se puede hacer. Recargá la página.',
  'item-no-puede-darse-de-baja':
    'Ese ítem no se puede dar de baja en su estado actual. Solo se dan de baja los disponibles o los que devolvió un cliente.',
  'item-en-otra-reserva': 'El ítem pertenece a una reserva distinta de la que cargaste.',
  'item-no-es-consignacion': 'El ítem no es de consignación: se compró directamente.',
  'item-otro-proveedor': 'El ítem es de otro proveedor.',
  'item-ya-en-consignacion-pendiente': 'El ítem ya está apartado en otra consignación.',
  'items-vacios': 'Elegí al menos un ítem.',
  'ids-vacios': 'Elegí al menos un ítem.',
  'linea-sin-id-item': 'Una de las líneas quedó sin ítem. Recargá la página y probá de nuevo.',
  'linea-sin-nombre': 'Una de las líneas quedó sin nombre de producto.',
  'qr-vacio': 'Escaneá o escribí un código.',
  'item-ya-marcado': 'Esa pieza ya está marcada.',

  // ─── Inventario: productos, categorías, talles ─────────────────────
  'producto-not-found': 'Ese producto ya no existe. Recargá la página.',
  'falta-producto': 'Elegí un producto.',
  'falta-categoria': 'Elegí una categoría.',
  'categoria-not-found': 'Esa categoría ya no existe. Recargá la página.',
  'categoria-sin-talles': 'Esa categoría todavía no tiene talles cargados. Cargalos primero.',
  'talle-no-valido': 'Ese talle no corresponde a la categoría del producto.',
  'stock-sin-talle': 'Hay stock de ese producto, pero no en el talle que pediste.',
  'elegir-talle': 'Elegí un talle disponible.',
  'no-se-pudo-generar-sku': 'No se pudo generar el código del producto. Probá de nuevo.',
  'cantidad-invalida': 'La cantidad tiene que ser mayor a cero.',
  'excede-disponibles': 'Pediste más unidades de las que hay disponibles.',
  'demasiados-productos-en-un-batch':
    'Son demasiados productos para una sola carga. Dividila en tandas más chicas.',

  // ─── Inventario: ingresos ──────────────────────────────────────────
  'ingreso-not-found': 'Ese ingreso ya no existe. Recargá la página.',
  'ingreso-ya-cancelado': 'Este ingreso ya estaba cancelado.',
  'detalle-not-found': 'Esa línea del ingreso ya no existe. Recargá la página.',
  'no-es-pdf': 'El archivo tiene que ser un PDF.',
  'archivo-invalido': 'No se pudo leer el archivo. Revisá que no esté dañado.',
  'tipo-ingreso-invalido': 'Elegí un tipo de ingreso válido.',

  // ─── Proveedores ───────────────────────────────────────────────────
  'proveedor-invalido': 'El proveedor seleccionado no es válido.',
  'proveedor-requerido': 'Elegí un proveedor.',
  'proveedor-vacio': 'Elegí un proveedor.',
  'proveedor-con-items': 'No se puede cambiar el proveedor: ya hay ítems apartados.',
  'tipo-proveedor-invalido': 'Elegí un tipo de proveedor válido.',

  // ─── Ventas ────────────────────────────────────────────────────────
  'lineas-vacias': 'Agregá al menos un ítem al carrito.',
  'sin-lineas': 'Agregá al menos una línea.',
  'venta-not-found': 'Esa venta ya no existe. Recargá la página.',
  'venta-ya-rendida': 'No se puede anular: la venta ya se rindió al proveedor.',
  'venta-anulada': 'No podés hacer esto porque la venta está anulada.',
  'venta-con-incobrables': 'No se puede anular porque hay cuotas marcadas como incobrables.',
  'detalle-venta-not-found': 'Esa línea de la venta ya no existe. Recargá la página.',
  'detalle-ya-rendido': 'No se puede anular: esa línea ya se rindió al proveedor.',
  'item-no-esta-vendido': 'El ítem no pertenece a esta venta o no está vendido.',
  'detalle-ya-devuelto': 'Esa línea de la venta ya fue devuelta.',
  'detalle-ya-cambiado': 'Esa línea de la venta ya fue cambiada por otro producto.',
  'linea-ya-cambiada': 'Esta prenda ya fue cambiada en otra operación y no puede devolverse.',
  'cambio-venta-con-cuotas-abiertas': 'No se puede cambiar el producto porque la venta tiene cuotas sin pagar.',
  'item-no-en-poder-revendedora': 'Ese producto no está en poder de esa revendedora.',
  'diferencia-negativa-no-permitida': 'El nuevo producto no puede tener un precio menor al original.',
  'diferencia-requiere-medio-y-cuenta': 'Para cobrar la diferencia tenés que elegir una cuenta y un medio de pago.',
  'devolucion-venta-con-cuotas-abiertas': 'No se puede devolver el ítem porque la venta tiene cuotas sin pagar.',
  'reintegro-requiere-cuenta-y-medio': 'Para reintegrar dinero tenés que elegir una cuenta y un medio de pago.',
  'sin-precio-lista':
    'El producto no tiene precio de venta. Fijalo en Precios, Control de precios.',
  'sku-sin-stock': 'Ese código no tiene unidades disponibles en stock.',
  'stock-parcial-disponible': 'Solo pudimos cargar las unidades que quedaban disponibles.',
  'venta-liquidada': 'Esta venta ya fue liquidada y no se puede anular.',
  'venta-revendedora-sin-id': 'Elegí la revendedora correspondiente para esta venta.',
  'canal-no-disponible': 'Ese canal de venta todavía no está disponible.',
  'devolucion-venta-revendedora':
    'Las devoluciones de ventas de revendedora no se gestionan como devolución directa de cliente.',
  'item-no-en-revendedora': 'Uno de los ítems no está en poder de esa revendedora.',
  'canal-invalido': 'El canal de venta elegido no es válido.',
  'revendedora-invalida': 'Elegí una revendedora válida.',
  'item-invalido': 'El ítem seleccionado no es válido.',
  'descuento-invalido': 'Uno de los descuentos aplicados no es válido.',
  'cuenta-invalida': 'La cuenta seleccionada no es válida.',
  'forma-pago-invalida': 'La forma de pago no es válida.',
  'cliente-invalido': 'El cliente seleccionado no es válido.',
  'reserva-invalida': 'La reserva asociada no es válida.',

  // ─── Ventas: cobro ─────────────────────────────────────────────────
  'monto-invalido': 'El monto tiene que ser mayor a cero.',
  'pago-monto-invalido': 'El monto del pago tiene que ser mayor a cero.',
  'pagos-no-cuadran': 'Los pagos no suman el total de la venta.',
  'pago-sin-cuenta': 'Elegí una cuenta destino para el pago.',
  'pago-credito-sin-cuotas': 'Elegí en cuántas cuotas se paga con tarjeta de crédito.',
  'pago-cuotas-medio-invalido': 'Ese medio de pago no admite cuotas.',
  'cuenta-destino-invalida': 'Esa cuenta destino ya no existe o está inactiva.',
  'medio-solo-revendedora':
    'El medio cuenta revendedora solo puede usarse en ventas por ese canal.',
  'venta-revendedora-con-pagos':
    'Las ventas por revendedora no admiten pagos manuales; se cancelan contra la cuenta de la revendedora.',
  'sin-cuenta-predeterminada':
    'No hay una cuenta destino predeterminada. Marcá una en Precios, Cuentas.',

  // ─── Ventas: financiación propia y cuotas ──────────────────────────
  'financiacion-sin-cliente': 'Para financiar en cuotas tenés que elegir un cliente.',
  'financiacion-sin-saldo': 'No queda saldo para financiar: el anticipo ya cubre el total.',
  'financiacion-sin-vencimiento': 'Elegí la fecha del primer vencimiento.',
  'financiacion-cuotas-invalidas': 'La cantidad de cuotas no es válida.',
  'cuota-not-found': 'Esa cuota ya no existe. Recargá la página.',
  'cuota-no-cobrable': 'Esta cuota ya no admite cobros.',
  'cuota-no-incobrable': 'Esta cuota ya está cerrada.',
  'monto-excede-saldo': 'El monto supera el saldo de la cuota.',

  // ─── Reservas ──────────────────────────────────────────────────────
  'reserva-not-found': 'Esa reserva ya no existe. Recargá la página.',
  'reserva-no-activa':
    'La reserva ya no está activa: fue cancelada, venció o se convirtió en venta.',
  'vencimiento-invalido': 'La fecha de vencimiento tiene que ser futura.',
  'item-no-disponible-para-reserva':
    'Uno de los ítems ya no está disponible para reservar. Sacalo de la reserva e intentá de nuevo.',

  // ─── Consignaciones ────────────────────────────────────────────────
  'consignacion-vacia': 'El lote no puede quedar vacío.',
  'consignacion-no-activa': 'La consignación ya está cerrada.',
  'consignacion-not-found': 'Esa consignación ya no existe. Recargá la página.',
  'revendedora-requerida': 'Elegí una revendedora.',
  'revendedora-inactiva': 'Esa revendedora está dada de baja. Reactivala o elegí otra.',
  'item-no-entregable': 'Uno de los ítems no está disponible para entregar a una revendedora.',
  'item-ya-en-consignacion-revendedora': 'El ítem ya está incluido en otra consignación activa de revendedora.',
  'consignacion-ya-confirmada': 'Esta consignación ya fue confirmada.',
  'consignacion-no-confirmada': 'Primero tenés que confirmar la entrega de la consignación.',
  'consignacion-confirmada': 'No podés eliminar una consignación ya confirmada. Registrá la devolución de los ítems.',
  'consignacion-con-items-en-poder': 'No podés cerrar la consignación mientras queden ítems en manos de la revendedora.',
  'detalle-no-pendiente':
    'Esa línea de la consignación ya se resolvió. Recargá la página para ver cómo quedó.',

  // ─── Rendiciones ───────────────────────────────────────────────────
  'rendicion-not-found': 'Esa rendición ya no existe. Recargá la página.',
  'sin-lineas-pendientes':
    'Este proveedor no tiene líneas pendientes de rendir en este momento.',

  // ─── Precios: reglas, aranceles, recargos ──────────────────────────
  // ─── Liquidaciones (Revendedoras) ──────────────────────────────────
  'liquidacion-vacia': 'No hay ventas pendientes de liquidar en el período seleccionado.',
  'liquidacion-ya-pagada': 'Esta liquidación ya fue marcada como pagada.',
  'cuenta-invalida-liquidacion': 'La cuenta seleccionada no pertenece al negocio o no está activa.',
  'monto-pago-invalido': 'El monto del pago debe coincidir exactamente con el total a cobrar de la liquidación.',
  'detalle-ya-liquidado': 'No se puede modificar una línea que ya forma parte de una liquidación.',
  'detalle-no-en-liquidacion': 'La línea seleccionada no pertenece a esta liquidación.',
  'liquidacion-no-encontrada': 'No se encontró la liquidación seleccionada.',
  'revendedora-invalida-liquidacion': 'La revendedora seleccionada no es válida o no pertenece al negocio.',
  'pago-revendedora-inmutable': 'Ese pago no se puede modificar ni anular porque ya quedó registrado.',

  // ─── Declaraciones de venta (Revendedoras) ─────────────────────────
  'item-no-en-poder': 'El artículo no está en tu poder.',
  'declaracion-duplicada': 'Este producto ya tiene una declaración de venta pendiente.',
  'declaracion-no-encontrada': 'Esa declaración de venta ya no existe. Recargá la página.',
  'declaracion-no-pendiente': 'Esta declaración de venta ya no está pendiente.',
  'no-revendedora': 'Esta acción sólo puede ser realizada por una revendedora.',

  'regla-not-found': 'Esa regla ya no existe. Recargá la página.',
  'regla-comision-not-found': 'Esa regla de comisión ya no existe. Recargá la página.',
  'regla-solapada': 'Ya existe una regla de comisión activa con fechas solapadas.',
  'regla-comision-solapada': 'Ya existe una regla de comisión activa con fechas solapadas para este caso.',
  'regla_comision_general_no_solapada': 'Ya existe una regla de comisión general activa con fechas solapadas.',
  'regla_comision_propia_no_solapada': 'Esta revendedora ya tiene una regla de comisión activa con fechas solapadas.',
  'escala-comision-invalida': 'Configurá al menos un tramo de comisión con porcentaje válido.',
  'sin-regla-comision': 'No hay una regla de comisión aplicable.',
  'porcentaje-fijo-invalido': 'El porcentaje fijo tiene que estar entre 0 y 100.',
  'porcentaje-invalido': 'El porcentaje tiene que estar entre 0 y 100.',
  'dias-invalidos': 'Los días de acreditación no pueden ser negativos.',
  'cuotas-invalidas': 'La cantidad de cuotas tiene que estar entre 2 y 24.',
  'cuotas-medio-invalido': 'El plan de cuotas sólo aplica a tarjeta de crédito.',
  // Ojo: `valor-invalido` cubre porcentaje Y monto fijo. El mensaje viejo decía
  // "entre 0 y 100", que es falso para un recargo de monto fijo: no tiene tope.
  'valor-invalido':
    'El recargo no es válido: no puede ser negativo, y en porcentaje no puede pasar de 100.',
  'propia-con-procesador':
    'El crédito del local no pasa por ninguna cuenta: dejá la cuenta y el medio vacíos.',
  'recargo-duplicado':
    'Ya hay un recargo vigente para ese plan y ese financiador. Dalo de baja primero.',

  // ─── Gastos ────────────────────────────────────────────────────────
  'gasto-inexistente': 'Ese gasto ya no existe. Recargá la página.',

  // ─── Finanzas ──────────────────────────────────────────────────────
  'periodo-invalido': 'El período pedido no es válido.',
  'orden-invalido': 'El criterio de orden no es válido.',

  // ─── Asistente de ayuda ────────────────────────────────────────────
  'ayuda-no-disponible': 'El asistente de ayuda no está disponible en este momento.',
  'ayuda-error': 'No pudimos consultar al asistente de ayuda. Probá de nuevo en unos minutos.',
  'consulta-no-encontrada': 'No se encontró la consulta de ayuda.',

  // ─── Plataforma (Super Admin) ──────────────────────────────────────
  'concepto-invalido': 'Escribí un concepto para el movimiento.',
  'medio-pago-invalido': 'Elegí un medio de pago válido.',
  'movimiento-inexistente': 'El movimiento no existe o ya no está disponible.',
  'movimiento-ya-anulado': 'Este movimiento ya se encuentra anulado.',
  'tipo-movimiento-invalido': 'El tipo de movimiento no es válido.',
  'tenant-inexistente': 'El comercio no existe o no fue encontrado.',
  'paquete-invalido': 'El paquete de módulos no es válido.',
  'subdominio-invalido': 'El subdominio no es válido: usá solo minúsculas, números y guiones.',
  'subdominio-en-uso': 'Ese subdominio ya está siendo utilizado por otro comercio.',
  'email-en-uso': 'Ya existe un usuario registrado con ese email.',
  'usuario-invalido': 'El usuario administrador especificado no es válido.',
  'estado-invalido': 'El estado indicado no es válido.',
}

/**
 * Slugs que vienen con un sufijo pegado: el SP agrega el dato que explica el
 * rechazo (`item-no-disponible: vendido`, `quedan-pendientes: 3`). Se matchean
 * por prefijo y el mensaje se arma con lo que haya.
 *
 * Son funciones y no strings porque el dato es parte de la frase: decir "no se
 * puede cancelar" sin contar CUÁNTOS ítems se movieron obliga al operador a
 * adivinar.
 */
const PREFIJOS: ReadonlyArray<{
  slug: string
  mensaje: (reason: string, ctx?: ContextoMensaje) => string
}> = [
  {
    slug: 'item-no-disponible',
    mensaje: (_reason, ctx) => {
      const estado = typeof ctx?.extra?.estado === 'string' ? ctx.extra.estado : null
      return estado
        ? `El ítem no está disponible: está ${ESTADO_EN_PALABRAS[estado] ?? estado}.`
        : 'El ítem no está disponible.'
    },
  },
  {
    slug: 'quedan-pendientes',
    mensaje: (reason) => {
      const n = reason.match(/(\d+)/)?.[1]
      return n
        ? `No se puede cerrar: quedan ${n} ítem(s) sin devolver ni cancelar.`
        : 'No se puede cerrar: quedan ítems sin devolver ni cancelar.'
    },
  },
  {
    // El trigger de 00051 lo levanta con el detalle pegado
    // (`ingreso-confirmado: el detalle ... es inmutable`).
    slug: 'ingreso-confirmado',
    mensaje: () => 'El ingreso ya fue confirmado y no se puede modificar. Recargá la página.',
  },
  {
    slug: 'ingreso-con-items-movidos',
    mensaje: (reason) => {
      const n = reason.match(/(\d+)/)?.[1]
      return `No se puede cancelar: ${n ?? 'algunos'} ítem(s) ya se movieron (vendidos, reservados o apartados). Revertí esas operaciones primero.`
    },
  },
  {
    // `precio-no-resoluble: producto <id> (sin-precio-lista)`: la causa viene
    // entre paréntesis y ya tiene su propio mensaje, que le dice al operador
    // qué arreglar. Sin esto, agregar el slug exterior taparía esa frase con
    // una más vaga.
    slug: 'precio-no-resoluble',
    mensaje: (reason) => {
      const causa = reason.match(/\(([a-z0-9-]+)\)/)?.[1]
      if (causa && Object.hasOwn(MENSAJES, causa)) return MENSAJES[causa]
      return 'No se pudo calcular el precio de uno de los productos. Revisá que tenga precio en Control de precios.'
    },
  },
  {
    slug: 'sku-sin-stock-libre',
    mensaje: (_reason, ctx) =>
      ctx?.extra?.id_reserva
        ? 'Las unidades que quedan están tomadas por otra reserva. Desvinculá la reserva actual o cobrá esa reserva aparte.'
        : 'No quedan unidades libres: están reservadas o ya las cargaste.',
  },
]

/**
 * Constraints de Postgres que llegan dentro del mensaje de error del SP.
 * Sin esto el operador lee `duplicate key value violates unique constraint
 * "producto_tenant_sku_uk"`, que no es un mensaje: es un volcado.
 */
const CONSTRAINTS: Record<string, string> = {
  producto_tenant_nombre_uk: 'Ya existe un producto con ese nombre.',
  producto_tenant_sku_uk: 'Ya existe un producto con ese código.',
  categoria_tenant_nombre_uk: 'Ya existe una categoría con ese nombre.',
  categoria_gasto_tenant_nombre_uk: 'Ya existe una categoría de gasto con ese nombre.',
  proveedor_tenant_nombre_uk: 'Ya existe un proveedor con ese nombre.',
  cliente_tenant_email_uk: 'Ya hay otro cliente con ese email.',
  cuenta_destino_nombre_uk: 'Ya existe una cuenta con ese nombre.',
  cuenta_destino_predeterminada_uk: 'Ya hay otra cuenta marcada como predeterminada.',
  arancel_cobro_vigente_uk:
    'Ya hay un arancel vigente para ese medio y plan. Dalo de baja antes de cargar el nuevo.',
  recargo_cuotas_vigente_uk:
    'Ya hay un recargo vigente para ese plan y ese financiador. Dalo de baja primero.',
  recargo_cuotas_pct_razonable: 'Un recargo en porcentaje no puede pasar de 100.',
  recargo_cuotas_propia_sin_procesador:
    'El crédito del local no pasa por ninguna cuenta: dejá la cuenta y el medio vacíos.',
  ingreso_detalle_costo_no_nan: 'Hay un costo unitario inválido en el remito.',
  costo_producto_vigente_uk:
    'Ya hay un costo vigente para ese producto. Cerrá el anterior primero.',
  comprobante_numero_uk: 'Ya existe un comprobante con ese número.',
  item_producto_qr_uk: 'Ese código QR ya está en uso por otro ítem.',
  cuota_venta_numero_uk: 'Esa cuota ya existe para esta venta.',
  detalle_reserva_item_activa_uk: 'Ese ítem ya está en una reserva activa.',
  consignacion_detalle_item_pendiente_uk: 'Ese ítem ya está apartado en otra consignación.',
  consignacion_revendedora_detalle_item_activo_uk: 'Ese ítem ya está incluido en otra consignación activa de revendedora.',
  declaracion_venta_revendedora_item_pendiente_uk: 'Ese ítem ya tiene una declaración pendiente.',
  'No se puede eliminar el rol Revendedora': 'No podés eliminar el rol Revendedora.',
  'No se puede renombrar el rol Revendedora': 'No podés cambiarle el nombre al rol Revendedora.',
  'Un usuario con rol Revendedora debe estar enlazado a una revendedora':
    'Un usuario con rol Revendedora debe estar enlazado a una revendedora.',
  'La revendedora enlazada debe tener un usuario con rol Revendedora':
    'La revendedora enlazada debe tener un usuario con rol Revendedora.',
  consignacion_revendedora_periodo_valido: 'La fecha hasta no puede ser anterior a la fecha desde.',
  regla_comision_vigencia_valida: 'La vigencia hasta no puede ser anterior a la vigencia desde.',
  venta_canal_revendedora_exige_id: 'Una venta por canal revendedora exige indicar la revendedora.',
  pago_venta_cuenta_destino_check: 'Este medio de pago exige indicar una cuenta de destino.',
  liquidacion_revendedora_periodo_check: 'El período hasta no puede ser anterior al período desde.',
  pago_revendedora_monto_check: 'El monto del pago debe ser mayor a cero.',
  cambio_venta_diferencia_check: 'La diferencia de cambio no puede ser negativa.',
}

/**
 * Último recurso. No se devuelve el slug: un operador que lee
 * `financiacion-sin-saldo` no aprende nada, y el que lee
 * `sp_registrar_venta: ...` menos.
 */
const GENERICO =
  'No se pudo completar la operación. Probá de nuevo; si sigue fallando, avisá a soporte.'

export { GENERICO as MENSAJE_GENERICO }

/**
 * Todos los matchers en una sola lista, ordenada por largo de slug
 * DESCENDENTE. Ese orden es lo único que hace seguro buscar por prefijo o por
 * contenido: `sku-sin-stock-libre` tiene que ganarle a `sku-sin-stock`, y
 * `pago-monto-invalido` a `monto-invalido`. Recorriendo en orden de inserción
 * ganaba el slug más corto y el operador leía el mensaje equivocado.
 */
const MATCHERS: ReadonlyArray<{
  slug: string
  resolver: (reason: string, ctx?: ContextoMensaje) => string
}> = [
  ...Object.entries(MENSAJES).map(([slug, texto]) => ({ slug, resolver: () => texto })),
  ...PREFIJOS.map((p) => ({ slug: p.slug, resolver: p.mensaje })),
].sort((a, b) => b.slug.length - a.slug.length)

/**
 * Traduce un `reason` de Server Action al mensaje que ve el operador.
 *
 * Orden de resolución: slug exacto, prefijo, slug contenido en un error de SP,
 * constraint de Postgres, genérico. Dentro de cada paso gana el slug más
 * largo, que es el más específico. El slug crudo NUNCA sale de acá.
 *
 * El `reason` sin traducir se pierde para el operador a propósito, pero no para
 * quien depura: queda en la consola del navegador fuera de producción.
 */
export function mensajeDeError(reason: string, ctx?: ContextoMensaje): string {
  if (!reason) return GENERICO

  // Los errores de permiso son los únicos que cambian según la pantalla, así
  // que el catálogo guarda la versión genérica y `accion` la especifica.
  if (reason === 'no-permission' && ctx?.accion) {
    return `Tu rol no te permite ${ctx.accion}.`
  }

  // `Object.hasOwn` y no `MENSAJES[reason]` a secas: con `reason` igual a
  // `__proto__` o `constructor` el acceso directo devuelve algo del prototipo
  // de Object, que es truthy y no es un string. El `reason` viene de nuestras
  // propias actions, pero el tipo diría `string` y estaría mintiendo.
  if (Object.hasOwn(MENSAJES, reason)) return MENSAJES[reason]

  // `item-no-disponible: vendido` y compañía: el slug viene con el dato pegado.
  for (const m of MATCHERS) {
    if (reason.startsWith(m.slug)) return m.resolver(reason, ctx)
  }

  // Y el slug puede venir envuelto en el error del SP, como
  // `sp_anular_venta: venta-ya-rendida`.
  for (const m of MATCHERS) {
    if (reason.includes(m.slug)) return m.resolver(reason, ctx)
  }

  for (const [constraint, mensaje] of Object.entries(CONSTRAINTS)) {
    if (reason.includes(constraint)) return mensaje
  }

  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[mensajeDeError] sin traducción para: ${reason}`)
  }
  return GENERICO
}

/** Para los tests y para auditar cobertura. No se usa en la UI. */
export const SLUGS_CON_MENSAJE: readonly string[] = [
  ...Object.keys(MENSAJES),
  ...PREFIJOS.map((p) => p.slug),
]
