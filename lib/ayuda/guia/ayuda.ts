import type { EntradaGuia } from '../tipos'

export const GUIA_AYUDA: readonly EntradaGuia[] = [
  {
    id: 'ayuda-uso',
    titulo: 'Cómo consultar al asistente de ayuda',
    pasos: [
      'Escribí tu consulta en lenguaje claro sobre lo que querés hacer.',
      'El asistente te va a indicar los pasos necesarios y te va a sugerir el acceso directo a la pantalla si corresponde.',
      'Si no encontrás lo que buscás o la pantalla no está disponible, consultale al administrador de tu negocio.',
    ],
    permisos: ['ayuda.consultar'],
  },
]
