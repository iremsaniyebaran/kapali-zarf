import type { ChainEvent, StageEvent } from '../stage'

/** Gap between events that landed in the same block. Three reveals usually share a block; played
 * back to back, all three envelopes would open in one frame and nobody would see it. The elapsed
 * time on screen comes from block numbers, so the spacing does not distort it. */
export const SAME_BLOCK_GAP_MS = 350

/** Queues events and plays them in order, spacing out the ones that share a block. */
export function createPlayer(dispatch: (e: StageEvent) => void) {
  const queue: StageEvent[] = []
  let lastBlock: bigint | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const spaced = (e: StageEvent): e is ChainEvent =>
    e.type !== 'Head' && e.type !== 'Snapshot' && e.type !== 'Reset'

  const pump = () => {
    timer = undefined
    while (queue.length > 0 && !stopped) {
      const e = queue.shift()!
      dispatch(e)
      if (spaced(e)) lastBlock = e.block
      const next = queue[0]
      if (next && spaced(next) && next.block === lastBlock) {
        timer = setTimeout(pump, SAME_BLOCK_GAP_MS)
        return
      }
    }
  }

  return {
    push(e: StageEvent) {
      queue.push(e)
      if (!timer) pump()
    },
    /** Replays without spacing (restore after a reload). */
    replay(events: StageEvent[]) {
      for (const e of events) dispatch(e)
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
