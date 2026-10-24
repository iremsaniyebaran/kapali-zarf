import { forwardRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { phaseOf, secondBid, type StageState } from '../stage'
import { nameOf } from '../config'
import { seconds, txUrl, usd } from '../format'
import { Envelope } from './Envelope'
import { Seal } from './Seal'

type Props = Pick<StageState, 'auction' | 'head' | 'drop'>

const PHASE_TEXT = {
  idle: '',
  commit: 'Teklifler mühürleniyor',
  reveal: 'Zarflar açılıyor',
  settling: 'Sonuçlanıyor',
  noBids: 'Teklif gelmedi',
  done: 'Sonuçlandı',
}

export const AuctionColumn = forwardRef<HTMLDivElement, Props>(function AuctionColumn({ auction, head, drop }, resultRef) {
  const phase = phaseOf(auction, head)

  if (!auction) {
    return (
      <div className="column-body">
        <p className="idle">
          {drop ? 'Açık artırma başlatılıyor…' : 'Fiyat düşünce teminat birkaç bloğluk kapalı zarf açık artırmasına girer.'}
        </p>
      </div>
    )
  }

  const left = phase === 'commit' ? auction.commitEnd - head : phase === 'reveal' ? auction.revealEnd - head : 0n
  const total = BigInt(phase === 'commit' ? auction.commitEnd - auction.block : auction.revealEnd - auction.commitEnd)
  const progress = total > 0n ? 1 - Number(left < 0n ? 0n : left) / Number(total) : 1
  const second = secondBid(auction)
  const result = auction.result
  const elapsed = result && drop ? result.block - drop.block : undefined

  return (
    <div className="column-body">
      <div className="auction-rules">
        <span>Taban <strong>{usd(auction.reservePrice)}</strong> <span className="muted">= klasik fiyat</span></span>
        <span>Tavan <strong>{usd(auction.value)}</strong></span>
      </div>

      {phase !== 'done' && <div className={`phase phase-${phase}`}>
        <span className="phase-name">{PHASE_TEXT[phase]}</span>
        {(phase === 'commit' || phase === 'reveal') && (
          <span className="phase-count">
            {left > 0n ? `${left} blok` : 'son blok'} <span className="muted">{seconds(left > 0n ? left : 0n)}</span>
          </span>
        )}
        {(phase === 'commit' || phase === 'reveal') && (
          <div className="phase-track">
            <motion.div className="phase-fill" animate={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} transition={{ duration: 0.35 }} />
          </div>
        )}
      </div>}

      <div className="envelopes">
        <AnimatePresence>
          {auction.bids.map((bid, i) => (
            <Envelope
              key={bid.bidder}
              bid={bid}
              index={i}
              winner={result?.kind === 'settled' && result.winner === bid.bidder}
              priceSetter={second?.bidder === bid.bidder && result?.kind === 'settled' && result.price === bid.amount}
              settled={!!result}
            />
          ))}
        </AnimatePresence>
        {auction.bids.length === 0 && phase === 'commit' && <p className="idle small">Botların zarfları bekleniyor…</p>}
      </div>

      <AnimatePresence>
        {phase === 'noBids' && !result && (
          <motion.p className="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            Teklif gelmedi; taban fiyattan likide ediliyor…
          </motion.p>
        )}
        {result && (
          <motion.div key="result" className="auction-result" ref={resultRef} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
            <div className="result-lines">
            {result.kind === 'settled' ? (
              <>
                <div className="result-line">
                  Kazanan <strong>{nameOf(result.winner)}</strong>
                </div>
                <div className="result-line">
                  Ödenen: <strong>ikinci teklif {usd(result.price)}</strong>
                  {second === undefined && <span className="muted"> (tek teklif: taban)</span>}
                </div>
              </>
            ) : (
              <div className="result-line">Teklif gelmedi, taban fiyattan likide edildi: <strong>{usd(result.price)}</strong></div>
            )}
            <div className="result-meta">
              {elapsed !== undefined && `${elapsed} blok, ${seconds(elapsed)}`}
              {result.tx && (
                <a className="tx-link" href={txUrl(result.tx)} target="_blank" rel="noreferrer">
                  explorer ↗
                </a>
              )}
            </div>
            </div>
            <div className="refund refund-good">
              <span>Elif’e dönen</span>
              <strong>{usd(result.refund)}</strong>
            </div>
            <Seal />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
