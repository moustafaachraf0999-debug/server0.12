import type Client from './Client.js'
import type {
	ActionCancelLobbyJoinRequest,
	ActionHandlerArgs,
	ActionRespondToLobbyJoinRequest,
	LobbyBrowserEntryWirePayload,
} from './actions.js'
import {
	buildLobbyBrowserEntry,
	sendLobbyJoinRequestClosed,
	sendLobbyJoinRequestRejected,
	sendLobbyList,
} from './lobbyBroadcasts.js'
import {
	LOBBY_JOIN_REQUEST_COOLDOWN_MS,
	getLobbyJoinBlockMessage,
	joinLobbyClient,
	syncJoinedLobbyClientState,
} from './lobbyEntryHandlers.js'
import { getLobbyMaxPlayers } from './lobbyRules.js'
import { Lobbies } from './lobbyRegistry.js'
import { recordLobbyEvent } from './monitor/monitorStore.js'
import { sendSystemError } from './protocol/v2/index.js'

const isAvailableInBrowser = (entry: LobbyBrowserEntryWirePayload) =>
	!entry.isInGame && entry.playerCount < entry.maxPlayers

const buildBrowsableLobbyEntries = () => {
	const entries: LobbyBrowserEntryWirePayload[] = []
	for (const lobby of Lobbies.values()) {
		if (lobby.coopSaveId != null) {
			continue
		}

		const entry = buildLobbyBrowserEntry(lobby)
		if (entry && isAvailableInBrowser(entry)) {
			entries.push(entry)
		}
	}

	return entries
}

export const requestLobbyListAction = (client: Client) => {
	sendLobbyList(client, buildBrowsableLobbyEntries())
}

export const cancelLobbyJoinRequestAction = (
	{ requestId }: ActionHandlerArgs<ActionCancelLobbyJoinRequest>,
	client: Client,
) => {
	for (const lobby of Lobbies.values()) {
		const request = lobby.getPendingJoinRequest(requestId)
		if (!request || request.client.id !== client.id) {
			continue
		}

		lobby.deletePendingJoinRequest(requestId)
		lobby.setJoinRequestCooldown(request.client, LOBBY_JOIN_REQUEST_COOLDOWN_MS)
		const owner = lobby.getPlayer(lobby.ownerId)
		if (owner) {
			sendLobbyJoinRequestClosed(owner, lobby.code, requestId, 'cancelled')
		}
		recordLobbyEvent(
			lobby,
			'join_request.cancelled',
			`${client.username} cancelled their join request`,
			{
				player: client,
				details: { requestId },
			},
		)
		return
	}
}

export const respondToLobbyJoinRequestAction = (
	{ requestId, accepted, blocked }: ActionHandlerArgs<ActionRespondToLobbyJoinRequest>,
	client: Client,
) => {
	if (!client.isOwner || !client.lobby) {
		sendSystemError(client, 'Only the host can respond to join requests.')
		return
	}

	const lobby = client.lobby
	const request = lobby.getPendingJoinRequest(requestId)
	if (!request) {
		sendSystemError(client, 'Join request no longer exists.')
		return
	}

	lobby.deletePendingJoinRequest(requestId)

	if (!accepted) {
		if (blocked) {
			lobby.blockJoinRequestsFromClient(request.client)
		} else {
			lobby.setJoinRequestCooldown(request.client, LOBBY_JOIN_REQUEST_COOLDOWN_MS)
		}

		sendLobbyJoinRequestRejected(
			request.client,
			lobby.code,
			blocked
				? 'The host blocked your join requests for this lobby.'
				: 'Join request denied.',
			requestId,
			blocked ? 'blocked' : 'denied',
		)
		recordLobbyEvent(
			lobby,
			blocked ? 'join_request.blocked' : 'join_request.denied',
			`${client.username} ${blocked ? 'blocked' : 'denied'} ${request.client.username}`,
			{
				player: client,
				details: { requesterPlayerId: request.client.id },
			},
		)
		return
	}

	if (request.client.lobby) {
		sendSystemError(client, 'Requester is already in a lobby.')
		sendLobbyJoinRequestClosed(client, lobby.code, requestId, 'unavailable')
		return
	}

	const blockMessage = getLobbyJoinBlockMessage(lobby, request.client)
	if (blockMessage) {
		sendSystemError(client, blockMessage)
		sendLobbyJoinRequestRejected(
			request.client,
			lobby.code,
			blockMessage,
			requestId,
			'unavailable',
		)
		sendLobbyJoinRequestClosed(client, lobby.code, requestId, 'unavailable')
		return
	}

	if (!joinLobbyClient(lobby, request.client)) {
		sendLobbyJoinRequestClosed(client, lobby.code, requestId, 'unavailable')
		return
	}

	syncJoinedLobbyClientState(request.client)
	sendLobbyJoinRequestClosed(client, lobby.code, requestId, 'accepted')
	recordLobbyEvent(
		lobby,
		'join_request.accepted',
		`${client.username} accepted ${request.client.username}`,
		{
			player: client,
			details: {
				requesterPlayerId: request.client.id,
				maxPlayers: getLobbyMaxPlayers(lobby),
			},
		},
	)
}

export const clearPendingLobbyJoinRequestsForClient = (client: Client) => {
	for (const lobby of Lobbies.values()) {
		lobby.deletePendingJoinRequestsForClient(client.id)
	}
}
