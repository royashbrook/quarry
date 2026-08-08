import { defaultSave, migrateV1, type SaveV1, type SaveV2 } from './engine'

export const SAVE_KEY = 'quarry_save_v1'
const PREFIX = 'qy1.'

export function loadSave(storage: Pick<Storage, 'getItem'> = localStorage): SaveV2 {
  const fallback = defaultSave()
  try {
    const parsed = JSON.parse(storage.getItem(SAVE_KEY) || '') as Partial<SaveV1> | Partial<SaveV2>
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

export function storeSave(save: SaveV2, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(SAVE_KEY, JSON.stringify({ ...save }))
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
