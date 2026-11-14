import assert from 'node:assert/strict'
import { createServer } from 'vite'

process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-fixture'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } })
const previousDocument = globalThis.document
const previousDecoder = globalThis.createImageBitmap
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'))
const uploaded = []
let decodeFails = false, outputSize = 0, closed = 0, canvases = [], bitmapWidth = 32, bitmapHeight = 16
globalThis.createImageBitmap = async () => {
  if (decodeFails) throw new Error('Invalid image')
  return { width: bitmapWidth, height: bitmapHeight, close() { closed++ } }
}
globalThis.document = { createElement(name) {
  assert.equal(name, 'canvas')
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage(bitmap) { assert.equal(bitmap.width, bitmapWidth); assert.equal(bitmap.height, bitmapHeight) } }),
    toBlob(callback, type) { assert.equal(type, 'image/png'); callback(new Blob([outputSize ? new Uint8Array(outputSize) : png], { type })) },
  }
  canvases.push(canvas)
  return canvas
} }
try {
  const { supabase } = await server.ssrLoadModule('/src/lib/supabase.ts')
  Object.defineProperty(supabase, 'functions', { configurable: true, value: { invoke: async (url, options) => { uploaded.push({ url, body: options.body }); return { error: null } } } })
  const { uploadBusinessLogo } = await server.ssrLoadModule('/src/lib/business.ts')
  const business = { id: '11111111-1111-4111-8111-111111111111', primary_owner: true }
  const webp = () => new File(['test decoder input'], 'logo.webp', { type: 'image/webp' })
  const path = await uploadBusinessLogo(business, webp())
  assert.match(path, /\/logo-[\w-]+\.png$/)
  assert.match(uploaded[0].url, /bucket=velnu-business-logos/)
  assert.equal(uploaded[0].body.type, 'image/png')
  assert.deepEqual([...new Uint8Array(await uploaded[0].body.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.deepEqual([canvases[0].width, canvases[0].height], [32, 16], 'Conversion retains logo dimensions')
  assert.equal(closed, 1)
  for (const type of ['image/png', 'image/jpeg']) {
    const original = new File([png], 'original', { type })
    await uploadBusinessLogo(business, original)
    assert.equal(uploaded.at(-1).body, original, `${type} stays unchanged`)
  }
  const successfulWrites = uploaded.length
  decodeFails = true
  await assert.rejects(uploadBusinessLogo(business, webp()), /could not be opened/)
  decodeFails = false; outputSize = 2_000_001
  await assert.rejects(uploadBusinessLogo(business, webp()), /converted logo is larger than 2 MB/)
  assert.equal(closed, 2, 'Conversion releases the bitmap when its output exceeds the limit')
  outputSize = 0; bitmapWidth = 9000
  await assert.rejects(uploadBusinessLogo(business, webp()), /smaller logo/)
  assert.equal(closed, 3)
  assert.equal(uploaded.length, successfulWrites, 'Rejected image conversions never reach persistence')
  await assert.rejects(uploadBusinessLogo({ ...business, primary_owner: false }, webp()), /Only owners/)
  console.log('Logo upload conversion, limits and unchanged PNG/JPEG boundary checks passed')
} finally {
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument
  if (previousDecoder === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = previousDecoder
  await server.close()
}
