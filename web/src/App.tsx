import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ADDRESSES, BLOCK_SECONDS, DROP_URL, MOCK, nameOf } from './config'
import { DEMO_POSITION, ONE, useStage, type StageState } from './stage'
import { useMockFeed, stringifyScript, reviveBigInts } from './feeds/mock'
import { useChainFeed } from './feeds/chain'
import { playScript, type Step } from './feeds/player'
import { DEFAULT_SCENARIO, dropPriceOf, START_PRICE, type Scenario, type Strategy } from './scenario'
import { PriceBar } from './components/PriceBar'
import { PositionCard } from './components/PositionCard'
import { ClassicColumn } from './components/ClassicColumn'
import { AuctionColumn } from './components/AuctionColumn'
import { RefundFlight } from './components/RefundFlight'
import { BottomStrip } from './components/BottomStrip'
import { ControlPanel } from './components/ControlPanel'
import { Activity, type Round } from './components/Activity'
import { Term } from './components/Term'

const mode: 'live' | 'mock' = MOCK || !ADDRESSES ? 'mock' : 'live'
const REPLAY_SPEED = 2.5
const HISTORY_KEY = `kz-history-${mode}`
const PANEL_KEY = 'kz-panel-open'

interface ServerConfig {
  bidders: Strategy[]
  guest: number | null
}

// Per-viewer conveniences only: the page works the same when storage is unavailable.
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (reviveBigInts(JSON.parse(raw)) as T) : fallback
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `${v}n` : v)))
  } catch {
    // storage blocked: nothing to do
  }
}

