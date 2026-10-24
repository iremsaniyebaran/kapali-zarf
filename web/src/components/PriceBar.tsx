import { AnimatePresence, motion } from 'framer-motion'
import { num } from '../format'

interface Props {
  price: bigint
  from?: bigint
  canDrop: boolean
  dropping: boolean
  mode: 'live' | 'mock'
  status: string
  onDrop: () => void
}

export function PriceBar({ price, from, canDrop, dropping, mode, status, onDrop }: Props) {
  const fell = from !== undefined && price < from
  return (
    <header className="price-bar">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <div>
          <div className="brand-name">Kapalı Zarf</div>
          <div className="brand-sub">Likidasyonda en hızlı bot değil, en iyi teklif kazanır</div>
        </div>
      </div>

      <div className={`price ${fell ? 'price-down' : ''}`}>
        <span className="price-label">ETH</span>
        <AnimatePresence mode="popLayout">
          <motion.span
            key={price.toString()}
            className="price-value"
            initial={{ y: fell ? -40 : 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: fell ? 40 : -40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          >
            {num(price)} $
          </motion.span>
        </AnimatePresence>
        {fell && from !== undefined && <span className="price-from">{num(from)} $’dan</span>}
      </div>

      <div className="drop">
        <button className="drop-button" onClick={onDrop} disabled={!canDrop || dropping}>
          {dropping ? 'Gönderiliyor…' : 'ETH %10 düştü'}
        </button>
        <div className={`status status-${mode}`}>
          <span className="status-dot" aria-hidden />
          {status}
        </div>
      </div>
    </header>
  )
}
