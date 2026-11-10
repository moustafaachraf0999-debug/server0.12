import type Client from './Client.js'
import type Lobby from './Lobby.js'
import type { ActionHandlerArgs } from './actions.js'
import type {
	ActionMatchReplayCheckpointRequest,
	ActionSpectatorActionStreamRequest,
	ActionSpectatorProvideSnapshotRequest,
	ActionSpectatorRequestSnapshotRequest,
	ActionSpectatorSetRoleRequest,
	ActionSpectatorWatchTargetRequest,
} from './actionClientFeatureRelay.js'
import type { ActionSpectatorHistory } from './actionServerFeatureRelay.js'
import { broadcastLobbyPlayerUpdated } from './lobbyBroadcasts.js'
import { sendFeatureServerAction } from './protocol/v2/index.js'

export type {
	ActionMatchReplayCheckpointRequest,
	ActionSpectatorActionStreamRequest,
	ActionSpectatorProvideSnapshotRequest,
	ActionSpectatorRequestSnapshotRequest,
	ActionSpectatorSetRoleRequest,
	ActionSpectatorWatchTargetRequest,
}

export const matchReplayCheckpointAction = (
	{ stepIndex, position, snapshotData }: ActionHandlerArgs<ActionMatchReplayCheckpointRequest>,
	client: Client,
) => {
	const lobby = client.lobby
	if (!lobby || client.isSpectator || !client.isInMatch) return
	lobby.matchReplay.captureCheckpoint(client.id, { stepIndex, position, snapshotData })
}

export const spectatorActionStreamAction = (
	{ actionData, stepIndex }: ActionHandlerArgs<ActionSpectatorActionStreamRequest>,
	client: Client,
) => {
	const lobby = client.lobby
	if (!lobby) return

	// Only active players stream their own actions into the replay log.
	if (!client.isInMatch) return

	lobby.appendPlayerAction(client.id, { actionData, stepIndex })

	for (const [spectatorId, targetId] of lobby.spectatorTargets.entries()) {
		if (targetId === client.id) {
			const spectator = lobby.getPlayer(spectatorId)
			if (spectator) {
				sendFeatureServerAction(spectator, {
					action: 'spectatorActionStream',
					playerId: client.id,
					actionData,
					stepIndex,
				})
			}
		}
	}
}

const isWatchableTarget = (lobby: NonNullable<Client['lobby']>, targetPlayerId: string) => {
	const targetClient = lobby.getPlayer(targetPlayerId)
	if (!targetClient) return false
	if (targetClient.isSpectator) return false
	if (!targetClient.isInMatch) return false
	return true
}

export const spectatorWatchTargetAction = (
	{ targetPlayerId }: ActionHandlerArgs<ActionSpectatorWatchTargetRequest>,
	client: Client,
) => {
	const lobby = client.lobby
	if (!lobby) return

	if (!client.isSpectator) {
		if (client.isInMatch) return
		client.role = 'spectator'
		client.isSpectator = true
		client.isReadyLobby = false
		broadcastLobbyPlayerUpdated(lobby, client)
	}

	if (!isWatchableTarget(lobby, targetPlayerId)) {
		lobby.spectatorTargets.delete(client.id)
		return
	}

	// Same target: do not pull another 6–12KB board. Snapshot is only for
	// an actual switch.
	if (lobby.spectatorTargets.get(client.id) === targetPlayerId) {
		return
	}

	lobby.spectatorTargets.set(client.id, targetPlayerId)

	sendSpectatorSnapshotRequest(lobby, client.id, targetPlayerId)
	sendSpectatorHistory(lobby, client, targetPlayerId)
}

/** Minimum spacing between snapshot requests from the same spectator. */
const SNAPSHOT_REQUEST_COOLDOWN_MS = 1000

export const spectatorRequestSnapshotAction = (
	{ targetPlayerId }: ActionHandlerArgs<ActionSpectatorRequestSnapshotRequest>,
	client: Client,
) => {
	const lobby = client.lobby
	if (!lobby) return

	if (!client.isSpectator) {
		if (client.isInMatch) return
		client.role = 'spectator'
		client.isSpectator = true
		client.isReadyLobby = false
		broadcastLobbyPlayerUpdated(lobby, client)
	}
	if (lobby.spectatorTargets.get(client.id) !== targetPlayerId) return
	if (!isWatchableTarget(lobby, targetPlayerId)) return

	const lastRequestAt = lobby.spectatorSnapshotRequestAt.get(client.id) ?? 0
	if (Date.now() - lastRequestAt < SNAPSHOT_REQUEST_COOLDOWN_MS) return
	lobby.spectatorSnapshotRequestAt.set(client.id, Date.now())

	sendSpectatorSnapshotRequest(lobby, client.id, targetPlayerId)
}

export const spectatorProvideSnapshotAction = (
	{ spectatorPlayerId, targetPlayerId, snapshotData }: ActionHandlerArgs<ActionSpectatorProvideSnapshotRequest>,
	client: Client,
) => {
	const lobby = client.lobby
	if (!lobby) return

	// The provider must be the target that the spectator is actually watching.
	if (lobby.spectatorTargets.get(spectatorPlayerId) !== client.id) return
	if (targetPlayerId !== client.id) return

	const spectator = lobby.getPlayer(spectatorPlayerId)
	if (!spectator) return

	sendFeatureServerAction(spectator, {
		action: 'spectatorReceiveSnapshot',
		targetPlayerId,
		snapshotData,
	})
}

export const spectatorSetRoleAction = (
	{ role }: ActionHandlerArgs<ActionSpectatorSetRoleRequest>,
	client: Client,
) => {
	const lobby = client.lobby
	if (!lobby) return

	// Active players still in an ongoing match cannot abandon to spectator mid-run.
	// Eliminated players (!client.isInMatch) or players between matches may switch to spectator.
	if (lobby.isInGame && client.isInMatch) return

	const nextRole = role === 'spectator' ? 'spectator' : 'player'
	if (client.role === nextRole) return

	client.role = nextRole
	client.isSpectator = nextRole === 'spectator'
	if (client.isSpectator) {
		client.isReadyLobby = false
		client.isInMatch = false
	} else {
		lobby.removeSpectatorState(client.id)
	}

	broadcastLobbyPlayerUpdated(lobby, client)
}

const sendSpectatorSnapshotRequest = (
	lobby: NonNullable<Client['lobby']>,
	spectatorId: string,
	targetPlayerId: string,
) => {
	const targetClient = lobby.getPlayer(targetPlayerId)
	if (!targetClient || !targetClient.isInMatch) return

	sendFeatureServerAction(targetClient, {
		action: 'spectatorRequestSnapshot',
		spectatorPlayerId: spectatorId,
	})
}

export const buildSpectatorHistoryAction = (
	targetPlayerId: string,
	matchConfig: Lobby['matchStartConfig'],
) => ({
	action: 'spectatorHistory',
	targetPlayerId,
	seed: matchConfig?.seed,
	stake: matchConfig?.stake,
	back: matchConfig?.back,
	challenge: matchConfig?.challenge,
	sleeve: matchConfig?.sleeve,
	cocktail: matchConfig?.cocktail,
} satisfies ActionSpectatorHistory)

const sendSpectatorHistory = (
	lobby: NonNullable<Client['lobby']>,
	spectator: Client,
	targetPlayerId: string,
) => {
	sendFeatureServerAction(
		spectator,
		buildSpectatorHistoryAction(targetPlayerId, lobby.matchStartConfig),
	)
}
