import { forwardRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { healthOf, valueOf, type Position } from '../stage'
import { num, usd } from '../format'
import { Term } from './Term'

interface Props {
  title: string
  position: Position & { refund?: bigint }
  /** Current ETH price. */
  price: bigint
  showRefund: boolean
}

export const PositionCard = forwardRef<HTMLDivElement, Props>(function PositionCard({ title, position, price, showRefund }, refundRef) {
  const closed = position.refund !== undefined
  const empty = !closed && position.debt === 0n
  const hf = healthOf(position, price)
  const healthy = hf >= 1
  // Gauge: 0.8 at the left edge, 1.2 at the right, the threshold 1.0 in the middle.
  const fill = Math.max(0, Math.min(1, (hf - 0.8) / 0.4))

  return (
    <div className={`position ${closed ? 'position-closed' : healthy ? 'position-ok' : 'position-bad'}`}>
      <div className="position-head">
        <span className="position-title">{title}</span>
        <span className="position-tag">{closed ? 'likide edildi' : empty ? 'pozisyon yok' : healthy ? 'sağlıklı' : 'likide edilebilir'}</span>
      </div>

      {!closed ? (
        <>
          <dl className="position-grid">
            <div>
              <dt>Teminat</dt>
              <dd>{num(position.collateral)} ETH</dd>
            </div>
            <div>
              <dt>Değer</dt>
              <dd>{usd(valueOf(position, price))}</dd>
            </div>
            <div>
              <dt>Borç</dt>
              <dd>{usd(position.debt)}</dd>
            </div>
          </dl>
          <div className="health">
            <div className="health-label">
              <Term k="health">Sağlık oranı</Term> <strong>{Number.isFinite(hf) ? hf.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</strong>
            </div>
            <div className="health-track">
              <motion.div className="health-fill" animate={{ width: `${fill * 100}%` }} transition={{ duration: 0.6 }} />
              <div className="health-threshold" />
            </div>
          </div>
        </>
      ) : (
        <div className="position-refund" ref={refundRef}>
          <span>Elif’e dönen</span>
          <AnimatePresence>
            {showRefund && (
              <motion.strong initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
                {usd(position.refund!)}
              </motion.strong>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
})
