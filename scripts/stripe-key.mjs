// Internal helper: read the Stripe TEST secret key from a local env file
// without printing it. Lines may be `NAME=value`, `NAME value` or `NAME: value`.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

export function stripeTestKey(file = process.env.ZSITE_STRIPE_ENV_FILE ?? "~/zagware/.env") {
  const text = readFileSync(file.replace(/^~(?=\/)/, homedir()), "utf8");
  const keys = [...text.matchAll(/\b((?:sk|rk)_test_[A-Za-z0-9]+)\b/g)].map((m) => m[1]);
  if (keys.length !== 1) throw new Error(`expected exactly one sk_test_/rk_test_ key in ${file}, found ${keys.length}`);
  return keys[0];
}
