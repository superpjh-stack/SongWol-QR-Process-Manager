import { useParams } from 'react-router-dom'

type Props = { name: string; spec: string; showCode?: boolean }

export function Placeholder({ name, spec, showCode = false }: Props) {
  const params = useParams<{ code?: string }>()
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-3xl font-bold">{name}</h1>
      <p className="text-lg text-gray-600">준비 중 (spec {spec})</p>
      {showCode && params.code ? <p className="font-mono text-base">code: {params.code}</p> : null}
    </main>
  )
}
