import type { EntradaGuia } from '../tipos'

export const GUIA_ADMINISTRACION: readonly EntradaGuia[] = [
  {
    id: 'administracion-resumen',
    titulo: 'Cómo consultar el panel de administración',
    ruta: '/administracion',
    permisos: ['administracion.ver'],
    pasos: [
      'Ingresá a Administración desde el menú principal de navegación.',
      'Revisá en la cabecera el acceso rápido a Usuarios, Roles y Auditoría.',
      'Verificá el logo comercial cargado y el tamaño configurado para etiquetas QR.',
      'Consultá la sección de últimas acciones auditadas con la fecha y el usuario responsable.',
    ],
  },
  {
    id: 'administracion-roles-listado',
    titulo: 'Cómo consultar los roles y permisos',
    ruta: '/administracion',
    permisos: ['administracion.ver'],
    pasos: [
      'Ingresá a Administración desde el menú principal.',
      'Hacé clic en la tarjeta de "Roles" para abrir la ventana modal.',
      'Revisá la lista de roles del negocio junto con los permisos otorgados por módulo.',
      'Hacé clic en "Cerrar" para salir del visor de roles.',
    ],
  },
  {
    id: 'administracion-roles-crear',
    titulo: 'Cómo crear un nuevo rol de usuario',
    ruta: '/administracion',
    permisos: ['administracion.ver', 'administracion.crear'],
    pasos: [
      'En Administración, hacé clic en la tarjeta de "Roles".',
      'Hacé clic en el botón "Nuevo rol".',
      'Ingresá el nombre descriptivo para el rol.',
      'Marcá las casillas de las acciones habilitadas (ver, crear, editar o eliminar) en cada módulo.',
      'Hacé clic en "Crear rol" para guardar el nuevo perfil de permisos.',
    ],
    detalles: [
      {
        tema: 'Módulos visibles',
        texto: 'El formulario solo muestra los módulos que el negocio tiene contratados y habilitados.',
      },
    ],
  },
  {
    id: 'administracion-roles-editar',
    titulo: 'Cómo modificar un rol existente',
    ruta: '/administracion',
    permisos: ['administracion.ver', 'administracion.editar'],
    pasos: [
      'En Administración, abrí la ventana de "Roles".',
      'Localizá el rol que deseás modificar y hacé clic en "Editar".',
      'Modificá el nombre del rol o cambiá las casillas de permisos por módulo.',
      'Hacé clic en "Guardar cambios" para aplicar los nuevos permisos a los usuarios asignados.',
    ],
  },
  {
    id: 'administracion-roles-eliminar',
    titulo: 'Cómo eliminar un rol de usuario',
    ruta: '/administracion',
    permisos: ['administracion.ver', 'administracion.eliminar'],
    pasos: [
      'En Administración, hacé clic en la tarjeta de "Roles".',
      'Buscá el rol en la lista y hacé clic en "Eliminar".',
      'En el diálogo de confirmación, hacé clic en "Sí, eliminar" para confirmar la baja definitiva.',
    ],
    detalles: [
      {
        tema: 'Usuarios asignados',
        texto: 'No se puede eliminar un rol si todavía hay algún usuario que lo tiene asignado.',
      },
    ],
  },
  {
    id: 'administracion-logo-actualizar',
    titulo: 'Cómo configurar o cambiar el logo del negocio',
    ruta: '/administracion',
    permisos: ['administracion.ver', 'administracion.editar'],
    pasos: [
      'En Administración, desplazate hasta la tarjeta "Logo comercial".',
      'Hacé clic en "Elegir imagen" o en la miniatura para seleccionar un archivo PNG o WebP.',
      'Previsualizá la adaptación del logo en la tarjeta.',
      'Hacé clic en "Guardar cambios" para aplicar el nuevo logo a la barra lateral del sistema.',
    ],
  },
  {
    id: 'administracion-logo-quitar',
    titulo: 'Cómo quitar el logo comercial del negocio',
    ruta: '/administracion',
    permisos: ['administracion.ver', 'administracion.editar'],
    pasos: [
      'En Administración, localizá la tarjeta "Logo comercial".',
      'En la parte inferior de la tarjeta, hacé clic en "Quitar logo".',
      'El sistema removerá la imagen y mostrará el nombre comercial del negocio en texto.',
    ],
  },
  {
    id: 'administracion-qr-configurar',
    titulo: 'Cómo configurar el tamaño de etiquetas QR',
    ruta: '/administracion',
    permisos: ['administracion.ver', 'administracion.editar'],
    pasos: [
      'En Administración, localizá la sección "Etiquetas QR de inventario".',
      'Ingresá la medida en milímetros para el lado del código QR (entre 15 y 45 mm).',
      'Hacé clic en "Guardar tamaño" para asentar la nueva medida.',
      'La dimensión configurada se aplicará automáticamente al imprimir etiquetas de inventario.',
    ],
  },
  {
    id: 'administracion-password-cambiar',
    titulo: 'Cómo cambiar tu contraseña de acceso personal',
    ruta: '/administracion',
    permisos: ['administracion.ver'],
    pasos: [
      'En Administración, desplazate hasta el bloque "Seguridad de la cuenta".',
      'Ingresá tu contraseña actual en el primer campo.',
      'Escribí tu nueva contraseña respetando el mínimo de 8 caracteres.',
      'Repetí la nueva contraseña en el campo de confirmación.',
      'Hacé clic en "Actualizar contraseña" para activar la nueva clave personal.',
    ],
  },
  {
    id: 'administracion-usuarios-listado',
    titulo: 'Cómo consultar el listado de usuarios',
    ruta: '/administracion/usuarios',
    permisos: ['administracion.ver'],
    pasos: [
      'Ingresá a Administración y hacé clic en la tarjeta "Usuarios".',
      'Revisá en la tabla la lista de colaboradores con su nombre, correo, rol y estado.',
      'Verificá si cada usuario se encuentra activo, inactivo o como invitado pendiente.',
    ],
  },
  {
    id: 'administracion-usuarios-invitar',
    titulo: 'Cómo invitar a un nuevo colaborador',
    ruta: '/administracion/usuarios/nuevo',
    permisos: ['administracion.ver', 'administracion.crear'],
    pasos: [
      'En la pantalla de Usuarios, hacé clic en "Invitar usuario".',
      'Ingresá el correo electrónico y el nombre completo del colaborador.',
      'Seleccioná el rol que determinará sus permisos en el sistema.',
      'Ingresá o generá una contraseña temporal de al menos 8 caracteres.',
      'Hacé clic en "Crear usuario" (o "Invitar") y compartí los datos de acceso iniciales.',
    ],
  },
  {
    id: 'administracion-usuarios-asignar-rol',
    titulo: 'Cómo cambiar el rol de un usuario',
    ruta: '/administracion/usuarios',
    permisos: ['administracion.ver', 'administracion.editar'],
    pasos: [
      'En la pantalla de Usuarios, ubicá la fila correspondiente al colaborador.',
      'En la columna Rol, abrí el selector desplegable.',
      'Elegí el nuevo rol que deseás asignarle.',
      'El sistema actualizará el rol de inmediato sin necesidad de guardar.',
    ],
  },
  {
    id: 'administracion-usuarios-alternar-estado',
    titulo: 'Cómo activar o desactivar a un usuario',
    ruta: '/administracion/usuarios',
    permisos: ['administracion.ver', 'administracion.editar'],
    pasos: [
      'En el listado de Usuarios, localizá la cuenta del colaborador.',
      'En el extremo derecho de la fila, hacé clic en "Desactivar" (o "Activar" si estaba inactivo).',
      'El estado de la cuenta cambiará al instante, impidiendo o habilitando su inicio de sesión.',
    ],
  },
  {
    id: 'administracion-usuarios-restablecer-clave',
    titulo: 'Cómo restablecer la contraseña de un usuario',
    ruta: '/administracion/usuarios',
    permisos: ['administracion.ver', 'administracion.editar'],
    pasos: [
      'En la lista de Usuarios, localizá al colaborador y hacé clic en "Restablecer clave".',
      'Escribí o generá una nueva contraseña provisoria de 8 caracteres o más.',
      'Hacé clic en "Restablecer" para asentar la nueva clave temporal.',
      'Copiá o compartí las credenciales temporales generadas con el colaborador.',
    ],
    detalles: [
      {
        tema: 'Clave temporal',
        texto: 'La contraseña anterior deja de funcionar de inmediato y el usuario deberá cambiarla al ingresar.',
      },
    ],
  },
  {
    id: 'administracion-auditoria-consultar',
    titulo: 'Cómo consultar el registro de auditoría',
    ruta: '/administracion/auditoria',
    permisos: ['administracion.ver'],
    pasos: [
      'Ingresá a Administración y hacé clic en la tarjeta "Auditoría".',
      'Para acotar la búsqueda, seleccioná la Entidad en el desplegable y definí el rango de fechas.',
      'Hacé clic en "Aplicar" para filtrar las operaciones auditadas.',
      'Hacé clic en "Ver detalle" en cualquier registro para inspeccionar los datos modificados.',
    ],
  },
]
