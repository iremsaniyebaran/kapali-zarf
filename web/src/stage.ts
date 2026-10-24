import { useReducer } from 'react'
import type { Address, Hash } from 'viem'

// One reducer drives the whole page. Two sources feed it the same events: the chain (useChainFeed)
// and a timed script (useMockFeed, ?mock=1).

type Meta = { block: bigint; tx?: Hash }

export type ChainEvent =
  | (Meta & { type: 'PriceUpdated'; price: bigint })
  | (Meta & { type: 'ClassicLiquidated'; borrower: Address; liquidator: Address; price: bigint; debtRepaid: bigint; refund: bigint })
  | (Meta & {
      type: 'AuctionStarted'
      id: Hash
      borrower: Address
      collateral: bigint
      debt: bigint
      value: bigint
      reservePrice: bigint
      commitEnd: bigint
      revealEnd: bigint
    })
  | (Meta & { type: 'BidCommitted'; id: Hash; bidder: Address })
  | (Meta & { type: 'BidRevealed'; id: Hash; bidder: Address; amount: bigint })
  | (Meta & { type: 'AuctionSettled'; id: Hash; winner: Address; price: bigint; debtRepaid: bigint; refund: bigint })
  | (Meta & { type: 'NoBids'; id: Hash })
  | (Meta & { type: 'FallbackLiquidated'; id: Hash; liquidator: Address; price: bigint; refund: bigint })

export interface Position {
  collateral: bigint
  debt: bigint
}

export type StageEvent =
  | ChainEvent
  | { type: 'Head'; block: bigint }
  | { type: 'Snapshot'; price: bigint; klasik: Position; zarf: Position }
  | { type: 'Reset'; price: bigint }

export interface Bid {
  bidder: Address
  revealed: boolean
  amount?: bigint
  tx?: Hash
}

export interface AuctionView {
  id: Hash
  value: bigint
  reservePrice: bigint
  debt: bigint
  commitEnd: bigint
  revealEnd: bigint
  block: bigint
  tx?: Hash
  bids: Bid[]
  noBids: boolean
  result?: { kind: 'settled' | 'fallback'; winner: Address; price: bigint; refund: bigint; block: bigint; tx?: Hash }
}

export interface StageState {
  price: bigint
  head: bigint
  klasik: Position & { refund?: bigint }
  zarf: Position & { refund?: bigint }
  drop?: { block: bigint; tx?: Hash; from: bigint }
  classic?: { liquidator: Address; price: bigint; refund: bigint; block: bigint; tx?: Hash }
  auction?: AuctionView
}

export const ONE = 10n ** 18n
export const DEMO_POSITION: Position = { collateral: ONE, debt: 800n * ONE }
export const LIQ_THRESHOLD_BPS = 8_500n

export const initialStage: StageState = {
  price: 1000n * ONE,
  head: 0n,
  klasik: DEMO_POSITION,
  zarf: DEMO_POSITION,
}

export function reduce(s: StageState, e: StageEvent): StageState {
  switch (e.type) {
    case 'Head':
      return e.block > s.head ? { ...s, head: e.block } : s
    case 'Reset':
      return { ...initialStage, price: e.price }
    case 'Snapshot':
      // A position liquidated in this round reads as zero on chain; keep the refund the events showed.
      return {
        ...s,
        price: e.price,
        klasik: s.klasik.refund !== undefined ? s.klasik : e.klasik,
        zarf: s.zarf.refund !== undefined ? s.zarf : e.zarf,
      }
    case 'PriceUpdated': {
      const head = e.block > s.head ? e.block : s.head
      if (e.price === s.price) return { ...s, head }
      // Price going back up is the reset before a rehearsal: clear both columns.
      if (e.price > s.price) return { ...initialStage, price: e.price, head }
      return { ...s, price: e.price, head, drop: { block: e.block, tx: e.tx, from: s.price } }
    }
    case 'ClassicLiquidated':
      return {
        ...s,
        klasik: { collateral: 0n, debt: 0n, refund: e.refund },
        classic: { liquidator: e.liquidator, price: e.price, refund: e.refund, block: e.block, tx: e.tx },
      }
    case 'AuctionStarted':
      return {
        ...s,
        auction: {
          id: e.id,
          value: e.value,
          reservePrice: e.reservePrice,
          debt: e.debt,
          commitEnd: e.commitEnd,
          revealEnd: e.revealEnd,
          block: e.block,
          tx: e.tx,
          bids: [],
          noBids: false,
        },
      }
    case 'BidCommitted': {
      const a = s.auction
      if (!a || a.id !== e.id || a.bids.some((b) => b.bidder === e.bidder)) return s
      return { ...s, auction: { ...a, bids: [...a.bids, { bidder: e.bidder, revealed: false, tx: e.tx }] } }
    }
    case 'BidRevealed': {
      const a = s.auction
      if (!a || a.id !== e.id) return s
      const known = a.bids.some((b) => b.bidder === e.bidder)
      const bids = known
        ? a.bids.map((b) => (b.bidder === e.bidder ? { ...b, revealed: true, amount: e.amount, tx: e.tx } : b))
        : [...a.bids, { bidder: e.bidder, revealed: true, amount: e.amount, tx: e.tx }]
      return { ...s, auction: { ...a, bids } }
    }
    case 'AuctionSettled': {
      const a = s.auction
      if (!a || a.id !== e.id) return s
      return {
        ...s,
        zarf: { collateral: 0n, debt: 0n, refund: e.refund },
        auction: { ...a, result: { kind: 'settled', winner: e.winner, price: e.price, refund: e.refund, block: e.block, tx: e.tx } },
      }
    }
    case 'NoBids':
      return s.auction?.id === e.id ? { ...s, auction: { ...s.auction, noBids: true } } : s
    default:
      return s
    case 'FallbackLiquidated': {
      const a = s.auction
      if (!a || a.id !== e.id) return s
      return {
        ...s,
        zarf: { collateral: 0n, debt: 0n, refund: e.refund },
        auction: { ...a, result: { kind: 'fallback', winner: e.liquidator, price: e.price, refund: e.refund, block: e.block, tx: e.tx } },
      }
    }
  }
}

export function useStage() {
  return useReducer(reduce, initialStage)
}

// ---------------------------------------------------------------------------
// Derived numbers. Everything on screen comes from events; nothing is hard-coded.
// ---------------------------------------------------------------------------

export const valueOf = (p: Position, price: bigint) => (p.collateral * price) / ONE

/** Health factor as a float; Infinity without debt. Below 1 the position is liquidatable. */
export function healthOf(p: Position, price: bigint): number {
  if (p.debt === 0n) return Infinity
  return Number((valueOf(p, price) * LIQ_THRESHOLD_BPS) / p.debt) / 10_000
}

export type Phase = 'idle' | 'commit' | 'reveal' | 'settling' | 'noBids' | 'done'

export function phaseOf(a: AuctionView | undefined, head: bigint): Phase {
  if (!a) return 'idle'
  if (a.result) return 'done'
  if (a.noBids) return 'noBids'
  if (head <= a.commitEnd) return 'commit'
  if (head <= a.revealEnd) return 'reveal'
  return 'settling'
}

/** The second-highest revealed bid: what the winner pays, unless it is below the reserve. */
export function secondBid(a: AuctionView): Bid | undefined {
  const revealed = a.bids.filter((b) => b.revealed && b.amount !== undefined)
  const sorted = [...revealed].sort((x, y) => (y.amount! > x.amount! ? 1 : y.amount! < x.amount! ? -1 : 0))
  return sorted[1]
}
