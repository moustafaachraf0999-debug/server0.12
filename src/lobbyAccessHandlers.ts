import type Client from './Client.js'
import type {
	ActionHandlerArgs,
	ActionRespondToLobbyJoinRequest,
	LobbyBrowserEntryWirePayload,
} from './actions.js'
import {
	buildLobbyBrowserEntry,
	sendLobbyJoinRequestRejected,
	sendLobbyList,
} from './lobbyBroadcasts.js'
import {
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

export const respondToLobbyJoinRequestAction = (
	{ requestId, accepted }: ActionHandlerArgs<ActionRespondToLobbyJoinRequest>,
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
		sendLobbyJoinRequestRejected(
			request.client,
			lobby.code,
			'Join request denied.',
		)
		recordLobbyEvent(
			lobby,
			'join_request.denied',
			`${client.username} denied ${request.client.username}`,
			{
				player: client,
				details: { requesterPlayerId: request.client.id },
			},
		)
		return
	}

	if (request.client.lobby) {
		sendSystemError(client, 'Requester is already in a lobby.')
		return
	}

	const blockMessage = getLobbyJoinBlockMessage(lobby, request.client)
	if (blockMessage) {
		sendSystemError(client, blockMessage)
		sendLobbyJoinRequestRejected(request.client, lobby.code, blockMessage)
		return
	}

	if (!joinLobbyClient(lobby, request.client)) {
		return
	}

	syncJoinedLobbyClientState(request.client)
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
