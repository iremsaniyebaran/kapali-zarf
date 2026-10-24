import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { bidOf, DEBT, DROP_OPTIONS, dropPriceOf, healthAt, liquidatableAt, MAX_MARGIN_BPS, reserveOf, type Scenario, type Strategy } from '../scenario'
import { Term } from './Term'

interface Props {
  scenario: Scenario
  busy: boolean
  canControl: boolean
  onDropPct: (pct: number) => void
  onStrategy: (role: Strategy['role'], patch: Partial<Strategy>) => void
  onGuest: (amount: number | null) => void
  onReset: () => void
  children: ReactNode
}

const pct = (bps: number) => `%${(bps / 100).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`

export function ControlPanel({ scenario, busy, canControl, onDropPct, onStrategy, onGuest, onReset, children }: Props) {
  const value = dropPriceOf(scenario.dropPct)
  const reserve = reserveOf(value)
  const hf = healthAt(value)
  const [draft, setDraft] = useState<number>(() => Math.round((value + reserve) / 2 + 3))
  const guestAmount = Math.min(value, Math.max(reserve, draft))

  return (
    <aside className="panel">
      <section className="panel-section">
        <h3>Senaryo</h3>
        <div className="segmented" role="radiogroup" aria-label="Fiyat düşüşü">
          {DROP_OPTIONS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={scenario.dropPct === p}
              className={scenario.dropPct === p ? 'active' : ''}
              onClick={() => onDropPct(p)}
            >
              %{p}
            </button>
          ))}
        </div>
        <p className="panel-note">
          ETH <strong>{value} $</strong> · <Term k="health">sağlık</Term>{' '}
          <strong className={hf < 1 ? 'bad' : 'good'}>{hf.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</strong>
          {!liquidatableAt(value) && ' · likidasyon olmaz'}
          {reserve < DEBT ? (
            <>
              {' '}· <Term k="badDebt">kötü borç</Term> senaryosu
            </>
          ) : null}
        </p>
        <button className="ghost-button" onClick={onReset} disabled={busy || !canControl}>
          {busy ? 'Sıfırlanıyor…' : '↺ Başa al (reset)'}
        </button>
      </section>

      <section className="panel-section">
        <h3>Botların stratejisi</h3>
        <p className="panel-note">Marj ne kadar küçükse teklif o kadar yüksek. Sonraki açık artırmadan itibaren geçerli.</p>
        {scenario.bidders.map((b) => {
          const bid = bidOf(value, b.marginBps)
          return (
            <div key={b.role} className={`strategy ${b.enabled ? '' : 'off'}`}>
              <label className="switch">
                <input type="checkbox" checked={b.enabled} disabled={!canControl} onChange={(e) => onStrategy(b.role, { enabled: e.target.checked })} />
                <span aria-hidden />
                <span className="strategy-name">{b.label}</span>
              </label>
              <input
                type="range"
                min={0}
                max={MAX_MARGIN_BPS}
                step={10}
                value={b.marginBps}
                disabled={!b.enabled || !canControl}
                onChange={(e) => onStrategy(b.role, { marginBps: Number(e.target.value) })}
                aria-label={`${b.label} marjı`}
              />
              <span className="strategy-bid">
                {b.enabled ? (
                  <>
                    {pct(b.marginBps)} → <strong>{bid} $</strong>
                  </>
                ) : (
                  'katılmıyor'
                )}
              </span>
            </div>
          )
        })}
      </section>

      <section className="panel-section">
        <h3>Sen de teklif ver</h3>
        <AnimatePresence mode="wait" initial={false}>
          {scenario.guest === null ? (
            <motion.div key="draft" className="guest" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <input
                type="range"
                min={reserve}
                max={value}
                step={1}
                value={guestAmount}
                onChange={(e) => setDraft(Number(e.target.value))}
                aria-label="Teklifin"
              />
              <div className="guest-row">
                <span>
                  <Term k="sealed">Mühürlü</Term> teklifin <strong>{guestAmount} $</strong>
                  <span className="muted"> ({reserve}–{value})</span>
                </span>
                <button className="seal-button" onClick={() => onGuest(guestAmount)} disabled={!canControl}>
                  Mühürle
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="armed" className="guest guest-armed" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <span className="mini-envelope" aria-hidden />
              <span>
                Zarfın hazır: <strong>{scenario.guest} $</strong>
                <br />
                <span className="muted">Fiyat düşünce botlarla birlikte mühürlenir.</span>
              </span>
              <button className="ghost-button small" onClick={() => onGuest(null)} disabled={!canControl}>
                Geri çek
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <section className="panel-section panel-grow">{children}</section>
    </aside>
  )
}
