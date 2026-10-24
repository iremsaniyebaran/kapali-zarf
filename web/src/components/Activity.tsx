import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ChainEvent } from '../stage'
import { nameOf } from '../config'
import { seconds, txUrl, usd } from '../format'
import type { Step } from '../feeds/player'

export interface Round {
  key: string
  at: number
  mode: 'live' | 'mock'
  dropTo: bigint
  classicRefund?: bigint
  zarfRefund?: bigint
  classicShortfall: bigint
  zarfShortfall: bigint
  winner?: string
  price?: bigint
  fallback: boolean
  blocks?: bigint
  script: Step[]
}

function describe(e: ChainEvent): { text: string; tone?: 'bad' | 'good' | 'gold' } {
  switch (e.type) {
    case 'PriceUpdated':
      return { text: `ETH fiyatı ${usd(e.price)}`, tone: 'bad' }
    case 'ClassicLiquidated':
      return { text: `${nameOf(e.liquidator)} klasik likidasyon: ${usd(e.price)} ödedi, Elif’e ${usd(e.refund)}`, tone: 'bad' }
    case 'AuctionStarted':
      return { text: `Açık artırma başladı · taban ${usd(e.reservePrice)}, teklif ≤ blok ${e.commitEnd}`, tone: 'gold' }
    case 'BidCommitted':
      return { text: `${nameOf(e.bidder)} mühürlü teklif verdi` }
    case 'BidRevealed':
      return { text: `${nameOf(e.bidder)} zarfını açtı: ${usd(e.amount)}` }
    case 'AuctionSettled':
      return { text: `${nameOf(e.winner)} kazandı, ${usd(e.price)} ödedi · Elif’e ${usd(e.refund)}`, tone: 'good' }
    case 'NoBids':
      return { text: 'Geçerli teklif gelmedi', tone: 'gold' }
    case 'FallbackLiquidated':
      return { text: `${nameOf(e.liquidator)} taban fiyattan aldı: ${usd(e.price)} · Elif’e ${usd(e.refund)}` }
  }
}

interface Props {
  feed: ChainEvent[]
  rounds: Round[]
  replaying: boolean
  onReplay: (round: Round) => void
  onClearHistory: () => void
}

/** Live event feed and the table of finished rounds, each of which can be replayed in slow motion. */
export function Activity({ feed, rounds, replaying, onReplay, onClearHistory }: Props) {
  const [tab, setTab] = useState<'feed' | 'history'>('feed')
  return (
    <div className="activity">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'feed'} className={tab === 'feed' ? 'active' : ''} onClick={() => setTab('feed')}>
          Canlı akış <span className="count">{feed.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          Geçmiş <span className="count">{rounds.length}</span>
        </button>
      </div>

      {tab === 'feed' ? (
        <ol className="feed">
          {feed.length === 0 && <li className="muted empty">Fiyat düşünce zincirdeki her olay burada blok numarasıyla akar.</li>}
          <AnimatePresence initial={false}>
            {[...feed].reverse().map((e) => {
              const d = describe(e)
              return (
                <motion.li
                  key={`${e.tx ?? ''}:${e.type}:${'bidder' in e ? e.bidder : ''}:${e.block}`}
                  className={`feed-item ${d.tone ?? ''}`}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  layout
                >
                  <span className="feed-block">#{e.block.toString().slice(-4)}</span>
                  <span className="feed-text">{d.text}</span>
                  {e.tx && (
                    <a href={txUrl(e.tx)} target="_blank" rel="noreferrer" aria-label="explorer">
                      ↗
                    </a>
                  )}
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ol>
      ) : (
        <div className="history">
          {rounds.length === 0 ? (
            <p className="muted empty">Biten her tur burada kalır; ▶ ile yavaş çekimde tekrar oynatılır.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Tur</th>
                  <th>ETH</th>
                  <th>Klasik</th>
                  <th>Zarf</th>
                  <th>Fark</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rounds.map((r, i) => {
                  const diff = r.zarfRefund !== undefined && r.classicRefund !== undefined ? r.zarfRefund - r.classicRefund : undefined
                  return (
                    <tr key={r.key}>
                      <td>
                        {rounds.length - i}
                        <span className={`mode-dot ${r.mode}`} title={r.mode === 'live' ? 'canlı zincir' : 'kayıt modu'} />
                      </td>
                      <td>{usd(r.dropTo)}</td>
                      <td className="bad">{r.classicRefund !== undefined ? usd(r.classicRefund) : '—'}</td>
                      <td className="good">
                        {r.zarfRefund !== undefined ? usd(r.zarfRefund) : '—'}
                        {r.fallback && <span className="muted"> (yedek)</span>}
                      </td>
                      <td>
                        <strong>{diff !== undefined ? `${diff >= 0n ? '+' : '−'}${usd(diff >= 0n ? diff : -diff)}` : '—'}</strong>
                        {r.blocks !== undefined && <div className="muted small">{seconds(r.blocks)}</div>}
                      </td>
                      <td>
                        <button className="icon-button" onClick={() => onReplay(r)} disabled={replaying || r.script.length === 0} title="Yavaş çekimde tekrar oynat">
                          ▶
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {rounds.length > 0 && (
            <button className="ghost-button small" onClick={onClearHistory}>
              Geçmişi temizle
            </button>
          )}
        </div>
      )}
    </div>
  )
}
