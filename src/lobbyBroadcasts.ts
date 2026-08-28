import type Lobby from './Lobby.js'
import type Client from './Client.js'
import type {
	ActionLobbyJoinRequestPending,
	ActionLobbyJoinRequestReceived,
	ActionLobbyJoinRequestRejected,
	ActionLobbyJoinRequestClosed,
	ActionLobbyList,
	ActionLobbyNemesisAssignments,
	ActionLobbyPlayerJoined,
	ActionLobbyPlayerLeft,
	ActionLobbyPlayerUpdated,
	ActionLobbyTypeChanged,
	LobbyBrowserEntryWirePayload,
	LobbyJoinRequestCloseReason,
	LobbyJoinRequestWirePayload,
	ActionServerToClient,
	LobbyTypeChangedPlayerWirePayload,
} from './actions.js'
import { getLobbyActivePlayers } from './lobbyPlayerState/queries.js'
import { isListedLobbyAccessMode } from './lobbyAccess.js'
import { getLobbyMaxPlayers } from './lobbyRules.js'
import {
	buildJoinedLobbyAction,
	buildLobbyInfoAction,
} from './lobbySnapshots/actions.js'
import {
	buildLobbyPlayerInfo,
	buildPlayersInfo,
} from './lobbySnapshots/players.js'
import { sendLobbyServerAction, sendServerAction } from './protocol/v2/index.js'

export const broadcastLobbyAction = (
	lobby: Lobby,
	action: ActionServerToClient,
) => {
	for (const player of lobby.getPlayers()) {
		sendServerAction(player, action)
	}
}

export const broadcastLobbyActionExcept = (
	lobby: Lobby,
	excludedPlayerId: string,
	action: ActionServerToClient,
) => {
	for (const player of lobby.getPlayers()) {
		if (player.id !== excludedPlayerId) {
			sendServerAction(player, action)
		}
	}
}

export const broadcastLobbyMatchAction = (
	lobby: Lobby,
	action: ActionServerToClient,
	options: {
		excludedPlayerId?: string
	} = {},
) => {
	for (const player of getLobbyActivePlayers(lobby)) {
		if (player.id !== options.excludedPlayerId) {
			sendServerAction(player, action)
		}
	}
}

/**
 * Like broadcastLobbyMatchAction, but spectators also receive the action.
 * Used for match-visible state that spectators track live (e.g. the ante
 * timer) so they do not diverge from the join-time snapshot.
 */
export const broadcastLobbyMatchAndSpectatorsAction = (
	lobby: Lobby,
	action: ActionServerToClient,
	options: {
		excludedPlayerId?: string
	} = {},
) => {
	for (const player of lobby.getPlayers()) {
		if (player.id === options.excludedPlayerId) {
			continue
		}
		if (player.isSpectator || player.isInMatch) {
			sendServerAction(player, action)
		}
	}
}

export const sendInitialLobbyJoinedState = (
	lobby: Lobby,
	player: Client,
) => {
	sendLobbyServerAction(
		player,
		buildJoinedLobbyAction(lobby, player, 'joinedLobby'),
	)
	broadcastLobbyPlayerJoined(lobby, player)
}

const broadcastLobbyPlayerJoined = (
	lobby: Lobby,
	joinedPlayer: Client,
) => {
	const action = {
		action: 'lobbyPlayerJoined',
		player: buildLobbyPlayerInfo(lobby, joinedPlayer),
	} satisfies ActionLobbyPlayerJoined

	for (const player of lobby.getPlayers()) {
		if (player.id !== joinedPlayer.id) {
			sendLobbyServerAction(player, action)
		}
	}
}

export const buildLobbyBrowserEntry = (
	lobby: Lobby,
): LobbyBrowserEntryWirePayload | null => {
	if (!isListedLobbyAccessMode(lobby.accessMode)) {
		return null
	}

	const owner = lobby.getPlayer(lobby.ownerId) ?? lobby.getFirstPlayer()
	const ruleset = lobby.options.ruleset
	const maxPlayers = getLobbyMaxPlayers(lobby)
	return {
		code: lobby.code,
		ownerUsername: owner?.username ?? 'Guest',
		playerCount: lobby.getPlayerCount(),
		maxPlayers,
		gameMode: lobby.gameMode,
		lobbyType: lobby.lobbyType,
		accessMode: lobby.accessMode,
		ruleset: typeof ruleset === 'string' ? ruleset : undefined,
		isInGame: lobby.isInGame,
	}
}

