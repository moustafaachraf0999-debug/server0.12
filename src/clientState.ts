import type Client from './Client.js'
import type { LifeLossReason } from './actionServerMatch.js'
import type { ActionEnemyLocation } from './actions.js'
import {
	broadcastLobbyAction,
	broadcastLobbyMatchAction,
	broadcastLobbyPlayerUpdated,
} from './lobbyBroadcasts.js'
import { broadcastLobbyPlayerState } from './lobbyPlayerState/broadcasts.js'
import { sendMatchServerAction } from './protocol/v2/index.js'

const buildLifeLossPayload = (
	previousLives: number,
	nextLives: number,
	reason?: LifeLossReason,
) =>
	reason && nextLives < previousLives
		? { lifeLossReason: reason, previousLives }
		: {}

export const setClientLocation = (client: Client, location: string) => {
	client.location = location
	const lobby = client.lobby
	if (!lobby) {
		return
	}

	const action: ActionEnemyLocation = {
		action: 'enemyLocation',
		playerId: client.id,
		username: client.username,
		location: client.location,
	}

	if (lobby.isInGame) {
		if (client.isInMatch) {
			lobby.matchReplay.recordEvent({
				actorId: client.id,
				scope: 'player',
				type: 'ENEMY_LOCATION',
				data: { location: client.location },
			})
			broadcastLobbyMatchAction(lobby, action)
		}
		return
	}

	broadcastLobbyAction(lobby, action)
}

export const loseClientLife = (
	client: Client,
	reason?: LifeLossReason,
) => {
	if (client.livesBlocker) {
		return
	}

	const previousLives = client.lives
	client.lives = Math.max(0, previousLives - 1)
	client.livesBlocker = true
	sendMatchServerAction(client, {
		action: 'playerInfo',
		lives: client.lives,
		...buildLifeLossPayload(previousLives, client.lives, reason),
	})
	if (client.lobby) {
		if (client.lobby.isInGame && client.isInMatch) {
			client.lobby.matchReplay.recordEvent({
				actorId: client.id,
				scope: 'player',
				type: 'PLAYER_LIVES',
				data: { lives: client.lives, previousLives, reason },
			})
		}
		broadcastLobbyPlayerState(client.lobby, client, {
			reason,
			previousLives,
		})
		broadcastLobbyPlayerUpdated(client.lobby, client)
	}
}
