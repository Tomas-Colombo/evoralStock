import Link from 'next/link'

export type TabKey =
  | 'resumen'
  | 'en_poder'
  | 'ventas'
  | 'consignaciones'
  | 'cuenta'
  | 'liquidaciones'
  | 'declaraciones'

interface RevendedoraTabsProps {
  idRevendedora: string
  activeTab: TabKey
}

export function RevendedoraTabs({ idRevendedora, activeTab }: RevendedoraTabsProps) {
  const tabs = [
    { key: 'resumen', label: 'Perfil Revendedora', href: `/revendedoras/${idRevendedora}` },
    { key: 'en_poder', label: 'En su poder', href: `/revendedoras/${idRevendedora}/en-poder` },
    { key: 'ventas', label: 'Ventas', href: `/revendedoras/${idRevendedora}/ventas` },
    { key: 'consignaciones', label: 'Consignaciones', href: `/revendedoras/${idRevendedora}/consignaciones` },
    { key: 'cuenta', label: 'Cuenta', href: `/revendedoras/${idRevendedora}/cuenta` },
    { key: 'liquidaciones', label: 'Liquidaciones', href: `/revendedoras/${idRevendedora}/liquidaciones` },
    { key: 'declaraciones', label: 'Declaraciones', href: `/revendedoras/${idRevendedora}/declaraciones` },
  ] as const

  return (
    <nav className="flex space-x-2 border-b border-border pb-px mb-6 overflow-x-auto" aria-label="Pestañas de revendedora">
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              isActive
                ? 'border-foreground text-foreground font-semibold'
                : 'border-transparent text-muted hover:text-foreground hover:border-border'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