export const sendLobbyList = (
	client: Client,
	lobbies: LobbyBrowserEntryWirePayload[],
) => {
	sendLobbyServerAction(client, {
		action: 'lobbyList',
		lobbies,
	} satisfies ActionLobbyList)
}

export const buildLobbyJoinRequest = (
	requestId: string,
	client: Client,
	expiresAt: number,
): LobbyJoinRequestWirePayload => ({
	requestId,
	playerId: client.id,
	username: client.username,
	blindCol: client.blindCol,
	modHash: client.modHash,
	isCached: client.isCached,
	expiresAt,
	expiresInMs: Math.max(0, expiresAt - Date.now()),
})

export const sendLobbyJoinRequestReceived = (
	owner: Client,
	requestId: string,
	requester: Client,
	expiresAt: number,
) => {
	sendLobbyServerAction(owner, {
		action: 'lobbyJoinRequestReceived',
		request: buildLobbyJoinRequest(requestId, requester, expiresAt),
	} satisfies ActionLobbyJoinRequestReceived)
}

export const sendLobbyJoinRequestPending = (
	client: Client,
	code: string,
	requestId: string,
	expiresAt: number,
) => {
	sendLobbyServerAction(client, {
		action: 'lobbyJoinRequestPending',
		code,
		requestId,
		expiresAt,
		expiresInMs: Math.max(0, expiresAt - Date.now()),
	} satisfies ActionLobbyJoinRequestPending)
}

export const sendLobbyJoinRequestRejected = (
	client: Client,
	code: string,
	message: string,
	requestId?: string,
	reason?: LobbyJoinRequestCloseReason,
) => {
	sendLobbyServerAction(client, {
		action: 'lobbyJoinRequestRejected',
		code,
		message,
		requestId,
		reason,
	} satisfies ActionLobbyJoinRequestRejected)
}

export const sendLobbyJoinRequestClosed = (
	client: Client,
	code: string,
	requestId: string,
	reason: LobbyJoinRequestCloseReason,
) => {
	sendLobbyServerAction(client, {
		action: 'lobbyJoinRequestClosed',
		code,
		requestId,
		reason,
	} satisfies ActionLobbyJoinRequestClosed)
}

export const broadcastLobbyPlayerUpdated = (
	lobby: Lobby,
	player: Client,
) => {
	const action = {
		action: 'lobbyPlayerUpdated',
		player: buildLobbyPlayerInfo(lobby, player),
	} satisfies ActionLobbyPlayerUpdated

	broadcastLobbyAction(lobby, action)
}

export const buildLobbyNemesisAssignments = (lobby: Lobby) =>
	lobby.getPlayers().map((player) => ({
		playerId: player.id,
		nemesisPlayerId: player.nemesisPlayerId ?? undefined,
	}))

export const broadcastLobbyNemesisAssignments = (lobby: Lobby) => {
	broadcastLobbyAction(lobby, {
		action: 'lobbyNemesisAssignments',
		assignments: buildLobbyNemesisAssignments(lobby),
	} satisfies ActionLobbyNemesisAssignments)
}

const buildLobbyTypeChangedPlayer = (
	player: Client,
): LobbyTypeChangedPlayerWirePayload => ({
	playerId: player.id,
	team: player.team ?? undefined,
	isTeamLocked: player.isTeamLocked,
	isReadyLobby: player.isReadyLobby,
	nemesisPlayerId: player.nemesisPlayerId ?? undefined,
})

export const broadcastLobbyTypeChanged = (lobby: Lobby) => {
	broadcastLobbyAction(lobby, {
		action: 'lobbyTypeChanged',
		lobbyType: lobby.lobbyType,
		players: lobby.getPlayers().map(buildLobbyTypeChangedPlayer),
	} satisfies ActionLobbyTypeChanged)
}

export const broadcastLobbyPlayerLeft = (
	lobby: Lobby,
	departedPlayerId: string,
) => {
	const assignments = buildLobbyNemesisAssignments(lobby)

	for (const player of lobby.getPlayers()) {
		sendLobbyServerAction(player, {
			action: 'lobbyPlayerLeft',
			playerId: departedPlayerId,
			ownerPlayerId: lobby.ownerId,
			isHost: player.id === lobby.ownerId,
			assignments,
		} satisfies ActionLobbyPlayerLeft)
	}
}

export const broadcastLobbyInfo = (
	lobby: Lobby,
	excludedPlayerId?: string,
) => {
	const playersInfo = buildPlayersInfo(lobby)

	for (const player of lobby.getPlayers()) {
		if (player.id !== excludedPlayerId) {
			sendLobbyServerAction(
				player,
				buildLobbyInfoAction(lobby, player, playersInfo),
			)
		}
	}
}
