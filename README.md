# Kapalı Zarf

Likidasyonda teminatın en hızlı bota değil, en iyi teklife gittiği; aradaki paranın borçluya döndüğü
kapalı zarf (Vickrey) likidasyon açık artırması. Monad Blitz Ankara v4.

## İçindekiler

| Yol | Ne |
| --- | --- |
| `src/` | MockUSD, MockWETH, MockOracle, LendingPool, KapaliZarf, Split |
| `test/` | `LendingPool.t.sol`, `KapaliZarf.t.sol` (ortak kurulum `Base.t.sol`), 39 test, fuzz dahil |
| `script/Deploy.s.sol` | Beş kontratı deploy eder, `shared/addresses.json` yazar |
| `shared/` | A ile B arasındaki tek sözleşme: `addresses.json` ve `abi/` |
| `bots/wallets.mjs` | Altı demo cüzdanını üretip `.env`'e ekler |
| `bots/reset.mjs` | Demoyu başlangıç durumuna getirir; her provadan önce |
| `bots/bots.mjs` | Bot A, B, C ve Hızlı Bot; aynı süreçte `localhost:8787` (`/health`, `/drop`, `/reset`) |
| `bots/ws.mjs` | `monadLogs` / `monadNewHeads` aboneliği, düşerse HTTP yoklama |
| `bots/drop.mjs` | Fiyatı düşürür (sahnedeki butonun terminal yedeği) |
| `web/` | Sahne sayfası (Vite + React + viem + framer-motion) |

## Kurulum

Gerekenler: Foundry, Node 22+.

```bash
npm install
npm --prefix web install
forge build
forge test
```

`.env.example` dosyasını `.env` olarak kopyalayın, sonra:

1. `MONAD_TESTNET_RPC` ve `MONAD_TESTNET_WSS`: kendi RPC anahtarınız. Public uçlar saniyede 20–25
   istekle sınırlı; botlar ve sahne sayfası farklı uçları kullansın.
2. `DEPLOYER_PK` (OWNER): faucet'ten MON aldığınız cüzdan. Kontratların sahibi olur, fiyatı değiştirir ve
   diğer cüzdanlara gas için MON gönderir. Monad, bakiyeyi yaklaşık 10 MON'un altına düşüren MON
   transferlerini geri çevirebilir; bu cüzdanda en az 15 MON tutun.
3. Altı demo cüzdanı (`reset` her birine en az 1 MON koyar):

```bash
npm run wallets
```

## Deploy

```bash
npm run deploy
```

Monad testnet'te `shared/addresses.json`, başka zincirlerde `shared/addresses.<chainId>.json` yazılır ve
ABI'ler `shared/abi/`'ye kopyalanır. Biçim:
`{ chainId, usd, weth, oracle, pool, zarf, owner, elifKlasik, elifZarf, bots: { a, b, c, fast }, commitBlocks, revealBlocks, deployBlock }`.

Pencereler varsayılan olarak 8 blok teklif + 8 blok açıklama (≈ 6,4 sn). İlk canlı turda botların
logundaki "+N blok" değerlerine bakıp `.env`'de `COMMIT_BLOCKS` / `REVEAL_BLOCKS`'u 3–5'e indirin ve
yeniden deploy edin. Botlar pencereyi kaçırıyorsa ikisini de 15 yapın.

## Her provada

```bash
npm run reset
npm run bots
npm run web
```

`reset` fiyatı 1000'e çeker, cüzdanlara gerekirse gas gönderir, botların bakiyesini yükler, yarım kalmış
açık artırmayı kapatır ve iki aynı pozisyonu açar (1 mWETH teminat, 800 mUSD borç, sağlık oranı 1,06).
`bots` açık kalır. Sahne sayfasında "ETH %10 düştü" butonuna (ya da Boşluk tuşuna) basın; yedek:

```bash
npm run drop
```

Bot süreci açıkken sayfada `R` tuşu da reset'i çalıştırır. Fiyatı elle geri almak için `npm run drop -- 1000`.

Beklenen bot çıktısı (Anvil, 1 sn bloklar, 8/8 pencere):

