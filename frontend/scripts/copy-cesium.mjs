// Copy CesiumJS runtime assets (workers, assets, widgets, third-party) into public/cesium.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const src = join(dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium')
const dst = join(process.cwd(), 'public', 'cesium')
if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
for (const d of ['Workers', 'ThirdParty', 'Assets', 'Widgets']) cpSync(join(src, d), join(dst, d), { recursive: true })
console.log('cesium assets →', dst)
