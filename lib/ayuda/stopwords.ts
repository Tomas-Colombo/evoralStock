/**
 * Whitelist inmutable de palabras funcionales que alteran el significado (REQ-AYUDA-V2-02).
 * Normalizadas sin tildes. Jamás deben ser descartadas ni como stopword ni en el query.
 */
export const WHITELIST_FUNCIONAL: ReadonlySet<string> = new Set([
  'no',
  'sin',
  'con',
  'ya',
  'ni',
  'nunca',
  'todavia',
  'solo',
  'antes',
  'despues',
])

/**
 * Stopwords tradicionales en español (artículos, preposiciones, pronombres y formas verbales auxiliares/relleno).
 * Todas normalizadas en minúsculas y sin tildes.
 * La whitelist funcional tiene precedencia absoluta sobre este conjunto.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // Artículos
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  // Preposiciones y contracciones (sin 'con', 'sin', 'antes' que son de la whitelist)
  'a', 'al', 'de', 'del', 'en', 'para', 'por', 'sobre', 'tras', 'hasta', 'hacia', 'desde', 'bajo', 'entre',
  // Conjunciones (sin 'ni' que es de la whitelist)
  'y', 'e', 'o', 'u', 'que', 'pero', 'aunque', 'sino', 'porque', 'pues',
  // Pronombres y posesivos
  'yo', 'tu', 'vos', 'el', 'ella', 'ellos', 'ellas', 'nosotros', 'nosotras', 'vosotros', 'vosotras', 'usted', 'ustedes',
  'me', 'te', 'se', 'nos', 'os', 'le', 'les', 'lo',
  'mi', 'mis', 'su', 'sus', 'nuestro', 'nuestra', 'nuestros', 'nuestras', 'vuestro', 'vuestra', 'vuestros', 'vuestras',
  // Demostrativos
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella', 'aquellos', 'aquellas', 'esto', 'eso', 'aquello',
  // Interrogativos / relativos / adverbios comunes (sin 'ya', 'nunca', 'todavia', 'solo', 'despues', 'no')
  'como', 'donde', 'cuando', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'cual', 'cuales', 'quien', 'quienes',
  'aqui', 'ahi', 'alli', 'alla', 'muy', 'tan', 'tanto', 'mas', 'menos', 'bien', 'mal', 'asi', 'tambien', 'tampoco',
  'algo', 'alguien', 'algun', 'alguno', 'alguna', 'algunos', 'algunas', 'nada', 'nadie', 'ningun', 'ninguno', 'ninguna',
  'todo', 'toda', 'todos', 'todas', 'otro', 'otra', 'otros', 'otras', 'mismo', 'misma', 'mismos', 'mismas',
  // Formas verbales auxiliares o de alta frecuencia
  'es', 'son', 'era', 'eran', 'fue', 'fueron', 'ser', 'sido', 'siendo', 'sea', 'sean',
  'esta', 'estan', 'estaba', 'estaban', 'estuvo', 'estuvieron', 'estar', 'estado', 'estando', 'este', 'esten',
  'hay', 'habia', 'hubo', 'ha', 'han', 'he', 'hemos', 'haber', 'habiendo', 'haya', 'hayan',
  'hace', 'hacen', 'hacia', 'hizo', 'hicieron', 'hacer', 'hecho', 'haciendo', 'haga', 'hagan',
  'puedo', 'puedes', 'pueden', 'puede', 'podes', 'podemos', 'podia', 'podian', 'pudo', 'pudieron', 'poder', 'podido',
  'quiero', 'quieres', 'quiere', 'quieren', 'queremos', 'queria', 'querian', 'quiso', 'quisieron', 'querer',
  'sabes', 'sabe', 'saben', 'sabemos', 'sabia', 'sabian', 'supo', 'supieron', 'saber',
  'veo', 'ves', 've', 'ven', 'vemos', 'veia', 'veian', 'vio', 'vieron', 'ver', 'visto',
  'da', 'dan', 'doy', 'das', 'damos', 'daba', 'daban', 'dio', 'dieron', 'dar', 'dado',
  'tengo', 'tienes', 'tiene', 'tienen', 'tenemos', 'tenia', 'tenian', 'tuvo', 'tuvieron', 'tener', 'tenido',
  // Palabras frecuentes de relleno coloquial en consultas
  'hola', 'buenas', 'buen', 'dia', 'tarde', 'noche', 'gracias', 'favor', 'porfa', 'porfavor',
])

/**
 * Determina si una palabra normalizada es stopword respetando estrictamente la whitelist.
 */
export function esStopword(palabra: string): boolean {
  if (WHITELIST_FUNCIONAL.has(palabra)) {
    return false
  }
  return STOPWORDS.has(palabra)
}