```text
→ Owner: ETH → 900 (head 251)
  ✓ Owner: ETH → 900: blok 252, +1 blok, 627 ms
→ Hızlı Bot: liquidateClassic (head 252)
→ Bot A: startAuction (head 252)
KLASİK: Hızlı Bot sabit indirimle aldı. Ödenen 810, Elif'e dönen 10 (1,0 sn)
Açık artırma 0x215be5d2 (ElifZarf): değer 900, taban 810, teklif ≤ blok 261, açıklama ≤ blok 269
Bot A: zarf açıldı, teklif 890 (blok 262)
Bot B: zarf açıldı, teklif 885 (blok 262)
Bot C: zarf açıldı, teklif 870 (blok 262)
KAPALI ZARF: kazanan Bot A, ödenen ikinci fiyat 885, Elif'e dönen 85 (18,2 sn)
```

Her işlem için `→` gönderildiği head'i, `✓` girdiği bloğu ve kaç blok sürdüğünü yazar. Pencereler bu
sayılara göre kısaltılır.

## Botlar nasıl hızlı

- **Erken duymak:** `monadLogs` ve `monadNewHeads` event'leri blok oylanmadan, standart aboneliklerden
  yaklaşık 1 saniye önce verir. Bilmeyen zincirde (Anvil) standart aboneliklere düşer; soket koparsa
  200 ms'de bir `eth_blockNumber` + dar aralıklı `eth_getLogs` ile devam eder.
- **Tek RPC çağrısı:** her işlem yerelde imzalanır (nonce elle, sabit gas limiti, önbellekteki fee) ve
  tek `eth_sendRawTransaction` ile gönderilir. Makbuz beklenmez; sonuç event olarak gelir.
- **Bir blok erken:** reveal'lar zincir `commitEnd`'i gösterdiğinde, settle `revealEnd`'i gösterdiğinde
  gönderilir; işlem en erken bir sonraki bloğa, yani pencerenin ilk bloğuna girer.
- Açılışta bir kez `hashBid` ile yerel hash karşılaştırılır; tutmazsa süreç başlamaz. Salt'lar
  göndermeden önce `bots/state/<id>.json`'a yazılır; süreç yeniden başlarsa açıklamaya devam eder.

## Sahne sayfası

```bash
npm run web          # http://localhost:5173
```

| Adres | Ne |
| --- | --- |
| `/` | Canlı mod: `shared/addresses.json`, `monadLogs` ile gerçek event'ler |
| `/?mock=1` | Kayıt modu: aynı reducer'ı zamanlanmış event'lerle oynatır (geliştirme ve son yedek) |
| `/?chain=31337` | Anvil'e karşı canlı mod |

`web/.env.local` ile: `VITE_RPC_URL`, `VITE_WSS_URL` (botlardan farklı bir uç), `VITE_DROP_URL`
(varsayılan `http://localhost:8787`), `VITE_EXPLORER_TX_URL`, `VITE_CHAIN_ID`.

Ekrandaki her rakam event'ten gelir: fark = `AuctionSettled.refund − ClassicLiquidated.refund`, süre =
blok farkı × 0,4 sn. Aynı bloka düşen event'ler 350 ms arayla oynatılır. Sayfa yenilenirse son 300
bloğun logları ve `positionOf` okumalarıyla durum geri gelir.

Tuşlar: `Boşluk` fiyat düşüşü, `R` reset, `K` son canlı turu `recorded.json` olarak indirir. Bu dosya
`web/src/feeds/recorded.json` olarak kaydedilirse `?mock=1` gerçek provanın birebir kopyasını oynatır.

Vercel: proje kökü `web/`, build `npm run build`, çıktı `dist`. Yine de sahnede sayfayı yerelden açın;
HTTPS sayfanın `localhost`'a erişmesi tarayıcı ayarına bağlı.

## Donan event imzaları

```solidity
event PriceUpdated(uint256 price);
event ClassicLiquidated(address indexed borrower, address indexed liquidator, uint256 price, uint256 debtRepaid, uint256 refund);
event AuctionStarted(bytes32 indexed id, address indexed borrower, uint256 collateral, uint256 debt, uint256 value, uint256 reservePrice, uint64 commitEnd, uint64 revealEnd);
event BidCommitted(bytes32 indexed id, address indexed bidder);
event BidRevealed(bytes32 indexed id, address indexed bidder, uint256 amount);
event AuctionSettled(bytes32 indexed id, address indexed winner, uint256 price, uint256 debtRepaid, uint256 refund);
event NoBids(bytes32 indexed id);
event FallbackLiquidated(bytes32 indexed id, address indexed liquidator, uint256 price, uint256 refund);
```

