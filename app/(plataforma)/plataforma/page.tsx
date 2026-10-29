import { logoutAction } from '@/app/(app)/actions'

export default function PlataformaPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Plataforma</h1>
      <form action={logoutAction} className="mt-4">
        <button
          type="submit"
          className="rounded bg-stone-800 px-4 py-2 text-white"
        >
          Cerrar sesión
        </button>
      </form>
    </main>
  )
}
