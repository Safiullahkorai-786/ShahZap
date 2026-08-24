// Copies the Cloudflare static-asset header rules into the build output.
// Runs between `opennextjs-cloudflare build` and `deploy` (see package.json).
import { copyFileSync, existsSync } from 'node:fs'

const src = new URL('../cf/_headers', import.meta.url)
const dest = '.open-next/assets/_headers'

if (!existsSync('.open-next/assets')) {
  console.error('cf-cache: .open-next/assets missing — run opennextjs-cloudflare build first.')
  process.exit(1)
}
copyFileSync(src, dest)
console.log('cf-cache: _headers installed into .open-next/assets/')
