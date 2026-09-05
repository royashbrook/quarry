import { defaultSave, migrateV1, type SaveV1, type SaveV2 } from './engine'

export const SAVE_KEY = 'quarry_save_v1'
const PREFIX = 'qy1.'

// a browser that blocks site data throws on the localStorage GETTER itself, and
// a full store throws on setItem. every storage touch goes through here so a
// refusal never stops play: the session just lives in memory instead.
const memory = new Map<string, string>()
// a key whose last write localStorage refused: memory holds the truth for it until a
// write gets through again, so a same-session read never returns the stale copy
const refused = new Set<string>()
export const storage = {
  getItem(key: string): string | null {
    if (refused.has(key)) return memory.get(key) ?? null
    try { return localStorage.getItem(key) } catch { return memory.get(key) ?? null }
  },
  setItem(key: string, value: string): void {
    memory.set(key, value)
    try { localStorage.setItem(key, value); refused.delete(key) } catch { refused.add(key) }
  },
  removeItem(key: string): void {
    memory.delete(key); refused.delete(key)
    try { localStorage.removeItem(key) } catch { /* nothing there to remove */ }
  },
}

export function loadSave(store: Pick<Storage, 'getItem'> = storage): SaveV2 {
  const fallback = defaultSave()
  try {
    const parsed = JSON.parse(store.getItem(SAVE_KEY) || '') as Partial<SaveV1> | Partial<SaveV2>
    if (parsed.version === 1) return migrateV1({ ...emptyV1(), ...(parsed as Partial<SaveV1>), version: 1 })
    if (parsed.version !== 2) return fallback
    const v2 = parsed as Partial<SaveV2>
    const mines = Array.isArray(v2.mines) && v2.mines.length > 0
      ? v2.mines.map(mine => ({ helpers: mine?.helpers ?? 0, gates: mine?.gates ?? 0, gatePaid: mine?.gatePaid ?? 0 }))
      : fallback.mines
    return {
      ...fallback,
      ...v2,
      version: 2,
      upgrades: { ...fallback.upgrades, ...v2.upgrades },
      mines,
      mine: Math.min(Math.max(0, Math.floor(v2.mine ?? 0)), mines.length - 1),
    }
  } catch {
    return fallback
  }
}

function emptyV1(): SaveV1 {
  return {
    version: 1, coins: 0, upgrades: { pick: 0, pack: 0, boots: 0 }, gates: 0,
    gatePaid: 0, lifetime: 0, contract: null, contractsDone: 0, helpers: 0,
    monument: 0, monumentPaid: 0,
  }
}

export function storeSave(save: SaveV2, store: Pick<Storage, 'setItem'> = storage): void {
  // called from the frame loop: a throw here would end the animation chain
  try { store.setItem(SAVE_KEY, JSON.stringify({ ...save })) } catch { /* the write is lost, the frame is not */ }
}

export async function encodeSave(save: SaveV2): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify({ ...save }))
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return PREFIX + bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))
}

export async function decodeSave(code: string): Promise<SaveV2> {
  if (!code.startsWith(PREFIX)) throw new Error('unknown save code')
  const bytes = base64UrlToBytes(code.slice(PREFIX.length))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const parsed = JSON.parse(await new Response(stream).text()) as SaveV1 | SaveV2
  if (!Number.isFinite(parsed.coins) || typeof parsed.upgrades !== 'object') throw new Error('invalid save')
  if (parsed.version === 1) return migrateV1({ ...emptyV1(), ...parsed, version: 1 })
  if (parsed.version !== 2) throw new Error('invalid save')
  return { ...defaultSave(), ...parsed }
}

export async function rescueUrl(save: SaveV2): Promise<string> {
  return new URL(`/rescue.html#${await encodeSave(save)}`, location.origin).href
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}
