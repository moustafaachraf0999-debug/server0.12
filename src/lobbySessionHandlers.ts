import type Client from './Client.js'
import type { ActionHandlerArgs, ActionUsername } from './actions.js'
import { broadcastLobbyPlayerUpdated } from './lobbyBroadcasts.js'
import { lobbyRequiresReady } from './lobbyRules.js'
import { recordPlayerName } from './playerDirectory.js'
import { sendUtilityServerAction } from './protocol/v2/serverSend.js'

export const usernameAction = (
	{ username, blindCol, blindTargetScale, modHash }: ActionHandlerArgs<ActionUsername>,
	client: Client,
) => {
	client.username = username
	recordPlayerName(client, username)
	const numericBlindCol = Number(blindCol)
	client.blindCol = Number.isFinite(numericBlindCol)
		? Math.max(1, Math.min(25, Math.floor(numericBlindCol)))
		: 1
	const numericBlindTargetScale = Number(blindTargetScale)
	client.blindTargetScale = Number.isFinite(numericBlindTargetScale)
		? Math.max(0, numericBlindTargetScale)
		: client.blindTargetScale
	client.modHash = modHash

	if (client.lobby) {
		broadcastLobbyPlayerUpdated(client.lobby, client)
	}
}

export const readyLobbyAction = (client: Client) => {
	if (!client.lobby || !lobbyRequiresReady(client.lobby)) {
		return
	}

	client.isReadyLobby = true
	broadcastLobbyPlayerUpdated(client.lobby, client)
}

export const unreadyLobbyAction = (client: Client) => {
	if (!client.lobby || !lobbyRequiresReady(client.lobby)) {
		return
	}

	client.isReadyLobby = false
	broadcastLobbyPlayerUpdated(client.lobby, client)
}

export const keepAliveAction = (client: Client) => {
	sendUtilityServerAction(client, { action: 'keepAliveAck' })
}
