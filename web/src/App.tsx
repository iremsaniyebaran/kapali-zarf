import { useCallback, useEffect, useRef, useState } from 'react'
import { ADDRESSES, DROP_URL, MOCK } from './config'
import { useStage } from './stage'
import { useMockFeed, stringifyScript } from './feeds/mock'
import { useChainFeed } from './feeds/chain'
import { PriceBar } from './components/PriceBar'
import { PositionCard } from './components/PositionCard'
import { ClassicColumn } from './components/ClassicColumn'
import { AuctionColumn } from './components/AuctionColumn'
import { RefundFlight } from './components/RefundFlight'
import { BottomStrip } from './components/BottomStrip'

const mode: 'live' | 'mock' = MOCK || !ADDRESSES ? 'mock' : 'live'

export default function App() {
  const [state, dispatch] = useStage()
  const stableDispatch = useCallback(dispatch, [dispatch])
  const mock = useMockFeed(stableDispatch, mode === 'mock')
  const chain = useChainFeed(stableDispatch, mode === 'live')

  const [botsUp, setBotsUp] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [landed, setLanded] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)
  const zarfRefundRef = useRef<HTMLDivElement>(null)

  const result = state.auction?.result
  useEffect(() => {
    if (!result) setLanded(false)
  }, [result])

  // The button is grey while the bot process (and its /drop endpoint) is not reachable.
  useEffect(() => {
    if (mode !== 'live') return
    const check = () =>
      fetch(`${DROP_URL}/health`)
        .then((r) => setBotsUp(r.ok))
        .catch(() => setBotsUp(false))
    check()
    const t = setInterval(check, 2_000)
    return () => clearInterval(t)
  }, [])

  const drop = useCallback(async () => {
    if (mode === 'mock') return mock.trigger()
    setDropping(true)
    try {
      await fetch(`${DROP_URL}/drop`, { method: 'POST' })
    } finally {
      setDropping(false)
    }
  }, [mock])

  const reset = useCallback(async () => {
    if (mode === 'mock') return mock.reset()
    await fetch(`${DROP_URL}/reset`, { method: 'POST' }).catch(() => {})
  }, [mock])

  // Space: drop. R: reset. K: download the last live round as a mock script (src/feeds/recorded.json).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        drop()
      } else if (e.key === 'r' || e.key === 'R') reset()
      else if ((e.key === 'k' || e.key === 'K') && mode === 'live') {
        const blob = new Blob([stringifyScript(chain.exportScript())], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'recorded.json'
        a.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drop, reset, chain])

  const status =
    mode === 'mock'
      ? 'kayıt modu (mock)'
      : !botsUp
        ? 'bot süreci kapalı'
        : chain.connected
          ? `canlı · blok ${state.head.toString()}`
          : 'zincire bağlanıyor…'

  // Value of the cards at the moment of the drop, so a closed card's numbers stay put.
  const price = state.price

  return (
    <div className="stage">
      <PriceBar
        price={price}
        from={state.drop?.from}
        canDrop={mode === 'mock' || botsUp}
        dropping={dropping}
        mode={mode}
        status={status}
        onDrop={drop}
      />

      <main className="columns">
        <section className="column column-classic">
          <h2 className="column-title">
            <span className="column-kicker">Bugün</span> Klasik likidasyon
          </h2>
          <PositionCard title="Elif" position={state.klasik} price={price} showRefund />
          <ClassicColumn classic={state.classic} drop={state.drop} />
        </section>

        <section className="column column-zarf">
          <h2 className="column-title">
            <span className="column-kicker">Kapalı Zarf</span> Mühürlü ikinci fiyat
          </h2>
          <PositionCard ref={zarfRefundRef} title="Elif" position={state.zarf} price={price} showRefund={landed} />
          <AuctionColumn ref={resultRef} auction={state.auction} head={state.head} drop={state.drop} />
        </section>
      </main>

      <BottomStrip classic={state.classic} auction={state.auction} drop={state.drop} landed={landed} />

      {result && !landed && <RefundFlight amount={result.refund} from={resultRef} to={zarfRefundRef} onLanded={() => setLanded(true)} />}
    </div>
  )
}
