import { useId, useState } from 'react'
import { motion } from 'framer-motion'

/** Photo of the real medal. While the file is missing, the drawn medal below is shown instead. */
const MEDAL_PHOTO = '/nobel-medal.png'

const CX = 60
const CY = 95
const LEAF_RADIUS = 42
// Leaf angles in degrees, measured from the bottom of the medal up each side.
const LEAF_ANGLES = [20, 40, 60, 80, 100, 120, 140]

function leaves(side: 1 | -1) {
  return LEAF_ANGLES.map((deg) => {
    const rad = ((90 + side * deg) * Math.PI) / 180
    const x = CX + LEAF_RADIUS * Math.cos(rad)
    const y = CY + LEAF_RADIUS * Math.sin(rad)
    // Long axis along the rim, tilted a little outwards like a laurel.
    return <ellipse key={`${side}-${deg}`} cx={x} cy={y} rx={3} ry={6.5} transform={`rotate(${90 + side * deg + side * 15} ${x} ${y})`} fill="#8a5c05" opacity={0.55} />
  })
}

/** The Nobel medal photo, or a drawn gold medal with a laurel and "1996" if the photo cannot load. */
export function Medal({ size = 120, shine = true }: { size?: number; shine?: boolean }) {
  const uid = useId().replace(/:/g, '')
  const [photo, setPhoto] = useState(true)
  if (photo) {
    return <img className="medal medal-photo" src={MEDAL_PHOTO} width={size} height={size} alt="" onError={() => setPhoto(false)} />
  }
  return (
    <svg viewBox="0 0 120 150" width={size} height={size * 1.25} className="medal" aria-hidden>
      <defs>
        <radialGradient id={`gold-${uid}`} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#fff4c2" />
          <stop offset="45%" stopColor="#f2c14e" />
          <stop offset="100%" stopColor="#a8740a" />
        </radialGradient>
        <clipPath id={`clip-${uid}`}>
          <circle cx={CX} cy={CY} r={48} />
        </clipPath>
      </defs>
      <polygon points="30,0 56,0 70,52 46,52" fill="#c0352b" />
      <polygon points="64,0 90,0 74,52 50,52" fill="#8f1f18" />
      <circle cx={CX} cy={CY} r={48} fill={`url(#gold-${uid})`} stroke="#9a6a07" strokeWidth={3} />
      <circle cx={CX} cy={CY} r={36} fill="none" stroke="rgba(110, 72, 0, 0.45)" strokeWidth={1.5} />
      {leaves(1)}
      {leaves(-1)}
      <text x={CX} y={CY + 8} textAnchor="middle" fontSize={22} fontWeight={900} fill="#6b4500">
        1996
      </text>
      {shine && (
        <g clipPath={`url(#clip-${uid})`}>
          <g transform={`rotate(20 ${CX} ${CY})`}>
            <rect className="medal-shine" x={-40} y={20} width={22} height={160} fill="rgba(255, 255, 255, 0.5)" />
          </g>
        </g>
      )}
    </svg>
  )
}

/** The hero's Nobel card: the medal, the prize and the idea in one line. */
export function NobelBadge() {
  return (
    <motion.div
      className="nobel-badge"
      initial={{ opacity: 0, y: -24, rotate: -4 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ delay: 0.25, type: 'spring', stiffness: 140, damping: 14 }}
    >
      <Medal size={96} />
      <div>
        <div className="nobel-kicker">Nobel Ekonomi Ödülü · 1996</div>
        <div className="nobel-name">William Vickrey</div>
        <div className="nobel-idea">Kazanan, ikinci en yüksek teklifi öder.</div>
      </div>
    </motion.div>
  )
}
