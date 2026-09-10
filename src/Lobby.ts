import { randomBytes } from 'node:crypto'
import type Client from './Client.js'
import type { GameMode, LobbyAccessMode, LobbyType } from './actions.js'
import { LobbyAnteTimerState } from './lobbyAnteTimer.js'
import { LobbyDuelState } from './lobbyDuelState.js'
import type { DisconnectedSlot } from './lobbyReconnect/shared.js'
import { allocateLobbyCode, registerLobby } from './lobbyRegistry.js'
import { LobbyTeamState } from './lobbyTeamState.js'
import { DEFAULT_GAME_MODE } from './gameModes.js'
import { DEFAULT_LOBBY_ACCESS_MODE } from './lobbyAccess.js'
import {
	type LobbyOptions,
	getDefaultLobbyOptions,
} from './lobbyOptions.js'
import { DEFAULT_LOBBY_TYPE } from './lobbyTypes.js'
import { preparePlayerForFreshLobbyAttachment } from './playerState.js'
import { normalizeIpAddress } from './playerDirectory.js'

type AttachFreshClientOptions = {
	isOwner?: boolean
}

type EndGameSnapshot = {
	jokers?: string
	deck?: string
	summary?: string
}

export type PendingLobbyJoinRequest = {
	requestId: string
	client: Client
	createdAt: number
	expiresAt: number
	timeout?: ReturnType<typeof setTimeout>
}

class Lobby {
	code: string
	gameMode: GameMode
	lobbyType: LobbyType
	accessMode: LobbyAccessMode
	options: LobbyOptions
	isInGame = false
	coopSaveId: string | null = null
	ownerId: string
	firstReadyAt: number | null = null
	/** Shared team-sync and cooperative blind runtime state */
	teamState = new LobbyTeamState()
	/** Active Duels pairings, byes, and bye blind targets */
	duelState = new LobbyDuelState()
	/** Shared ante timer state for the active match */
	anteTimer = new LobbyAnteTimerState()
	/** Connected lobby players */
	private players = new Map<string, Client>()
	/** Tracks disconnected players awaiting reconnection */
	private disconnectedSlots = new Map<string, DisconnectedSlot>()
	private endGameSnapshots = new Map<string, EndGameSnapshot>()
	private pendingJoinRequests = new Map<string, PendingLobbyJoinRequest>()
	private joinRequestCooldowns = new Map<string, number>()
	spectatorTargets = new Map<string, string>()
	/** Last time each spectator asked the target for a live snapshot (rate limit) */
	spectatorSnapshotRequestAt = new Map<string, number>()
	/** Buffer of recent actions streamed by players (capped at 2000 per player) */
	private playerActionLogs = new Map<string, Array<{ actionData: string; stepIndex: number }>>()
	matchStartConfig: {
		seed?: string
		stake: number
		back: string
		challenge: string
		sleeve: string
		cocktail: string
	} | null = null
	private blockedJoinRequestKeys = new Set<string>()

	appendPlayerAction = (playerId: string, action: { actionData: string; stepIndex: number }) => {
		let log = this.playerActionLogs.get(playerId)
		if (!log) {
			log = []
			this.playerActionLogs.set(playerId, log)
		}
		log.push(action)
		if (log.length > 2000) {
			log.shift()
		}
	}

	getPlayerActionLog = (playerId: string): Array<{ actionData: string; stepIndex: number }> => {
		return this.playerActionLogs.get(playerId) ?? []
	}

	clearSpectatorState = () => {
		this.spectatorTargets.clear()
		this.spectatorSnapshotRequestAt.clear()
		this.playerActionLogs.clear()
		this.matchStartConfig = null
	}

	/** Drop all spectator bookkeeping for a client that stopped spectating or left. */
	removeSpectatorState = (playerId: string) => {
		this.spectatorTargets.delete(playerId)
		this.spectatorSnapshotRequestAt.delete(playerId)
		this.playerActionLogs.delete(playerId)
	}

	/** Drop watch mappings that point at a target that is no longer watchable. */
	removeSpectatorsOfTarget = (targetId: string) => {
		for (const [spectatorId, target] of this.spectatorTargets.entries()) {
			if (target === targetId) {
				this.spectatorTargets.delete(spectatorId)
			}
		}
	}

	// Attrition is the default game mode, FFA is the default lobby type
	constructor(
		host: Client,
		gameMode: GameMode = DEFAULT_GAME_MODE,
		lobbyType: LobbyType = DEFAULT_LOBBY_TYPE,
		accessMode: LobbyAccessMode = DEFAULT_LOBBY_ACCESS_MODE,
	) {
		this.code = allocateLobbyCode()
		registerLobby(this)

		this.ownerId = host.id
		this.gameMode = gameMode
		this.lobbyType = lobbyType
		this.accessMode = accessMode
		this.options = getDefaultLobbyOptions(lobbyType)
		this.attachFreshClient(host, { isOwner: true })
	}

	getClientGamemodeKey = () => `gamemode_mp_${this.gameMode}`

	setOption = (key: string, value: string | number | boolean) => {
		this.options[key] = value
		return value
	}

	getPlayerMap = (): ReadonlyMap<string, Client> => this.players

	getPlayers = (): Client[] => Array.from(this.players.values())

	getPlayerCount = (): number => this.players.size

	getFirstPlayer = (): Client | undefined =>
		this.players.values().next().value

