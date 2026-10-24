// Backup for the stage button: the owner moves the ETH price (default 900, or the first argument).
//   npm run drop          -> 900
//   npm run drop -- 1000  -> back to 1000
import { parseUnits } from "viem";
import { DROP_PRICE, fmt, log, read, send, setup, txLink } from "./config.mjs";

const ctx = await setup();
const price = process.argv[2] ? parseUnits(process.argv[2], 18) : DROP_PRICE;
const before = await read(ctx, ctx.contracts.oracle, "price");
const { hash } = await send(ctx, "owner", ctx.contracts.oracle, "setPrice", [price]);
log(`ETH fiyatı ${fmt(before)} → ${fmt(price)}  ${txLink(hash)}`);
