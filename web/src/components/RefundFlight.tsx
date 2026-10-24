import { useLayoutEffect, useState, type RefObject } from 'react'
import { motion } from 'framer-motion'
import { usd } from '../format'

interface Props {
  amount: bigint
  from: RefObject<HTMLElement | null>
  to: RefObject<HTMLElement | null>
  onLanded: () => void
}

/** The refund flies from the auction result up into Elif's card. */
export function RefundFlight({ amount, from, to, onLanded }: Props) {
  const [path, setPath] = useState<{ x0: number; y0: number; x1: number; y1: number }>()

  useLayoutEffect(() => {
    const a = from.current?.getBoundingClientRect()
    const b = to.current?.getBoundingClientRect()
    if (!a || !b) {
      onLanded()
      return
    }
    setPath({ x0: a.left + a.width / 2, y0: a.top + a.height / 2, x1: b.left + b.width / 2, y1: b.top + b.height / 2 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!path) return null
  return (
    <motion.div
      className="refund-flight"
      style={{ left: 0, top: 0 }}
      initial={{ x: path.x0, y: path.y0, scale: 0.6, opacity: 0 }}
      animate={{
        x: [path.x0, (path.x0 + path.x1) / 2 + 80, path.x1],
        y: [path.y0, Math.min(path.y0, path.y1) - 80, path.y1],
        scale: [0.6, 1.5, 1],
        opacity: [0, 1, 1],
      }}
      transition={{ duration: 1.3, ease: 'easeInOut', delay: 0.7 }}
      onAnimationComplete={onLanded}
    >
      <span>+{usd(amount)}</span>
    </motion.div>
  )
}
