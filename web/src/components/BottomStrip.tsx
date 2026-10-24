import { motion } from 'framer-motion'
import type { StageState } from '../stage'
import { seconds, txUrl, usd } from '../format'
import { Term } from './Term'

/** The punchline, computed from events: difference = AuctionSettled.refund − ClassicLiquidated.refund. */
export function BottomStrip({ classic, auction, drop, landed }: Pick<StageState, 'classic' | 'auction' | 'drop'> & { landed: boolean }) {
  const result = auction?.result
  const diff = classic && result ? result.refund - classic.refund : undefined
  const elapsed = result && drop ? result.block - drop.block : undefined
  // What the pool loses when the sale price does not cover the debt.
  const classicLoss = classic ? classic.debt - classic.debtRepaid : 0n
  const zarfLoss = auction && result ? auction.debt - result.debtRepaid : 0n
  const links = [
    drop?.tx && { label: 'fiyat düşüşü', tx: drop.tx },
    classic?.tx && { label: 'klasik likidasyon', tx: classic.tx },
    auction?.tx && { label: 'açık artırma başladı', tx: auction.tx },
    result?.tx && { label: 'sonuç', tx: result.tx },
  ].filter(Boolean) as { label: string; tx: `0x${string}` }[]

  return (
    <footer className="bottom-strip">
      <div className="diff">
        {diff !== undefined && landed ? (
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
            <span className="diff-label">Aynı pozisyon, aynı fiyat düşüşü. Elif’e fazladan dönen</span>
            <strong className="diff-value">{diff >= 0n ? '+' : '−'}{usd(diff >= 0n ? diff : -diff)}</strong>
            {elapsed !== undefined && <span className="diff-time">{seconds(elapsed)} içinde, {elapsed.toString()} blok</span>}
            {(classicLoss > 0n || zarfLoss > 0n) && (
              <span className="diff-loss">
                Havuzun <Term k="badDebt">kötü borcu</Term>: <span className="bad">{usd(classicLoss)}</span> → <span className="good">{usd(zarfLoss)}</span>
              </span>
            )}
          </motion.div>
        ) : (
          <span className="diff-label muted">Aynı pozisyon, aynı fiyat düşüşü: iki likidasyon yan yana.</span>
        )}
      </div>
      {links.length > 0 && (
        <nav className="links">
          {links.map((l) => (
            <a key={l.tx} href={txUrl(l.tx)} target="_blank" rel="noreferrer">
              {l.label} ↗
            </a>
          ))}
        </nav>
      )}
    </footer>
  )
}
