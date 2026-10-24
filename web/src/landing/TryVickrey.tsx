import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

// The document's example at ETH 900: value 900, reserve 810 (the classic price), debt 800.
const VALUE = 900
const RESERVE = 810
const DEBT = 800
const CLASSIC_REFUND = RESERVE - DEBT

const BIDDERS = [
  { name: 'Bot A', start: 890 },
  { name: 'Bot B', start: 885 },
  { name: 'Bot C', start: 870 },
]

/** A pocket Vickrey auction: move the sealed bids and watch who wins, what they pay and what
 * reaches Elif, against the classic liquidation's 10 $. */
export function TryVickrey() {
  const [bids, setBids] = useState(BIDDERS.map((b) => b.start))
  const [sealed, setSealed] = useState(false)

  const ranked = bids.map((amount, i) => ({ i, amount })).sort((a, b) => b.amount - a.amount || a.i - b.i)
  const winner = ranked[0]
  const price = Math.max(ranked[1]?.amount ?? RESERVE, RESERVE)
  const refund = price - DEBT

  return (
    <div className="try">
      <div className="try-bids">
        {BIDDERS.map((b, i) => (
          <label key={b.name} className={`try-bid ${winner.i === i ? 'is-winner' : ''} ${ranked[1].i === i ? 'is-second' : ''}`}>
            <span className="try-name">{b.name}</span>
            <input
              type="range"
              min={RESERVE}
              max={VALUE}
              value={bids[i]}
              onChange={(e) => setBids((all) => all.map((v, j) => (j === i ? Number(e.target.value) : v)))}
              aria-label={`${b.name} teklifi`}
            />
            <span className="try-amount">{sealed ? '••• $' : `${bids[i]} $`}</span>
          </label>
        ))}
        <button className="try-seal" onClick={() => setSealed((s) => !s)}>
          {sealed ? 'Zarfları aç' : 'Zarfları mühürle'}
        </button>
      </div>

      <div className="try-result">
        <AnimatePresence mode="wait">
          {sealed ? (
            <motion.p key="sealed" className="try-sealed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Teklifler mühürlü: kimse diğerinin tutarını görmüyor, yalnızca bir hash zincirde. Tutarlar açılınca kazanan belli olur.
            </motion.p>
          ) : (
            <motion.div key="open" className="try-lines" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div>
                Kazanan <strong>{BIDDERS[winner.i].name}</strong> ({winner.amount} $)
              </div>
              <div>
                Öder: <strong>{price} $</strong> <span className="muted">= ikinci en yüksek teklif</span>
              </div>
              <div className="try-compare">
                <span>
                  Klasik <strong className="bad">{CLASSIC_REFUND} $</strong>
                </span>
                <span aria-hidden>→</span>
                <span>
                  Kapalı Zarf <strong className="good">{refund} $</strong>
                </span>
              </div>
              <motion.div key={refund} className="try-diff" initial={{ scale: 0.8 }} animate={{ scale: 1 }}>
                Elif’e +{refund - CLASSIC_REFUND} $
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
