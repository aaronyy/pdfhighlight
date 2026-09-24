import { createReadStream, existsSync, cpSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const PDFJS_ASSETS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const

const MIME: Record<string, string> = {
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/x-font-type1',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.icc': 'application/vnd.iccprofile',
}

function pdfjsAssets(): Plugin {
  const root = resolve('node_modules/pdfjs-dist')
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        const prefix = '/pdfhighlight/'
        if (!url.startsWith(prefix)) return next()
        const rest = url.slice(prefix.length)
        const name = PDFJS_ASSETS.find((dir) => rest === dir || rest.startsWith(`${dir}/`))
        if (!name) return next()
        const file = resolve(root, rest)
        if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
          return next()
        }
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      for (const name of PDFJS_ASSETS) {
        cpSync(resolve(root, name), resolve('dist', name), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  base: '/pdfhighlight/',
  plugins: [pdfjsAssets()],
})
