import { AnimatePresence, motion } from 'framer-motion'
import type { StageState } from '../stage'
import { nameOf } from '../config'
import { txUrl, usd } from '../format'

export function ClassicColumn({ classic, drop }: Pick<StageState, 'classic' | 'drop'>) {
  const blocks = classic && drop ? classic.block - drop.block : undefined
  return (
    <div className="column-body">
      <AnimatePresence mode="wait">
        {!classic ? (
          <motion.p key="wait" className="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {drop ? 'En hızlı bot yarışıyor…' : 'Fiyat düşünce ilk gelen bot teminatın tamamını %10 indirimle alır.'}
          </motion.p>
        ) : (
          <motion.div key="done" className="classic-result" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 22 }}>
            <div className="classic-line">
              <strong>{nameOf(classic.liquidator)}</strong>
              {blocks !== undefined && blocks >= 0n ? ` ${blocks === 0n ? 'aynı blokta' : `${blocks} blokta`} aldı` : ' aldı'}
            </div>
            <div className="classic-paid">
              Ödenen <strong>{usd(classic.price)}</strong> <span className="muted">sabit fiyat: değerin %90’ı</span>
            </div>
            {classic.tx && (
              <a className="tx-link" href={txUrl(classic.tx)} target="_blank" rel="noreferrer">
                işlemi explorer’da gör ↗
              </a>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