## Kurallar

- Fiyat düşünce pozisyon klasik yolla (`liquidateClassic`) ya da açık artırmayla (`startAuction`)
  likide edilir; `inAuction` bayrağı ikinci kez likidasyonu engeller.
- Kazanan en yüksek teklifi verendir, ikinci teklifi öder; tek teklifte taban fiyatı öder. Taban = klasik
  fiyat (değerin %90'ı), tavan = teminat değeri. Eşitlikte önce açıklayan kazanır.
- Açıklanmayan teklifin kilidi settle'da açılır, ceza yok.
- `settle` hiçbir durumda revert etmez: fiyat borçtan düşükse eksik kısım havuzda `badDebt` olur.
- Teklif yoksa `NoBids`; herkes taban fiyattan `fallbackLiquidate` edebilir (Bot C yapar).

## Ayarlar (.env)

| Değişken | Varsayılan | Ne işe yarar |
| --- | --- | --- |
| `COMMIT_BLOCKS`, `REVEAL_BLOCKS` | 8, 8 | Deploy anında pencere uzunlukları |
| `MONAD_TESTNET_WSS`, `WS_URL` | RPC'den türetilir | Botların WebSocket ucu |
| `DROP_PORT` | 8787 | Sahne uç noktası |
| `DROP_PRICE` | 900 | `/drop` ve `npm run drop`'un varsayılan fiyatı |
| `PRIORITY_GWEI` | 2 | Fee: son base fee × 2 + bu tip |
| `RPC_RPS` | 12 | Süreç başına HTTP istek sınırı; public uç 15/sn'de "requests limited" döner |
| `EXPLORER_TX_URL` | `https://testnet.monadvision.com/tx/` | Loglardaki işlem linkleri |
| `MIN_GAS_MON`, `GAS_TOPUP_MON` | 1, 1,5 | Bu bakiyenin altındaki cüzdana bu kadar MON gönderilir |
| `OWNER_RESERVE_MON` | 10 | Owner'ın altına düşmeyeceği MON bakiyesi |
| `RPC_URL` | `MONAD_TESTNET_RPC` | Başka bir zincirde (örneğin Anvil) denemek için |
| `ENV_FILE` | `.env` | Script'lerin okuyacağı env dosyası |

## Gas limitleri

Monad'da ücret kullanılan gas'tan değil gas limitinden kesilir; limitler `bots/config.mjs`'te sabit ve
her işlemden bir `eth_estimateGas` turunu kaldırır. Değerler `forge test --gas-report` maksimumu + 21k,
×1,5 (Monad'ın soğuk depolama fiyatları için pay). İlk testnet turundan sonra makbuzlardaki `gasUsed`'a
bakıp sıkılaştırın.

| Fonksiyon | Limit |
| --- | --- |
| setPrice | 80.000 |
| startAuction | 450.000 |
| commit | 215.000 |
| reveal | 220.000 |
| settle (8 teklif veren) | 380.000 |
| liquidateClassic | 195.000 |
| fallbackLiquidate | 340.000 |

## Yerelde denemek (Anvil)

```bash
anvil --block-time 1
```

Ayrı bir `.env.anvil` dosyasına `RPC_URL=http://127.0.0.1:8545`, `WS_URL=ws://127.0.0.1:8545` ve
Anvil'in gösterdiği yedi anahtarı (`DEPLOYER_PK`, `ELIF_KLASIK_PK`, …) koyun, sonra:

```bash
set -a; . ./.env.anvil; set +a
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
ENV_FILE=.env.anvil npm run reset
ENV_FILE=.env.anvil npm run bots
npm run web            # http://localhost:5173/?chain=31337
```

## Notlar

- MockUSD ve MockWETH'i herkes mint edebilir: sadece testnet içindir.
- `KapaliZarf.RESERVE_BPS` (9000) ile `LendingPool.CLASSIC_DISCOUNT_BPS` (1000) birbirine bağlıdır;
  taban fiyatın klasik fiyata eşit olması bunu gerektirir.
- Demo modeli basitleştirilmiştir: likidasyonda teminatın tamamı satılır, kısmi likidasyon yoktur.
