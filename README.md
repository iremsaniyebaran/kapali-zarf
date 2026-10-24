# Kapalı Zarf

Likidasyonda teminatın en hızlı bota değil, en iyi teklife gittiği; aradaki paranın borçluya döndüğü
kapalı zarf (Vickrey) likidasyon açık artırması. Monad Blitz Ankara v4.

## İçindekiler

| Yol | Ne |
| --- | --- |
| `src/` | MockUSD, MockWETH, MockOracle, LendingPool, KapaliZarf |
| `test/KapaliZarf.t.sol` | 35 test (fuzz dahil) |
| `script/Deploy.s.sol` | Beş kontratı deploy eder, `deployments/<chainId>.json` yazar |
| `bots/wallets.mjs` | Altı demo cüzdanını üretip `.env`'e ekler |
| `bots/reset.mjs` | Demoyu başlangıç durumuna getirir; her provadan önce |
| `bots/run.mjs` | Bot A, B, C ve Hızlı Bot |
| `bots/drop.mjs` | Fiyatı düşürür (sahnedeki butonun yedeği) |

## Kurulum

Gerekenler: Foundry, Node 18+.

```bash
npm install
forge build
forge test
```

`.env.example` dosyasını `.env` olarak kopyalayın, sonra:

1. `MONAD_TESTNET_RPC`: kendi RPC anahtarınız (public RPC'ye güvenmeyin).
2. `DEPLOYER_PK`: faucet'ten MON aldığınız cüzdan. Kontratların sahibi olur, fiyatı değiştirir ve
   diğer cüzdanlara gas için MON gönderir. Monad, bakiyeyi yaklaşık 10 MON'un altına düşüren MON
   transferlerini geri çevirebilir; bu cüzdanda en az 15 MON tutun.
3. Altı demo cüzdanı:

```bash
npm run wallets
```

## Deploy

```bash
npm run deploy
```

`deployments/10143.json` yazılır. Pencereler varsayılan olarak 3 blok teklif + 3 blok açıklama
(Monad'da yaklaşık 2,5 saniye). Botlar pencereye yetişemezse `.env`'de `COMMIT_BLOCKS=5` ve
`REVEAL_BLOCKS=5` yapıp yeniden deploy edin.

## Her provada

```bash
npm run reset
npm run bots
```

`reset`: fiyatı 1000'e çeker, cüzdanlara gerekirse gas gönderir, botların bakiyesini yükler,
yarım kalmış açık artırmayı kapatır ve iki aynı pozisyonu açar (1 mWETH teminat, 800 mUSD borç).
`bots` açık kalır. Sonra sahnedeki "ETH %10 düştü" butonuna basın ya da:

```bash
npm run drop
```

Beklenen bot çıktısı (yerel Anvil'de 1 saniyelik bloklarla denendi):

```text
KLASİK: Hızlı Bot sabit indirimle aldı. Ödenen 810, Elif'e dönen 10 (1,0 sn)
Bot A: zarf açıldı, teklif 890
Bot B: zarf açıldı, teklif 885
Bot C: zarf açıldı, teklif 870
KAPALI ZARF: kazanan Bot A, ödenen ikinci fiyat 885, Elif'e dönen 85 (9,0 sn)
```

Fiyatı geri almak için `npm run drop -- 1000`.

## Sahne sayfası için

`reset` her çalıştığında `deployments/<chainId>.frontend.json` yazar: kontrat adresleri, ABI'ler,
ElifKlasik / ElifZarf / bot adresleri ve parametreler. Sayfanın dinleyeceği event'ler:
`ClassicLiquidated`, `LiquidationAuctionStarted` (LendingPool); `AuctionStarted`, `BidCommitted`,
`BidRevealed`, `AuctionSettled`, `NoBids`, `FallbackLiquidated` (KapaliZarf).

## Ayarlar (.env)

| Değişken | Varsayılan | Ne işe yarar |
| --- | --- | --- |
| `COMMIT_BLOCKS`, `REVEAL_BLOCKS` | 3, 3 | Deploy anında pencere uzunlukları |
| `POLL_MS` | 200 | Botların zinciri sorgulama aralığı |
| `DROP_PRICE` | 900 | `npm run drop`'un varsayılan fiyatı |
| `EXPLORER_TX_URL` | `https://testnet.monadscan.com/tx/` | Loglardaki işlem linkleri |
| `MIN_GAS_MON`, `GAS_TOPUP_MON` | 0,3, 0,5 | Bu bakiyenin altındaki cüzdana bu kadar MON gönderilir |
| `OWNER_RESERVE_MON` | 10 | Owner'ın altına düşmeyeceği MON bakiyesi |
| `RPC_URL` | `MONAD_TESTNET_RPC` | Başka bir zincirde (örneğin Anvil) denemek için |
| `ENV_FILE` | `.env` | Script'lerin okuyacağı env dosyası |

## Gas limitleri

`bots/config.mjs` içinde sabit; Foundry testlerinde ölçülen en kötü durum + %20. Monad'da bazı
işlemler farklı fiyatlanabilir; deploy'dan sonra bir kez `cast estimate` ile ölçüp gerekirse güncelleyin.

| Fonksiyon | Limit |
| --- | --- |
| startAuction | 345.000 |
| commit | 145.000 |
| reveal | 150.000 |
| settle (8 teklif veren) | 340.000 |
| liquidateClassic | 135.000 |
| fallbackLiquidate | 240.000 |

## Yerelde denemek (Anvil)

```bash
anvil --block-time 1
```

Ayrı bir `.env.anvil` dosyasına `RPC_URL=http://127.0.0.1:8545` ve Anvil'in gösterdiği yedi anahtarı
koyun, sonra:

```bash
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
ENV_FILE=.env.anvil npm run reset
ENV_FILE=.env.anvil npm run bots
ENV_FILE=.env.anvil npm run drop
```

`forge script` anahtarı `DEPLOYER_PK` ortam değişkeninden okur.

## Notlar

- MockUSD ve MockWETH'i herkes mint edebilir: sadece testnet içindir.
- `KapaliZarf.RESERVE_BPS` (9000) ile `LendingPool.CLASSIC_DISCOUNT_BPS` (1000) birbirine bağlıdır;
  taban fiyatın klasik fiyata eşit olması bunu gerektirir.
- Demo modeli basitleştirilmiştir: likidasyonda teminatın tamamı satılır, kısmi likidasyon yoktur.
