import fs from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { CatToon, type CatCoat, type CatPose } from '../src/CatToon.tsx'
// The wall is zero-dependency and cannot import React, so it gets the cats as static SVG files.
// Run after changing CatToon: npm run export-wall -w @kennko/cats
const out = new URL('../../../wall/public/brand/cats', import.meta.url).pathname
fs.mkdirSync(out, { recursive: true })
const COLORS: Record<string, string> = { '--ink': '#0d1b3d', '--white': '#ffffff', '--plate-pink': '#f77293' }
const cats: [string, CatCoat, CatPose][] = [
  ['peek-ginger', 'ginger', 'peek'], ['wave-tuxedo', 'tuxedo', 'wave'], ['nap-calico', 'calico', 'nap'],
  ['sit-cream', 'cream', 'sit'], ['peek-tabby', 'tabby', 'peek'],
]
for (const [name, coat, pose] of cats) {
  let svg = renderToStaticMarkup(createElement(CatToon, { coat, pose }))
  svg = svg.replace(/var\((--[a-z-]+)\)/g, (_, v) => { if (!COLORS[v]) throw new Error('unmapped ' + v); return COLORS[v] })
  svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/ aria-hidden="true"| focusable="false"/g, '')
  fs.writeFileSync(`${out}/${name}.svg`, svg + '\n')
}
console.log('wrote', cats.length)
// The wall also carries the pixel cat and its cosmetics as one plain module (wall/test/cats-copy.test.mjs checks the copy).
fs.copyFileSync(new URL('../src/pixel-cats.js', import.meta.url), new URL('../../../wall/public/scene/cats.mjs', import.meta.url))
console.log('wrote wall/public/scene/cats.mjs')
