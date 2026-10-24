import { formatUnits, type Hash } from 'viem'
import { BLOCK_SECONDS, EXPLORER_TX_URL } from './config'

const tr = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 })

export const usd = (wei: bigint) => `${tr.format(Number(formatUnits(wei, 18)))} $`
export const num = (wei: bigint) => tr.format(Number(formatUnits(wei, 18)))
export const txUrl = (hash: Hash) => `${EXPLORER_TX_URL}${hash}`

/** "≈ 7,2 sn" from a block count: timestamps mislead on Monad, several blocks share a second. */
export const seconds = (blocks: bigint) =>
  `≈ ${(Number(blocks) * BLOCK_SECONDS).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} sn`
