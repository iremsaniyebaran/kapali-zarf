import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ADDRESSES, EXPLORER_TX_URL } from '../config'
import { TryVickrey } from './TryVickrey'

const REPO_URL = 'https://github.com/iremsaniyebaran/kapali-zarf'
const EXPLORER_ADDRESS_URL = EXPLORER_TX_URL.replace(/\/tx\/?$/, '/address/')

const reveal = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
  transition: { duration: 0.5, ease: 'easeOut' },
} as const

function Section({ id, kicker, title, children }: { id?: string; kicker: string; title: ReactNode; children: ReactNode }) {
  return (
    <motion.section id={id} className="l-section" {...reveal}>
      <div className="l-kicker">{kicker}</div>
      <h2 className="l-h2">{title}</h2>
      {children}
    </motion.section>
  )
}

/** Three envelopes that seal, then open one after another: the hero illustration. */
function HeroEnvelopes() {
  const bids = [
    { who: 'Bot A', amount: '890 $', win: true },
    { who: 'Bot B', amount: '885 $', second: true },
    { who: 'Bot C', amount: '870 $' },
  ]
  return (
    <div className="hero-envelopes" aria-hidden>
      {bids.map((b, i) => (
        <motion.div
          key={b.who}
          className={`hero-env ${b.win ? 'win' : ''}`}
          initial={{ opacity: 0, y: 40, rotate: (i - 1) * 6 }}
          animate={{ opacity: 1, y: 0, rotate: (i - 1) * 4 }}
          transition={{ delay: 0.2 + i * 0.15, type: 'spring', stiffness: 160, damping: 18 }}
        >
          <div className="hero-env-who">{b.who}</div>
          <div className="hero-env-face">
            <motion.div
              className="hero-env-inner"
              initial={{ rotateY: 0 }}
              animate={{ rotateY: 180 }}
              transition={{ delay: 1.4 + i * 0.35, duration: 0.6 }}
            >
              <div className="hero-env-front">
                <span className="hero-env-wax" />
              </div>
              <div className="hero-env-back">{b.amount}</div>
            </motion.div>
          </div>
          <motion.div className="hero-env-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.8 + i * 0.1 }}>
            {b.win ? 'kazanır' : b.second ? 'fiyatı belirler' : 'kaybeder'}
          </motion.div>
        </motion.div>
      ))}
    </div>
  )
}

