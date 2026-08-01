import type Client from './Client.js'
import type {
	ActionPauseAnteTimer,
	ActionStartAnteTimer,
} from './actionServerMatch.js'
import { isPlayerReadyForPvpBlind } from './blindRules.js'
import {
	buildLobbyAnteTimerAction,
	getLobbyAnteTimerStartTime,
	normalizeLobbyAnteValue,
} from './lobbyAnteTimer.js'
import { broadcastLobbyMatchAction } from './lobbyBroadcasts.js'
import { getEnemies } from './lobbyPlayerState/queries.js'
import { isHeadToHeadLobbyType } from './lobbyTypes.js'
import { expireLobbyAnteTimer } from './roundFailureHandlers.js'
import { traceRuntimeEvent } from './runtimeTrace.js'

type AnteTimerMatchAction = ActionStartAnteTimer | ActionPauseAnteTimer
type AnteTimerIntent = {
	localTimer?: boolean
}

const LOCAL_TIMER_MODIFIERS = new Set([
	'pressure_timer',
	'pressure_timer_plus',
	'no_animation_timer',
	'pvp_timer',
])

const isHostOnlyTimer = (lobby: NonNullable<Client['lobby']>) =>
	lobby.options.timer_ownership === 'host'

const isLobbyTimerOwner = (client: Client) =>
	!!client.lobby && client.id === client.lobby.ownerId

const lobbyHasLocalTimerModifier = (lobby: NonNullable<Client['lobby']>) =>
	String(lobby.options.modifier_layers ?? '')
		.split(',')
		.map((modifier) => modifier.trim())
		.some((modifier) => LOCAL_TIMER_MODIFIERS.has(modifier))

const sendAnteTimerAction = (
	lobby: NonNullable<Client['lobby']>,
	action: AnteTimerMatchAction,
) => {
	broadcastLobbyMatchAction(lobby, action)
}

const relayLocalTimerAction = (
	client: Client,
	lobby: NonNullable<Client['lobby']>,
	enemies: Client[],
	action: AnteTimerMatchAction,
	localTimer: boolean,
) => {
	if (!localTimer || !lobbyHasLocalTimerModifier(lobby)) {
		return false
	}

	broadcastLobbyMatchAction(lobby, action, {
		excludedPlayerId: client.id,
	})
	traceRuntimeEvent(`ante_timer.local_relay_${action.action}`, {
		...buildLobbyTimerTraceFields(client, lobby),
		enemyCount: enemies.length,
	})
	return true
}

const scheduleAnteTimerExpiry = (lobby: NonNullable<Client['lobby']>) => {
	lobby.anteTimer.scheduleExpiryTimer((generation) => {
		expireLobbyAnteTimer(lobby, generation)
	})
}

const isClientReadyForAnteTimer = (client: Client) => {
	return !!(
		client.lobby &&
		client.lobby.options.timer === true &&
		client.isInMatch &&
		isPlayerReadyForPvpBlind(client)
	)
}

const setGroupAnteTimerController = (client: Client) => {
	const lobby = client.lobby
	if (!lobby) {
		return false
	}

	const clientAnte = normalizeLobbyAnteValue(client.ante)
	if (clientAnte === null) {
		return false
	}

	lobby.anteTimer.controllerId = client.id
	lobby.anteTimer.controllerAnte = clientAnte
	return true
}

const isCurrentGroupAnteTimerController = (client: Client) => {
	const lobby = client.lobby
	if (!lobby || lobby.anteTimer.controllerId !== client.id) {
		return false
	}

	const clientAnte = normalizeLobbyAnteValue(client.ante)
	return (
		clientAnte !== null &&
		lobby.anteTimer.controllerAnte === clientAnte
	)
}

const canClientStartGroupAnteTimer = (client: Client) => {
	if (!isClientReadyForAnteTimer(client)) {
		return false
	}

	const lobby = client.lobby
	if (lobby && isHostOnlyTimer(lobby) && !isLobbyTimerOwner(client)) {
		return false
	}

	if (lobby?.anteTimer.controllerId) {
		return isCurrentGroupAnteTimerController(client)
	}

	return setGroupAnteTimerController(client)
}

const canClientPauseGroupAnteTimer = (client: Client) => {
	const lobby = client.lobby
	if (!lobby) {
		return false
	}

	if (isHostOnlyTimer(lobby) && !isLobbyTimerOwner(client)) {
		return false
	}

	if (!lobby.anteTimer.controllerId) {
		return isClientReadyForAnteTimer(client)
			? setGroupAnteTimerController(client)
			: false
	}

	return isCurrentGroupAnteTimerController(client)
}