	hasPlayer = (playerId: string): boolean => this.players.has(playerId)

	getPlayer = (playerId: string): Client | undefined =>
		this.players.get(playerId)

	addPlayer = (player: Client): Client => {
		this.players.set(player.id, player)
		return player
	}

	removePlayer = (playerId: string): boolean => this.players.delete(playerId)

	setOwner = (playerId: string): boolean => {
		const newOwner = this.getPlayer(playerId)
		if (!newOwner) {
			return false
		}

		this.ownerId = playerId
		for (const player of this.getPlayers()) {
			player.isOwner = player.id === newOwner.id
		}
		return true
	}

	attachFreshClient = (
		client: Client,
		options: AttachFreshClientOptions = {},
	) => {
		const { isOwner = false } = options
		preparePlayerForFreshLobbyAttachment(client, {
			isOwner,
			lobbyType: this.lobbyType,
		})
		this.addPlayer(client)
		client.lobby = this
	}

	clearEndGameSnapshots = () => {
		this.endGameSnapshots.clear()
	}

	getEndGameSnapshot = (playerId: string): EndGameSnapshot | undefined => {
		return this.endGameSnapshots.get(playerId)
	}

	storeEndGameSnapshot = (
		playerId: string,
		snapshot: EndGameSnapshot,
	): EndGameSnapshot => {
		const existingSnapshot = this.endGameSnapshots.get(playerId) ?? {}
		const nextSnapshot = { ...existingSnapshot, ...snapshot }
		this.endGameSnapshots.set(playerId, nextSnapshot)
		return nextSnapshot
	}

	getDisconnectedSlot = (playerId: string): DisconnectedSlot | undefined =>
		this.disconnectedSlots.get(playerId)

	setDisconnectedSlot = (
		playerId: string,
		slot: DisconnectedSlot,
	): DisconnectedSlot => {
		this.disconnectedSlots.set(playerId, slot)
		return slot
	}

	deleteDisconnectedSlot = (playerId: string): boolean =>
		this.disconnectedSlots.delete(playerId)

	findDisconnectedSlot = (
		predicate: (slot: DisconnectedSlot) => boolean,
	): DisconnectedSlot | undefined => {
		for (const slot of this.disconnectedSlots.values()) {
			if (predicate(slot)) {
				return slot
			}
		}
		return undefined
	}

	getDisconnectedSlots = (): DisconnectedSlot[] =>
		Array.from(this.disconnectedSlots.values())

	addPendingJoinRequest = (
		client: Client,
		timeoutMs: number,
	): PendingLobbyJoinRequest => {
		const existingRequest = this.findPendingJoinRequestForClient(client.id)
		if (existingRequest) {
			return existingRequest
		}

		let requestId = randomBytes(8).toString('hex')
		while (this.pendingJoinRequests.has(requestId)) {
			requestId = randomBytes(8).toString('hex')
		}

		const request = {
			requestId,
			client,
			createdAt: Date.now(),
			expiresAt: Date.now() + Math.max(0, timeoutMs),
		}
		this.pendingJoinRequests.set(requestId, request)
		return request
	}

	getPendingJoinRequest = (
		requestId: string,
	): PendingLobbyJoinRequest | undefined =>
		this.pendingJoinRequests.get(requestId)

	deletePendingJoinRequest = (requestId: string): boolean => {
		const request = this.pendingJoinRequests.get(requestId)
		if (request?.timeout) {
			clearTimeout(request.timeout)
		}
		return this.pendingJoinRequests.delete(requestId)
	}

	findPendingJoinRequestForClient = (
		clientId: string,
	): PendingLobbyJoinRequest | undefined => {
		for (const request of this.pendingJoinRequests.values()) {
			if (request.client.id === clientId) {
				return request
			}
		}
		return undefined
	}

	deletePendingJoinRequestsForClient = (clientId: string): boolean => {
		let deleted = false
		for (const request of this.pendingJoinRequests.values()) {
			if (request.client.id === clientId) {
				this.deletePendingJoinRequest(request.requestId)
				deleted = true
			}
		}
		return deleted
	}

	getPendingJoinRequests = (): PendingLobbyJoinRequest[] =>
		Array.from(this.pendingJoinRequests.values())

	private getJoinRequestClientKey = (client: Client): string =>
		normalizeIpAddress(client.remoteAddress)

	getJoinRequestCooldownRemainingMs = (client: Client): number => {
		const key = this.getJoinRequestClientKey(client)
		const expiresAt = this.joinRequestCooldowns.get(key)
		if (!expiresAt) {
			return 0
		}

		const remainingMs = expiresAt - Date.now()
		if (remainingMs <= 0) {
			this.joinRequestCooldowns.delete(key)
			return 0
		}
		return remainingMs
	}

	setJoinRequestCooldown = (client: Client, timeoutMs: number): number => {
		const expiresAt = Date.now() + Math.max(0, timeoutMs)
		this.joinRequestCooldowns.set(this.getJoinRequestClientKey(client), expiresAt)
		return expiresAt
	}

	blockJoinRequestsFromClient = (client: Client): void => {
		const key = this.getJoinRequestClientKey(client)
		this.blockedJoinRequestKeys.add(key)
		this.joinRequestCooldowns.delete(key)
	}

	isJoinRequesterBlocked = (client: Client): boolean =>
		this.blockedJoinRequestKeys.has(this.getJoinRequestClientKey(client))
}

export default Lobby
