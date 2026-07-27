import type { LobbyAccessMode } from './actionShared.js'

export const DEFAULT_LOBBY_ACCESS_MODE: LobbyAccessMode = 'private'

const LOBBY_ACCESS_MODES = new Set<LobbyAccessMode>([
	'public',
	'ask_first',
	'private',
])

export const isValidLobbyAccessMode = (
	value: unknown,
): value is LobbyAccessMode =>
	typeof value === 'string' && LOBBY_ACCESS_MODES.has(value as LobbyAccessMode)

export const isListedLobbyAccessMode = (
	value: LobbyAccessMode,
): value is Exclude<LobbyAccessMode, 'private'> =>
	value === 'public' || value === 'ask_first'
