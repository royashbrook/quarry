import { defaultSave, type SaveV1 } from './engine'

export const SAVE_KEY = 'quarry_save_v1'
const PREFIX = 'qy1.'

export function loadSave(storage: Pick<Storage, 'getItem'> = localStorage): SaveV1 {
  const fallback = defaultSave()
  try {
    const parsed = JSON.parse(storage.getItem(SAVE_KEY) || '') as Partial<SaveV1>
    if (parsed.version !== 1) return fallback
    return {
      ...fallback,
      ...parsed,
      upgrades: { ...fallback.upgrades, ...parsed.upgrades },
      }
  } catch {
    return fallback
  }
}

export function storeSave(save: SaveV1, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(SAVE_KEY, JSON.stringify({ ...save }))
}

export async function encodeSave(save: SaveV1): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify({ ...save }))
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return PREFIX + bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))
}

export async function decodeSave(code: string): Promise<SaveV1> {
  if (!code.startsWith(PREFIX)) throw new Error('unknown save code')
  const bytes = base64UrlToBytes(code.slice(PREFIX.length))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const parsed = JSON.parse(await new Response(stream).text()) as SaveV1
  if (parsed.version !== 1 || !Number.isFinite(parsed.coins) || typeof parsed.upgrades !== 'object') {
    throw new Error('invalid save')
  }
  return { ...defaultSave(), ...parsed }
}

export async function rescueUrl(save: SaveV1): Promise<string> {
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
