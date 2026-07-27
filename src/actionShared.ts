import type { LobbyType } from './lobbyTypes.js'

export type GameMode = 'attrition' | 'showdown' | 'survival' | 'coop'
export type { LobbyType } from './lobbyTypes.js'
export type LobbyAccessMode = 'public' | 'ask_first' | 'private'
export type BlindRow = 'Small' | 'Big' | 'Boss'
export type BlindKind = 'small' | 'big' | 'boss' | 'pvp'

export type LobbyOptionWireValue = string | number | boolean | null
/** TCP wire payload for lobby options before the Lua client normalizes it. */
export type LobbyOptionsWirePayload = {
	gamemode?: string
	[key: string]: LobbyOptionWireValue | undefined
}

/** TCP wire payload for lobby players; the Lua client maps these camelCase keys into snake_case runtime state. */
export type LobbyPlayerWirePayload = {
	id: string
	username: string
	blindCol: number
	blindTargetScale?: number
	nemesisPlayerId?: string
	location?: string
	modHash: string
	isCached: boolean
	isReadyLobby?: boolean
	isOwner: boolean
	team?: number
	isTeamLocked?: boolean
	isInMatch: boolean
	isDisconnected?: boolean
	lives?: number
}

export type LobbyNemesisAssignmentWirePayload = {
	playerId: string
	nemesisPlayerId?: string
}

export type LobbyBrowserEntryWirePayload = {
	code: string
	ownerUsername: string
	playerCount: number
	maxPlayers: number
	gameMode: GameMode
	lobbyType: LobbyType
	accessMode: Exclude<LobbyAccessMode, 'private'>
	ruleset?: string
	isInGame: boolean
}

export type LobbyJoinRequestWirePayload = {
	requestId: string
	playerId: string
	username: string
	blindCol: number
	modHash: string
	isCached: boolean
}
