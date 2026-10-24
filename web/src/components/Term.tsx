import type { ReactNode } from 'react'

export const TERMS = {
  health: 'Teminat değeri × 0,85 ÷ borç. 1’in altına düşen pozisyon likide edilebilir: 800 $ borçta eşik ETH ≈ 941 $.',
  reserve: 'Taban fiyat = teminat değerinin %90’ı, yani klasik likidasyonun ödediği fiyat. Elif hiçbir zaman bugünkünden az almaz.',
  cap: 'Tavan = teminatın piyasa değeri. Hiçbir teklif bunun üstüne çıkamaz.',
  sealed: 'Teklif bir hash olarak zincire yazılır: tutar görünmez. Herkes aynı tutarı kilitler, böylece kilit de tutarı ele vermez.',
  second: 'Vickrey kuralı: en yüksek teklif kazanır ama ikinci en yüksek teklifi öder. Bu yüzden herkes gerçek değerini yazar.',
  badDebt: 'Satış fiyatı borcu karşılamazsa eksik kalan kısım havuzun zararıdır (kötü borç).',
  classic: 'Bugünkü model: fiyat düşer düşmez ilk gelen bot teminatın tamamını sabit %10 indirimle alır.',
} as const

/** A term with a dotted underline that explains itself on hover or focus. */
export function Term({ k, children }: { k: keyof typeof TERMS; children: ReactNode }) {
  return (
    <span className="term" tabIndex={0}>
      {children}
      <span className="term-tip" role="tooltip">
        {TERMS[k]}
      </span>
    </span>
  )
}