const buildLobbyTimerTraceFields = (
	client: Client,
	lobby: NonNullable<Client['lobby']>,
) => ({
	lobbyCode: lobby.code,
	lobbyType: lobby.lobbyType,
	playerId: client.id,
})

const buildAnteTimerTraceFields = (
	client: Client,
	lobby: NonNullable<Client['lobby']>,
	time: number,
) => ({
	ante: client.ante,
	controllerId: lobby.anteTimer.controllerId,
	generation: lobby.anteTimer.generation,
	...buildLobbyTimerTraceFields(client, lobby),
	time,
})

export const startAnteTimerAction = (
	client: Client,
	intent: AnteTimerIntent = {},
) => {
	const [lobby, enemies] = getEnemies(client)
	if (!lobby || lobby.options.timer !== true) {
		traceRuntimeEvent('ante_timer.start_ignored', {
			playerId: client.id,
			reason: lobby ? 'timer_disabled' : 'no_lobby',
		})
		return
	}

	if (
		relayLocalTimerAction(
			client,
			lobby,
			enemies,
			{ action: 'startAnteTimer' },
			intent.localTimer === true,
		)
	) {
		return
	}

	if (
		!isHeadToHeadLobbyType(lobby.lobbyType) &&
		!canClientStartGroupAnteTimer(client)
	) {
		traceRuntimeEvent('ante_timer.start_ignored', {
			...buildLobbyTimerTraceFields(client, lobby),
			reason:
				isHostOnlyTimer(lobby) && !isLobbyTimerOwner(client)
					? 'timer_not_host'
					: 'not_ready_or_not_controller',
		})
		return
	}

	if (
		isHeadToHeadLobbyType(lobby.lobbyType) &&
		!isClientReadyForAnteTimer(client)
	) {
		traceRuntimeEvent('ante_timer.start_ignored', {
			...buildLobbyTimerTraceFields(client, lobby),
			reason: 'not_ready_for_pvp',
		})
		return
	}

	const initialSharedTime = lobby.anteTimer.lockedForAnte
		? undefined
		: getLobbyAnteTimerStartTime(lobby, client)
	const normalizedTime = lobby.anteTimer.setRunning(initialSharedTime)
	const action = buildLobbyAnteTimerAction(lobby)

	traceRuntimeEvent('ante_timer.started', buildAnteTimerTraceFields(client, lobby, normalizedTime))
	sendAnteTimerAction(lobby, action)
	scheduleAnteTimerExpiry(lobby)
}

export const pauseAnteTimerAction = (
	client: Client,
	intent: AnteTimerIntent = {},
) => {
	const [lobby, enemies] = getEnemies(client)
	if (!lobby || lobby.options.timer !== true) {
		traceRuntimeEvent('ante_timer.pause_ignored', {
			playerId: client.id,
			reason: lobby ? 'timer_disabled' : 'no_lobby',
		})
		return
	}

	if (
		relayLocalTimerAction(
			client,
			lobby,
			enemies,
			{ action: 'pauseAnteTimer' },
			intent.localTimer === true,
		)
	) {
		return
	}

	if (
		!isHeadToHeadLobbyType(lobby.lobbyType) &&
		!canClientPauseGroupAnteTimer(client)
	) {
		traceRuntimeEvent('ante_timer.pause_ignored', {
			...buildLobbyTimerTraceFields(client, lobby),
			reason:
				isHostOnlyTimer(lobby) && !isLobbyTimerOwner(client)
					? 'timer_not_host'
					: 'not_controller',
		})
		return
	}

	if (
		isHeadToHeadLobbyType(lobby.lobbyType) &&
		!isClientReadyForAnteTimer(client)
	) {
		traceRuntimeEvent('ante_timer.pause_ignored', {
			...buildLobbyTimerTraceFields(client, lobby),
			reason: 'not_ready_for_pvp',
		})
		return
	}

	const normalizedTime = lobby.anteTimer.setPaused()
	const action = buildLobbyAnteTimerAction(lobby)

	traceRuntimeEvent('ante_timer.paused', buildAnteTimerTraceFields(client, lobby, normalizedTime))
	sendAnteTimerAction(lobby, action)
}
