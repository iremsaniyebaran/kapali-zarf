import { motion } from 'framer-motion'
import type { Bid } from '../stage'
import { GUEST, nameOf } from '../config'
import { txUrl, usd } from '../format'

interface Props {
  bid: Bid
  index: number
  winner: boolean
  priceSetter: boolean
  settled: boolean
}

/** A sealed envelope: the amount stays hidden until BidRevealed, then the card flips open. */
export function Envelope({ bid, index, winner, priceSetter, settled }: Props) {
  const guest = bid.bidder.toLowerCase() === GUEST.toLowerCase()
  const cls = [
    'envelope',
    bid.revealed ? 'envelope-open' : 'envelope-sealed',
    winner ? 'envelope-winner' : '',
    settled && !winner ? 'envelope-lost' : '',
    guest ? 'envelope-guest' : '',
  ]
  return (
    <motion.div
      className={cls.join(' ')}
      layout
      initial={{ opacity: 0, y: 40, rotate: index % 2 ? 4 : -4 }}
      animate={{ opacity: 1, y: 0, rotate: 0, scale: winner ? 1.08 : 1 }}
      transition={{ type: 'spring', stiffness: 240, damping: 20 }}
    >
      <div className="envelope-who">{nameOf(bid.bidder)}</div>
      <div className="envelope-face">
        <motion.div
          className="envelope-inner"
          animate={{ rotateY: bid.revealed ? 180 : 0 }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
        >
          <div className="envelope-front">
            <span className="envelope-flap" />
            <span className="envelope-wax" />
          </div>
          <div className="envelope-back">{bid.amount !== undefined ? usd(bid.amount) : '?'}</div>
        </motion.div>
      </div>
      <div className="envelope-note">
        {winner ? 'kazandı' : priceSetter && settled ? 'ödenen fiyat bu' : bid.revealed ? 'açıldı' : 'mühürlü'}
      </div>
      {bid.tx && (
        <a className="tx-link small" href={txUrl(bid.tx)} target="_blank" rel="noreferrer">
          ↗
        </a>
      )}
    </motion.div>
  )
}
