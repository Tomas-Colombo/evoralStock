import { Badge } from '@/components/ui/Badge'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Card } from '@/components/ui/Card'

const EJEMPLO_REGLAS = [
  { nombre: 'Margen general', tipo: 'Margen', alcance: 'Global', valor: '40%' },
  { nombre: 'Margen perfumería', tipo: 'Margen', alcance: 'Categoría', valor: '60%' },
  { nombre: 'Descuento liquidación', tipo: 'Descuento', alcance: 'Global', valor: '10%' },
  { nombre: 'Descuento perfumería', tipo: 'Descuento', alcance: 'Categoría', valor: '5%' },
  { nombre: 'Recargo 3 cuotas', tipo: 'Recargo', alcance: 'Global', valor: '15%' },
]

/**
 * Contenido de la guía del motor de precios. Se muestra dentro del panel
 * plegable de "Nueva regla".
 */
export function GuiaReglas() {
  return (
    <div className="space-y-6">
      {/* 1. Tipos de regla */}
      <Seccion id="tipos" titulo="1. Los tres tipos de regla">
        <p className="mb-4 text-sm text-muted">
          Cada tipo de regla cumple una función distinta y actúa en un momento distinto
          del proceso.
        </p>
        <TableFrame>
          <DataTable>
            <THead>
              <Th>Tipo</Th>
              <Th>Qué hace</Th>
              <Th>Cuándo se aplica</Th>
            </THead>
            <TBody>
              <Tr>
                <Td>
                  <Badge variant="info">Margen</Badge>
                </Td>
                <Td>
                  Fija el <strong>precio de lista</strong>: costo × (1 + margen).
                </Td>
                <Td className="text-muted">
                  Al recalcular. Queda guardado en el producto.
                </Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge variant="success">Descuento</Badge>
                </Td>
                <Td>Baja el precio de lista.</Td>
                <Td className="text-muted">En el momento de la venta.</Td>
              </Tr>
              <Tr>
                <Td>
                  <Badge variant="warning">Recargo</Badge>
                </Td>
                <Td>
                  Sube el precio según la forma de pago (cuotas).
                </Td>
                <Td className="text-muted">En el momento de la venta.</Td>
              </Tr>
            </TBody>
          </DataTable>
        </TableFrame>
        <p className="mt-4 text-sm text-muted">
          Punto clave: el <strong>margen</strong> se calcula una vez y se guarda; el{' '}
          <strong>descuento</strong> y el <strong>recargo</strong> se calculan en vivo al
          vender. Por eso solo el margen puede dejar un precio &ldquo;desactualizado&rdquo;.
        </p>
      </Seccion>

      {/* 2. Cascada de especificidad */}
      <Seccion id="cascada" titulo="2. Qué regla gana: cascada por especificidad">
        <p className="mb-4 text-sm text-muted">
          Cada regla tiene un <strong>alcance</strong>. Cuando varias reglas podrían
          aplicar al mismo producto, gana <strong>la más específica</strong>, en este
          orden:
        </p>
        <Card className="flex flex-wrap items-center gap-2 text-sm font-mono">
          <span className="rounded bg-card-2 px-2 py-1">Producto</span>
          <span className="text-muted">&gt;</span>
          <span className="rounded bg-card-2 px-2 py-1">Categoría</span>
          <span className="text-muted">&gt;</span>
          <span className="rounded bg-card-2 px-2 py-1">Proveedor</span>
          <span className="text-muted">&gt;</span>
          <span className="rounded bg-card-2 px-2 py-1">Global</span>
        </Card>
        <p className="mt-4 text-sm text-muted">
          Una regla de producto le gana a una de categoría, que le gana a una de
          proveedor, que le gana a una global. En <strong>margen</strong> y{' '}
          <strong>recargo</strong> gana una sola, la más específica. En{' '}
          <strong>descuento</strong> es distinto: gana un descuento por cada nivel de
          alcance y <strong>se suman</strong>.
        </p>
      </Seccion>

      {/* 3. Prioridad */}
      <Seccion
        id="prioridad"
        titulo="3. La prioridad: solo desempata dentro del mismo alcance"
      >
        <p className="mb-4 text-sm text-muted">
          El orden completo con el que el sistema elige una regla es:
        </p>
        <ol className="mb-4 space-y-2 text-sm">
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            <span className="font-mono text-xs text-muted">1º</span>{' '}
            <strong>Especificidad</strong> del alcance (producto &gt; categoría &gt;
            proveedor &gt; global).
          </li>
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            <span className="font-mono text-xs text-muted">2º</span>{' '}
            <strong>Prioridad</strong> (el número más alto gana).
          </li>
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            <span className="font-mono text-xs text-muted">3º</span> La regla{' '}
            <strong>más reciente</strong>.
          </li>
        </ol>
        <p className="text-sm text-muted">
          Entonces, dos reglas <strong>global</strong>, una con prioridad 2 y otra con
          prioridad 1: están empatadas en especificidad, así que se pasa al segundo
          criterio y <strong>gana la de prioridad 2</strong>.
        </p>
        <div className="mt-4 rounded-lg border border-alerta-ink bg-alerta-bg p-4">
          <div className="mb-2 text-sm font-medium text-text">
            Atención: la prioridad no cruza niveles de alcance
          </div>
          <p className="text-sm text-muted">
            Una regla <strong>global</strong> con prioridad 99 pierde contra una regla de{' '}
            <strong>categoría</strong> con prioridad 0, porque la especificidad se evalúa
            primero. La prioridad solo sirve para elegir entre reglas del mismo alcance.
          </p>
        </div>
      </Seccion>

      {/* 4. Ejemplo */}
      <Seccion id="ejemplo" titulo="4. Ejemplo completo, paso a paso">
        <p className="mb-4 text-sm text-muted">
          Producto <strong>Shampoo X</strong>, categoría <em>Perfumería</em>, costo{' '}
          <strong>$1.000</strong>. Reglas cargadas:
        </p>
        <TableFrame className="mb-4">
          <DataTable>
            <THead>
              <Th>Regla</Th>
              <Th>Tipo</Th>
              <Th>Alcance</Th>
              <Th align="right">Valor</Th>
            </THead>
            <TBody>
              {EJEMPLO_REGLAS.map((r) => (
                <Tr key={r.nombre}>
                  <Td>{r.nombre}</Td>
                  <Td>{r.tipo}</Td>
                  <Td>{r.alcance}</Td>
                  <Td align="right" className="font-mono">{r.valor}</Td>
                </Tr>
              ))}
            </TBody>
          </DataTable>
        </TableFrame>

        <div className="space-y-3">
          <Paso numero="1" titulo="Margen (al recalcular)">
            Compiten el margen global (40%) y el de categoría (60%). Gana{' '}
            <strong>categoría</strong> por ser más específica. Precio de lista ={' '}
            <span className="font-mono">1.000 × 1,60 = $1.600</span>. El 40% global no se
            aplica.
          </Paso>
          <Paso numero="2" titulo="Descuentos (en la venta)">
            Son de alcances distintos, así que <strong>se suman</strong>: 10% + 5% = 15%.
            Precio con descuento ={' '}
            <span className="font-mono">1.600 × 0,85 = $1.360</span>.
          </Paso>
          <Paso numero="3" titulo="Recargo (si paga en 3 cuotas)">
            Se aplica <strong>después</strong> del descuento:{' '}
            <span className="font-mono">1.360 × 1,15 = $1.564</span>.
          </Paso>
        </div>
        <p className="mt-4 text-sm text-muted">
          El orden &mdash; descuento primero, recargo después &mdash; es intencional: evita
          que un descuento grande absorba el recargo de las cuotas.
        </p>
      </Seccion>

      {/* 5. Recálculo manual */}
      <Seccion id="recalculo" titulo="5. Por qué el recálculo es manual">
        <p className="mb-4 text-sm text-muted">
          El sistema <strong>nunca reescribe precios por su cuenta</strong>. Cuando cambia
          un costo, o se crea o se da de baja una regla de margen, los productos afectados
          solo se marcan como <Badge variant="warning">Desactualizado</Badge>. El recálculo
          real lo ejecuta el operador desde <strong>Control de precios</strong>.
        </p>
        <p className="mb-3 text-sm text-muted">Esto cumple tres objetivos:</p>
        <ul className="space-y-3 text-sm">
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            <strong>Previsualización con control.</strong> Antes de confirmar se ve costo,
            precio actual, precio proyectado y la diferencia porcentual. Un error de carga
            se detecta antes de que el precio salga a la venta.
          </li>
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            <strong>Control del momento.</strong> El operador decide cuándo entran en
            vigencia los precios nuevos. Puede cargar varias reglas y recalcular todo a la
            vez.
          </li>
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            <strong>Auditoría.</strong> Cada recálculo registra el precio anterior, el
            precio nuevo, el costo y la regla aplicada, con usuario y fecha.
          </li>
        </ul>
      </Seccion>
    </div>
  )
}

function Seccion({
  id,
  titulo,
  children,
}: {
  id: string
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="mb-3 font-display text-xl text-text">{titulo}</h2>
      {children}
    </section>
  )
}

function Paso({
  numero,
  titulo,
  children,
}: {
  numero: string
  titulo: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-block text-xs font-mono text-white">
          {numero}
        </span>
        <span className="font-medium text-text">{titulo}</span>
      </div>
      <p className="text-sm text-muted">{children}</p>
    </Card>
  )
}