const post = (path: string, body: unknown) =>
  fetch(`${DROP_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Turns a finished round on the stage into a history row. */
function toRound(s: StageState, script: Step[]): Round | undefined {
  const a = s.auction
  if (!a?.result || !s.drop) return undefined
  return {
    // Mock ids and blocks repeat after a reload, so the key also carries the time.
    key: `${mode}:${a.id}:${a.result.block}:${Date.now()}`,
    at: Date.now(),
    mode,
    dropTo: s.price,
    classicRefund: s.classic?.refund,
    zarfRefund: a.result.refund,
    classicShortfall: s.classic ? s.classic.debt - s.classic.debtRepaid : 0n,
    zarfShortfall: a.debt - a.result.debtRepaid,
    winner: nameOf(a.result.winner),
    price: a.result.price,
    fallback: a.result.kind === 'fallback',
    blocks: a.result.block - s.drop.block,
    script,
  }
}

export default function App() {
  const [live, dispatchLive] = useStage()
  const [replay, dispatchReplay] = useStage()
  const stableDispatch = useCallback(dispatchLive, [dispatchLive])
  const mock = useMockFeed(stableDispatch, mode === 'mock')
  const chain = useChainFeed(stableDispatch, mode === 'live')

  const [localScenario, setLocalScenario] = useState<Scenario>(DEFAULT_SCENARIO)
  const [server, setServer] = useState<ServerConfig>()
  const [botsUp, setBotsUp] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [landed, setLanded] = useState(false)
  const [panelOpen, setPanelOpen] = useState(() => load(PANEL_KEY, true))
  const [rounds, setRounds] = useState<Round[]>(() => load(HISTORY_KEY, []))
  const [replaying, setReplaying] = useState<Round>()
  const stopReplay = useRef<() => void>(() => {})
  const lastMockScript = useRef<Step[]>([])
  const configTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const resultRef = useRef<HTMLDivElement>(null)
  const zarfRefundRef = useRef<HTMLDivElement>(null)

  // Live mode: bot strategies and the armed guest bid live in the bot process; the drop size is ours.
  const scenario: Scenario = useMemo(
    () => (mode === 'live' && server ? { dropPct: localScenario.dropPct, bidders: server.bidders, guest: server.guest } : localScenario),
    [localScenario, server],
  )
  const canControl = mode === 'mock' || botsUp
  const view = replaying ? replay : live
  const result = view.auction?.result

  useEffect(() => {
    if (!result) setLanded(false)
  }, [result])

  useEffect(() => save(PANEL_KEY, panelOpen), [panelOpen])
  useEffect(() => save(HISTORY_KEY, rounds.slice(0, 12)), [rounds])

  // A finished live (or mock) round goes into the history once.
  const liveResult = live.auction?.result
  const recorded = useRef<typeof liveResult>(undefined)
  useEffect(() => {
    if (!liveResult || recorded.current === liveResult) return
    recorded.current = liveResult
    const script = mode === 'live' ? chain.exportScript() : lastMockScript.current
    const round = toRound(live, script)
    if (!round) return
    // A reload restores the last live round from the chain: that one is already in the history.
    const base = round.key.split(':').slice(0, 3).join(':')
    setRounds((rs) => (mode === 'live' && rs.some((r) => r.key.startsWith(base)) ? rs : [round, ...rs].slice(0, 12)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveResult])

  // The button is grey while the bot process (and its /drop endpoint) is not reachable.
  useEffect(() => {
    if (mode !== 'live') return
    const check = () =>
      fetch(`${DROP_URL}/health`)
        .then((r) => r.json())
        .then((h) => {
          setBotsUp(Boolean(h.ok))
          if (h.bidders) setServer({ bidders: h.bidders, guest: h.guest?.amount ?? null })
        })
        .catch(() => setBotsUp(false))
    check()
    const t = setInterval(check, 2_000)
    return () => clearInterval(t)
  }, [])

  const backToLive = useCallback(() => {
    stopReplay.current()
    setReplaying(undefined)
  }, [])

  const drop = useCallback(async () => {
    backToLive()
    if (mode === 'mock') {
      lastMockScript.current = mock.trigger(scenario)
      // Like the bot process, an armed guest bid is used once.
      setLocalScenario((s) => ({ ...s, guest: null }))
      return
    }
    setDropping(true)
    try {
      await post('/drop', { price: dropPriceOf(scenario.dropPct) })
    } finally {
      setDropping(false)
    }
  }, [mock, scenario, backToLive])

  const reset = useCallback(async () => {
    backToLive()
    if (mode === 'mock') return mock.reset()
    setResetting(true)
    try {
      await post('/reset', {})
    } catch {
      // the status line shows the bot process as down
    } finally {
      setResetting(false)
    }
  }, [mock, backToLive])

  const setDropPct = (dropPct: number) => setLocalScenario((s) => ({ ...s, dropPct }))

  const setStrategy = (role: Strategy['role'], patch: Partial<Strategy>) => {
    const bidders = scenario.bidders.map((b) => (b.role === role ? { ...b, ...patch } : b))
    if (mode === 'mock') return setLocalScenario((s) => ({ ...s, bidders }))
    setServer((sv) => (sv ? { ...sv, bidders } : sv))
    // Sliders fire on every step; send the last value only.
    clearTimeout(configTimer.current)
    configTimer.current = setTimeout(() => post('/config', { bidders }).catch(() => {}), 150)
  }

  const setGuest = (amount: number | null) => {
    if (mode === 'mock') return setLocalScenario((s) => ({ ...s, guest: amount }))
    setServer((sv) => (sv ? { ...sv, guest: amount } : sv))
    post('/bid', { amount }).catch(() => {})
  }

  const startReplay = (round: Round) => {
    stopReplay.current()
    setReplaying(round)
    setLanded(false)
    dispatchReplay({ type: 'Reset', price: BigInt(START_PRICE) * ONE })
    dispatchReplay({ type: 'Snapshot', price: BigInt(START_PRICE) * ONE, klasik: DEMO_POSITION, zarf: DEMO_POSITION })
    stopReplay.current = playScript(round.script, dispatchReplay, { blockMs: BLOCK_SECONDS * 1000, speed: REPLAY_SPEED })
  }

  // Space: drop. R: reset. P: panel. Esc: leave the replay. K: download the last live round as a
  // mock script (save it as web/src/feeds/recorded.json).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        drop()
      } else if (e.key === 'r' || e.key === 'R') reset()
      else if (e.key === 'p' || e.key === 'P') setPanelOpen((o) => !o)
      else if (e.key === 'Escape') backToLive()
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
  }, [drop, reset, chain, backToLive])

  const status =
    mode === 'mock'
      ? 'kayıt modu (mock)'
      : !botsUp
        ? 'bot süreci kapalı'
        : chain.connected
          ? `canlı · blok ${live.head.toString()}`
          : 'zincire bağlanıyor…'

  return (
    <div className={`stage ${panelOpen ? 'with-panel' : ''} ${replaying ? 'replaying' : ''}`}>
      <PriceBar
        price={view.price}
        from={view.drop?.from}
        dropPct={scenario.dropPct}
        canDrop={canControl && !resetting}
        dropping={dropping}
        mode={mode}
        status={status}
        panelOpen={panelOpen}
        onDrop={drop}
        onTogglePanel={() => setPanelOpen((o) => !o)}
      />

      <div className="body">
        <main className="columns">
          <AnimatePresence>
            {replaying && (
              <motion.div className="replay-banner" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <span>
                  ▶ Tekrar · yavaş çekim ×{REPLAY_SPEED.toLocaleString('tr-TR')}
                  <span className="muted"> · tur {rounds.length - rounds.indexOf(replaying)}</span>
                </span>
                <button className="ghost-button small" onClick={backToLive}>
                  Canlıya dön (Esc)
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <section className="column column-classic">
            <h2 className="column-title">
              <span className="column-kicker">Bugün</span> <Term k="classic">Klasik likidasyon</Term>
            </h2>
            <PositionCard title="Elif" position={view.klasik} price={view.price} showRefund />
            <ClassicColumn classic={view.classic} drop={view.drop} />
          </section>

          <section className="column column-zarf">
            <h2 className="column-title">
              <span className="column-kicker">Kapalı Zarf</span> Mühürlü <Term k="second">ikinci fiyat</Term>
            </h2>
            <PositionCard ref={zarfRefundRef} title="Elif" position={view.zarf} price={view.price} showRefund={landed} />
            <AuctionColumn ref={resultRef} auction={view.auction} head={view.head} drop={view.drop} />
          </section>
        </main>

        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.div className="panel-wrap" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} transition={{ duration: 0.2 }}>
              <ControlPanel
                scenario={scenario}
                busy={resetting}
                canControl={canControl}
                onDropPct={setDropPct}
                onStrategy={setStrategy}
                onGuest={setGuest}
                onReset={reset}
              >
                <Activity feed={view.feed} rounds={rounds} replaying={!!replaying} onReplay={startReplay} onClearHistory={() => setRounds([])} />
              </ControlPanel>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <BottomStrip classic={view.classic} auction={view.auction} drop={view.drop} landed={landed} />

      {result && !landed && <RefundFlight amount={result.refund} from={resultRef} to={zarfRefundRef} onLanded={() => setLanded(true)} />}
    </div>
  )
}
