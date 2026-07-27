import type Client from './Client.js'
import Lobby from './Lobby.js'
import type {
	ActionCreateLobby,
	ActionHandlerArgs,
	ActionJoinLobby,
	ActionRejoinLobby,
} from './actions.js'
import {
	DEFAULT_LOBBY_ACCESS_MODE,
	isValidLobbyAccessMode,
} from './lobbyAccess.js'
import {
	sendInitialLobbyJoinedState,
	sendLobbyJoinRequestPending,
	sendLobbyJoinRequestReceived,
} from './lobbyBroadcasts.js'
import { refreshLobbyNemesisAssignmentsForLobby } from './lobbyNemesis.js'
import { applyLobbyOptions } from './lobbyOptionUpdates.js'
import { sendLobbyMatchStateToPlayer } from './lobbyPlayerState/broadcasts.js'
import {
	applyResolvedTeamBlindStateOnRejoin,
	rejoinLobbyClient,
	sendResolvedTeamBlindEndOnRejoin,
} from './lobbyReconnect/rejoin.js'
import { getLobbyByCode } from './lobbyRegistry.js'
import {
	getLobbyTypeForGameMode,
	isCoopLobbyType,
	isHeadToHeadLobbyType,
	isValidLobbyType,
} from './lobbyTypes.js'
import { getLobbyMaxPlayers } from './lobbyRules.js'
import { reconcileActiveMatchState } from './matchResolution.js'
import {
	recordLobbyCreated,
	recordLobbyEvent,
	recordMatchParticipantOutcome,
} from './monitor/monitorStore.js'
import { sendSystemError, sendTeamServerAction } from './protocol/v2/index.js'
import {
	syncTeamDeckForClient,
	syncTeamHandLevelsForClient,
} from './teamCardSyncHandlers.js'
import { isSharedSyncOptionEnabled } from './sharedSyncGroups.js'
import { isValidGameMode } from './gameModes.js'
import { canClientJoinCoopSaveLobby } from './coopSaveHandlers.js'

export const getLobbyJoinBlockMessage = (
	lobby: Lobby,
	client: Client,
): string | null => {
	if (lobby.isInGame) {
		return 'The match has already started.'
	}

	if (!canClientJoinCoopSaveLobby(lobby, client)) {
		return 'This saved co-op lobby belongs to different players.'
	}

	const maxPlayers = getLobbyMaxPlayers(lobby)
	if (lobby.getPlayerCount() >= maxPlayers) {
		return isHeadToHeadLobbyType(lobby.lobbyType)
			? '1v1 lobby is full (2 players max).'
			: `Lobby is full (${maxPlayers} players max)`
	}

	return null
}

export const joinLobbyClient = (lobby: Lobby, client: Client) => {
	const blockMessage = getLobbyJoinBlockMessage(lobby, client)
	if (blockMessage) {
		sendSystemError(client, blockMessage)
		return false
	}

	lobby.attachFreshClient(client)
	recordLobbyEvent(lobby, 'player.joined', `${client.username} joined the lobby`, {
		player: client,
	})
	refreshLobbyNemesisAssignmentsForLobby(lobby)
	sendInitialLobbyJoinedState(lobby, client)
	return true
}

export const syncJoinedLobbyClientState = (client: Client) => {
	syncTeamDeckForClient(client)
	syncTeamHandLevelsForClient(client)

	if (isSharedSyncOptionEnabled(client.lobby, 'team_money_sync')) {
		sendTeamServerAction(client, {
			action: 'moneyUpdate',
			money: client.reportedMoney,
		})
	}
}

const withCreateOptionDefaultsForGameMode = (
	gameMode: string,
	options: ActionHandlerArgs<ActionCreateLobby>['options'],
) => {
	const suppliedOptions =
		options && typeof options === 'object' ? options : {}
	if (
		gameMode === 'survival' &&
		!Object.prototype.hasOwnProperty.call(suppliedOptions, 'starting_lives')
	) {
		return { starting_lives: 1, ...suppliedOptions }
	}

	return suppliedOptions
}

export const createLobbyAction = (
	{ gameMode, lobbyType, options, accessMode }: ActionHandlerArgs<ActionCreateLobby>,
	client: Client,
) => {
	if (!isValidGameMode(gameMode)) {
		sendSystemError(client, 'Invalid game mode.')
		return
	}

	if (!isValidLobbyType(lobbyType)) {
		sendSystemError(client, 'Invalid lobby type.')
		return
	}

	if (gameMode !== 'coop' && isCoopLobbyType(lobbyType)) {
		sendSystemError(client, 'Co-op lobby type is controlled by co-op mode.')
		return
	}

	if (accessMode !== undefined && !isValidLobbyAccessMode(accessMode)) {
		sendSystemError(client, 'Invalid lobby access mode.')
		return
	}

	const resolvedLobbyType = getLobbyTypeForGameMode(gameMode, lobbyType)
	const lobby = new Lobby(
		client,
		gameMode,
		resolvedLobbyType,
		accessMode ?? DEFAULT_LOBBY_ACCESS_MODE,
	)
	recordLobbyCreated(lobby, client)
	const creationOptions = withCreateOptionDefaultsForGameMode(gameMode, options)
	applyLobbyOptions(
		lobby,
		{
			gamemode: lobby.getClientGamemodeKey(),
			...creationOptions,
		},
		false,
	)
	refreshLobbyNemesisAssignmentsForLobby(lobby)
	sendInitialLobbyJoinedState(lobby, client)
}

export const joinLobbyAction = (
	{ code }: ActionHandlerArgs<ActionJoinLobby>,
	client: Client,
) => {
	const newLobby = getLobbyByCode(code)
	if (!newLobby) {
		sendSystemError(client, 'Lobby does not exist.')
		return
	}

	if (newLobby.accessMode === 'ask_first') {
		const blockMessage = getLobbyJoinBlockMessage(newLobby, client)
		if (blockMessage) {
			sendSystemError(client, blockMessage)
			return
		}

		const request = newLobby.addPendingJoinRequest(client)
		const owner = newLobby.getPlayer(newLobby.ownerId)
		if (owner) {
			sendLobbyJoinRequestReceived(owner, request.requestId, client)
		}
		sendLobbyJoinRequestPending(client, newLobby.code)
		return
	}

	if (!joinLobbyClient(newLobby, client)) {
		return
	}
	syncJoinedLobbyClientState(client)
}

export const rejoinLobbyAction = (
	{ code, reconnectToken }: ActionHandlerArgs<ActionRejoinLobby>,
	client: Client,
) => {
	const lobby = getLobbyByCode(code)
	if (!lobby) {
		sendSystemError(client, 'Lobby no longer exists.')
		return
	}

	const savedState = rejoinLobbyClient(lobby, client, reconnectToken)
	if (!savedState) {
		sendSystemError(
			client,
			'Could not rejoin lobby. Token invalid or slot expired.',
		)
		return
	}

	recordLobbyEvent(lobby, 'player.rejoined', `${client.username} rejoined the lobby`, {
		player: client,
	})
	if (savedState.isInMatch) {
		recordMatchParticipantOutcome(lobby, client, 'in_match', {
			reason: 'rejoined',
		})
	}
	const resolvedTeamBlindState = applyResolvedTeamBlindStateOnRejoin(
		lobby,
		client,
		savedState,
	)
	syncJoinedLobbyClientState(client)
	sendLobbyMatchStateToPlayer(lobby, client)
	sendResolvedTeamBlindEndOnRejoin(client, resolvedTeamBlindState)
	reconcileActiveMatchState(lobby)
}
