import { motion } from 'framer-motion'

/** The "LİKİDE EDİLDİ" stamp, slammed onto the auction result. */
export function Seal({ label = 'LİKİDE EDİLDİ' }: { label?: string }) {
  return (
    <motion.div
      className="seal"
      initial={{ scale: 3, opacity: 0, rotate: -30 }}
      animate={{ scale: 1, opacity: 1, rotate: -12 }}
      transition={{ type: 'spring', stiffness: 420, damping: 16, delay: 0.15 }}
      aria-hidden
    >
      {label}
    </motion.div>
  )
}
