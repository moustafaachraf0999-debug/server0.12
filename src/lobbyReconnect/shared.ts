import type { InsaneInt } from '../InsaneInt.js'
import type Client from '../Client.js'
import type { BlindKind, BlindRow } from '../actions.js'

/** How long to keep a disconnected player's slot reserved (ms) */
export const RECONNECT_GRACE_PERIOD = 120000

export interface SavedGameState {
	id: string
	reconnectToken: string
	lives: number
	score: InsaneInt
	handsLeft: number
	ante: number
	skips: number
	furthestBlind: number
	money: number
	isReady: boolean
	firstReady: boolean
	isReadyLobby: boolean
	livesBlocker: boolean
	location: string
	username: string
	blindCol: number
	blindTargetScale: number | null
	nemesisPlayerId: string | null
	modHash: string
	team: number | null
	isTeamLocked: boolean
	coopBlindActive: boolean
	activeBlindStarted: boolean
	activeBlindRow: BlindRow | null
	activeBlindKind: BlindKind | null
	skipReadyBlindRow: Client['skipReadyBlindRow']
	skipReadyBlindAnte: Client['skipReadyBlindAnte']
	readyBlindRow: BlindRow | null
	readyBlindKind: BlindKind | null
	isCached: boolean
	isOwner: boolean
	isInMatch: boolean
	role: Client['role']
}

export interface DisconnectedSlot {
	timer: ReturnType<typeof setTimeout>
	savedState: SavedGameState
}
