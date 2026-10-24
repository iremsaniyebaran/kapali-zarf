import type { Abi, Address } from 'viem'
import KapaliZarfAbi from '../../shared/abi/KapaliZarf.json'
import LendingPoolAbi from '../../shared/abi/LendingPool.json'
import MockOracleAbi from '../../shared/abi/MockOracle.json'

/** shared/addresses.json as written by script/Deploy.s.sol and kept current by npm run reset. */
export interface Addresses {
  chainId: number
  usd: Address
  weth: Address
  oracle: Address
  pool: Address
  zarf: Address
  owner: Address
  elifKlasik: Address
  elifZarf: Address
  bots: { a: Address; b: Address; c: Address; fast: Address; guest?: Address }
  commitBlocks: number
  revealBlocks: number
  deployBlock: number
}

const env = import.meta.env
const params = new URLSearchParams(window.location.search)

export const CHAIN_ID = Number(params.get('chain') ?? env.VITE_CHAIN_ID ?? 10143)
export const MOCK = params.get('mock') === '1'
// Use a different endpoint than the bots: the public RPC allows ~25 requests per second.
export const RPC_URL: string = env.VITE_RPC_URL ?? (CHAIN_ID === 31337 ? 'http://127.0.0.1:8545' : 'https://testnet-rpc.monad.xyz')
export const WSS_URL: string = env.VITE_WSS_URL ?? RPC_URL.replace(/^http/, 'ws')
export const DROP_URL: string = env.VITE_DROP_URL ?? 'http://localhost:8787'
export const EXPLORER_TX_URL: string = env.VITE_EXPLORER_TX_URL ?? 'https://testnet.monadvision.com/tx/'
/** Block time measured on Monad testnet (Oct 24, 2026): 17 blocks in 5.3 s and 10 blocks in 3.1 s.
 * Elapsed time is computed from block counts, not timestamps. */
export const BLOCK_SECONDS = Number(env.VITE_BLOCK_SECONDS ?? 0.31)

const files = import.meta.glob<Addresses>('../../shared/addresses*.json', { eager: true, import: 'default' })
const file = CHAIN_ID === 10143 ? '../../shared/addresses.json' : `../../shared/addresses.${CHAIN_ID}.json`
export const ADDRESSES: Addresses | undefined = files[file]

export const ABI = [...(MockOracleAbi as Abi), ...(LendingPoolAbi as Abi), ...(KapaliZarfAbi as Abi)] as Abi
export const POOL_ABI = LendingPoolAbi as Abi
export const ZARF_ABI = KapaliZarfAbi as Abi
export const ORACLE_ABI = MockOracleAbi as Abi

// Placeholder addresses for ?mock=1 when no deployment file exists yet.
const MOCK_ADDRESSES: Addresses = {
  chainId: CHAIN_ID,
  usd: '0x0000000000000000000000000000000000000001',
  weth: '0x0000000000000000000000000000000000000002',
  oracle: '0x0000000000000000000000000000000000000003',
  pool: '0x0000000000000000000000000000000000000004',
  zarf: '0x0000000000000000000000000000000000000005',
  owner: '0x00000000000000000000000000000000000000a0',
  elifKlasik: '0x00000000000000000000000000000000000000e1',
  elifZarf: '0x00000000000000000000000000000000000000e2',
  bots: {
    a: '0x00000000000000000000000000000000000000ba',
    b: '0x00000000000000000000000000000000000000bb',
    c: '0x00000000000000000000000000000000000000bc',
    fast: '0x00000000000000000000000000000000000000f0',
    guest: '0x00000000000000000000000000000000000000ee',
  },
  commitBlocks: 8,
  revealBlocks: 8,
  deployBlock: 0,
}

export const DEMO = ADDRESSES ?? MOCK_ADDRESSES
/** The presenter's bidder ("Sen"). An address file from before the guest wallet existed has none;
 * npm run reset adds it. Mock rounds then use the placeholder. */
export const GUEST: Address = DEMO.bots.guest ?? MOCK_ADDRESSES.bots.guest!

export function nameOf(address: Address | undefined): string {
  if (!address) return '?'
  const a = address.toLowerCase()
  const names: [Address, string][] = [
    [DEMO.bots.a, 'Bot A'],
    [DEMO.bots.b, 'Bot B'],
    [DEMO.bots.c, 'Bot C'],
    [DEMO.bots.fast, 'Hızlı Bot'],
    [GUEST, 'Sen'],
    [DEMO.elifKlasik, 'Elif'],
    [DEMO.elifZarf, 'Elif'],
  ]
  return names.find(([addr]) => addr.toLowerCase() === a)?.[1] ?? `${address.slice(0, 6)}…${address.slice(-4)}`
}