export function Landing() {
  const contracts = ADDRESSES
    ? [
        ['KapaliZarf', ADDRESSES.zarf, 'mühürlü teklifler, açıklama, ikinci fiyat, iade'],
        ['LendingPool', ADDRESSES.pool, 'pozisyonlar, klasik likidasyon, açık artırmayı başlatma'],
        ['MockOracle', ADDRESSES.oracle, 'sahnedeki ETH fiyatı'],
        ['MockUSD', ADDRESSES.usd, 'borç token’ı'],
        ['MockWETH', ADDRESSES.weth, 'teminat token’ı'],
      ]
    : []

  return (
    <div className="landing">
      <header className="l-nav">
        <a className="brand" href="/">
          <img className="brand-mark" src="/logo.png" alt="" />
          <span className="brand-name">Kapalı Zarf</span>
        </a>
        <nav>
          <a href="#nasil">Nasıl çalışır</a>
          <a href="#dene">Dene</a>
          <a href="#monad">Neden Monad</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          <a className="l-nav-cta" href="/demo">
            Demoyu aç
          </a>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <motion.div className="l-pill" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            Monad Blitz Ankara · Monad testnet’te canlı
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            Likidasyonda en hızlı bot değil, <span className="hl">en iyi teklif</span> kazanır.
          </motion.h1>
          <motion.p className="hero-lead" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
            Bugün bir borç likide olduğunda teminatı ilk gelen bot sabit indirimle alır, aradaki para botta kalır. Kapalı
            Zarf teminatı birkaç blokluk mühürlü bir açık artırmaya sokar: botlar gerçek değerlerini yazar, kazanan ikinci
            fiyatı öder ve borcun üstündeki her dolar borçluya döner.
          </motion.p>
          <motion.div className="hero-ctas" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <a className="btn-primary" href="/demo">
              Canlı demoyu aç →
            </a>
            <a className="btn-ghost" href="/demo?mock=1">
              Kayıt modunda izle
            </a>
          </motion.div>
          <motion.dl className="hero-stats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
            <div>
              <dt>Elif’e dönen</dt>
              <dd>
                <span className="bad">10 $</span> → <span className="good">85 $</span>
              </dd>
            </div>
            <div>
              <dt>Fiyat düşüşünden sonuca</dt>
              <dd>≈ 3,1 sn</dd>
            </div>
            <div>
              <dt>Blok</dt>
              <dd>10</dd>
            </div>
          </motion.dl>
          <p className="hero-footnote">Rakamlar Monad testnet’te ölçülen bir turdan: 24 Ekim 2026, 4 + 4 blok pencere.</p>
        </div>
        <HeroEnvelopes />
      </section>

      <Section kicker="Sorun" title="Aynı borç, aynı fiyat düşüşü, iki farklı son">
        <p className="l-lead">
          Elif 1 ETH teminatla 800 $ borç almış. ETH 1.000 $’dan 900 $’a düşüyor, pozisyonu likide edilebilir hale geliyor.
        </p>
        <div className="compare">
          <div className="compare-card bad-card">
            <div className="compare-tag">Bugün · klasik likidasyon</div>
            <ol>
              <li>Fiyat düşer, botlar aynı bloğa yarışır.</li>
              <li>En hızlısı teminatın tamamını değerin %90’ına alır: 810 $.</li>
              <li>800 $ borç kapanır, kalanı Elif’e döner.</li>
            </ol>
            <div className="compare-num bad">10 $</div>
            <p className="muted">90 $’lık indirim hıza ödenen ödül olarak botta kalır.</p>
          </div>
          <div className="compare-card good-card">
            <div className="compare-tag">Kapalı Zarf · mühürlü ikinci fiyat</div>
            <ol>
              <li>Teminat birkaç bloğluk açık artırmaya girer.</li>
              <li>Botlar 890, 885, 870 $ teklif mühürler, sonra açar.</li>
              <li>890 kazanır ama ikinci teklifi öder: 885 $.</li>
            </ol>
            <div className="compare-num good">85 $</div>
            <p className="muted">Taban fiyat klasik fiyata eşit: Elif hiçbir zaman bugünkünden az almaz.</p>
          </div>
        </div>
      </Section>

      <Section id="nasil" kicker="Nasıl çalışır" title="Üç adım, birkaç saniye">
        <div className="steps">
          {[
            ['1', 'Mühürle', 'Her bot teklifinin hash’ini zincire yazar ve aynı tutarı (tavan fiyatı) kilitler. Ne tutar ne kilit, teklifi ele verir.'],
            ['2', 'Aç', 'Teklif penceresi kapanınca botlar tutarı ve salt’ı açıklar; kontrat hash’i doğrular. Açıklanmayan teklifin kilidi sonunda açılır.'],
            ['3', 'Sonuçlan', 'En yüksek teklif kazanır, ikinci en yüksek teklifi öder (Vickrey). Borç kapanır, üstü borçluya döner; fiyat borcun altındaysa açık havuza yazılır.'],
          ].map(([n, title, body]) => (
            <div key={n} className="step">
              <div className="step-n">{n}</div>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
        <p className="l-note">
          İkinci fiyat kuralında herkesin en iyi stratejisi gerçek değerini yazmaktır: daha yükseğini yazmak kaybettirebilir,
          daha düşüğü kazanma şansını azaltır ama ödenecek fiyatı değiştirmez. Teklif gelmezse herkes taban fiyattan likide
          edebilir.
        </p>
      </Section>

      <Section id="dene" kicker="Dene" title="Teklifleri sen belirle">
        <p className="l-lead">ETH 900 $, taban 810 $ (klasik fiyat), tavan 900 $. Kaydırıcıları oynat, kimin kazandığını ve Elif’e ne döndüğünü gör.</p>
        <TryVickrey />
      </Section>

      <Section id="monad" kicker="Neden Monad" title="Kapalı zarf, bloklar hızlıysa kullanılabilir">
        <div className="why">
          <div className="why-card">
            <div className="why-num">≈ 0,3 sn</div>
            <p>Monad testnet’te ölçülen blok süresi. 4 blokluk teklif penceresi ≈ 1,2 sn; teklif, açıklama ve sonuç birlikte ≈ 3 sn.</p>
          </div>
          <div className="why-card">
            <div className="why-num">≥ 24 sn</div>
            <p>Ethereum’da aynı iki pencere için alt sınır. Fiyat o sürede yeniden oynar; kapalı zarf likidasyonu pratikte kullanılamaz.</p>
          </div>
          <div className="why-card">
            <div className="why-num">+1 blok</div>
            <p>
              Botlar <code>monadLogs</code> ile olayları blok oylanmadan duyar, işlemleri yerelde imzalayıp tek çağrıyla gönderir. Ölçülen 4 + 4 turunda botların
              bütün işlemleri gönderildikleri bloğun hemen ardından girdi.
            </p>
          </div>
        </div>
      </Section>

      <Section kicker="Kim kazanır" title="Daha adil, daha güvenli bir likidasyon">
        <div className="wins">
          <div>
            <h3>Borçlu</h3>
            <p>Teminatının piyasa değerine yakın bir fiyat alır; örnekte iade 10 $’dan 85 $’a çıkar.</p>
          </div>
          <div>
            <h3>Havuz</h3>
            <p>Sert düşüşte satış fiyatı borcu karşılamazsa açık rekabetle küçülür: ETH 850 $’da kötü borç 35 $’dan 0 $’a iner.</p>
          </div>
          <div>
            <h3>Likidatör</h3>
            <p>Gas savaşı ve sıra kapma yerine fiyatla yarışır. Kaybeden teklifin parası kilidinden çıkar, ceza yok.</p>
          </div>
        </div>
      </Section>

      {contracts.length > 0 && (
        <Section kicker="Zincirde" title="Monad testnet kontratları">
          <div className="contracts">
            {contracts.map(([name, address, what]) => (
              <a key={name} className="contract" href={`${EXPLORER_ADDRESS_URL}${address}`} target="_blank" rel="noreferrer">
                <span className="contract-name">{name}</span>
                <span className="contract-what">{what}</span>
                <code>
                  {address.slice(0, 10)}…{address.slice(-6)} ↗
                </code>
              </a>
            ))}
          </div>
        </Section>
      )}

      <motion.section className="l-final" {...reveal}>
        <h2>Fiyatı düşür, iki likidasyonu yan yana izle.</h2>
        <p>Sahne sayfası botları canlı yönetir: düşüşü seç, stratejileri değiştir, kendi mühürlü teklifini ver.</p>
        <div className="hero-ctas">
          <a className="btn-primary" href="/demo">
            Canlı demoyu aç →
          </a>
          <a className="btn-ghost" href={REPO_URL} target="_blank" rel="noreferrer">
            Kaynak kod ↗
          </a>
        </div>
      </motion.section>

      <footer className="l-footer">
        <span>Kapalı Zarf · Monad Blitz Ankara v4</span>
        <span className="muted">Testnet demosu: Mock token’lar, gerçek para yok.</span>
      </footer>
    </div>
  )
}
