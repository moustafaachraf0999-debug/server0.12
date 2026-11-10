import { InsaneInt, parseFiniteInsaneInt } from './InsaneInt.js'
import type Client from './Client.js'
import type Lobby from './Lobby.js'
import type {
	ActionBlindPreview,
	ActionHandlerArgs,
	ActionPlayHand,
	BlindKind,
	BlindRow,
} from './actions.js'
import { sumScoreValues } from './blindScoring.js'
import {
	loseLobbyTeamLife,
	resetLobbyTeamLifeBlocker,
} from './lobbyPlayerState/lives.js'
import { broadcastLobbyMatchPlayerStates } from './lobbyPlayerState/broadcasts.js'
import { finalizeMatchResults, resolveTeamsGameOver } from './matchGameOver.js'
import {
	clearPlayerActiveBlindState,
	clearPlayerCoopBlindState,
	clearPlayerStartedBlindRuntimeState,
	preparePlayerForStartedBlind,
} from './playerState.js'
import { sendMatchServerAction } from './protocol/v2/index.js'
import { isCoopLobbyType } from './lobbyTypes.js'
import {
	getClientSharedSyncGroupId,
	getLobbyActiveSharedSyncGroupPlayers,
	lobbyUsesSharedSyncGroup,
} from './sharedSyncGroups.js'

const endTeamCoopBlind = (players: Client[], lost: boolean) =>
	players.forEach((player) => {
		clearPlayerStartedBlindRuntimeState(player)
		sendMatchServerAction(player, { action: 'endCoopBlind', lost })
	})

const resendResolvedTeamCoopBlindToClient = (
	client: Client,
	lost: boolean,
) => {
	clearPlayerStartedBlindRuntimeState(client)
	sendMatchServerAction(client, { action: 'endCoopBlind', lost })
}

type CoopBlindGroup = {
	lobby: Lobby
	groupId: number
	players: Client[]
	isGlobalCoop: boolean
}

const getCoopBlindGroupById = (
	lobby: Lobby,
	groupId: number,
): CoopBlindGroup | null => {
	if (!lobbyUsesSharedSyncGroup(lobby)) {
		return null
	}

	const players = getLobbyActiveSharedSyncGroupPlayers(lobby, groupId)
	if (players.length === 0) {
		return null
	}

	return {
		lobby,
		groupId,
		players,
		isGlobalCoop: isCoopLobbyType(lobby.lobbyType),
	}
}

const getCoopBlindGroup = (client: Client) => {
	const lobby = client.lobby
	if (!lobby) {
		return null
	}

	return getCoopBlindGroupById(lobby, getClientSharedSyncGroupId(client))
}

const parseReportedBlindTarget = (
	blindTarget: unknown,
) => {
	if (typeof blindTarget !== 'string' || blindTarget.length === 0) {
		return null
	}

	return parseFiniteInsaneInt(blindTarget)
}

const PREVIEW_BLIND_ROWS: readonly BlindRow[] = ['Small', 'Big', 'Boss']

const normalizeAggregateBlindTarget = (blindTarget: InsaneInt) => {
	const normalized = InsaneInt.fromString(blindTarget)
	normalized.balance()

	if (normalized.startingECount === 0 && normalized.exponent === 0) {
		return new InsaneInt(0, Math.round(normalized.coefficient), 0)
	}

	return normalized
}

const aggregateBlindTargets = (targets: InsaneInt[]) => {
	if (targets.length === 0) {
		return null
	}

	// Averaging identical targets can float-inflate the requirement above the displayed value.
	if (targets.every((target) => target.equalTo(targets[0]))) {
		return normalizeAggregateBlindTarget(targets[0])
	}

	const summedTargets = sumScoreValues(targets)
	const aggregateTarget = summedTargets.div(new InsaneInt(0, targets.length, 0))
	return normalizeAggregateBlindTarget(aggregateTarget)
}

const aggregateReadyBlindTargets = (
	players: Client[],
	fallbackBlindTarget: unknown,
) => {
	const targets = players
		.map((player) => parseReportedBlindTarget(player.readyBlindTarget))
		.filter((target): target is InsaneInt => target != null)

	if (targets.length === players.length && targets.length > 0) {
		return aggregateBlindTargets(targets)
	}

	const fallbackTarget = parseReportedBlindTarget(fallbackBlindTarget)
	return fallbackTarget ? normalizeAggregateBlindTarget(fallbackTarget) : null
}

const aggregatePreviewBlindTarget = (
	players: Client[],
	previewKey: string,
	row: BlindRow,
) => {
	const targets = players
		.map((player) =>
			player.blindPreviewKey === previewKey
				? parseReportedBlindTarget(player.blindPreviewTargets[row])
				: null,
		)
		.filter((target): target is InsaneInt => target != null)

	if (targets.length !== players.length) {
		return null
	}

	return aggregateBlindTargets(targets)
}

export const blindPreviewAction = (
	{ previewKey, targets }: ActionHandlerArgs<ActionBlindPreview>,
	client: Client,
) => {
	if (!client.isInMatch) {
		return
	}

	const group = getCoopBlindGroup(client)
	if (!group) {
		return
	}

	client.blindPreviewKey = previewKey
	client.blindPreviewTargets = { ...targets }

	const { players } = group
	const aggregateTargets: Partial<Record<BlindRow, string>> = {}
	for (const row of PREVIEW_BLIND_ROWS) {
		const aggregateTarget = aggregatePreviewBlindTarget(
			players,
			previewKey,
			row,
		)
		if (aggregateTarget) {
			aggregateTargets[row] = aggregateTarget.toString()
		}
	}

	for (const player of players) {
		sendMatchServerAction(player, {
			action: 'coopBlindPreview',
			previewKey,
			targets: aggregateTargets,
		})
	}
}

export const startTeamCoopBlindIfReady = (
	client: Client,
	blindKind: BlindKind,
	blindTarget: string | null = client.readyBlindTarget,
) => {
	if (blindKind === 'pvp') {
		return false
	}

	const group = getCoopBlindGroup(client)
	if (!group) {
		return false
	}

	const { lobby, groupId, players, isGlobalCoop } = group
	lobby.teamState.deleteBlindTarget(groupId)
	const aggregateBlindTarget = aggregateReadyBlindTargets(
		players,
		blindTarget,
	)
	if (aggregateBlindTarget) {
		lobby.teamState.setBlindTarget(groupId, aggregateBlindTarget)
	}
	if (isGlobalCoop) {
		lobby.teamState.clearLifeBlockers()
	} else {
		resetLobbyTeamLifeBlocker(lobby, groupId)
	}
	lobby.teamState.deleteResolvedCoopTeam(groupId)

	for (const player of players) {
		preparePlayerForStartedBlind(player, true)
	}
	lobby.matchReplay.recordEvent({
		actorId: client.id,
		scope: 'team',
		scopeId: groupId,
		type: 'COOP_BLIND_START',
		data: {
			blindKind,
			blindTarget: aggregateBlindTarget?.toString(),
			playerIds: players.map((player) => player.id),
		},
	})

	for (const player of players) {
		sendMatchServerAction(player, {
			action: 'startBlind',
			blindTarget: aggregateBlindTarget?.toString(),
		})
	}
	broadcastLobbyMatchPlayerStates(lobby, players)

	return true
}

const getReservedCoopBlindStates = (group: CoopBlindGroup) => {
	const { lobby, groupId, isGlobalCoop } = group
	return lobby
		.getDisconnectedSlots()
		.map((slot) => slot.savedState)
		.filter(
			(state) =>
				state.isInMatch &&
				state.coopBlindActive &&
				(isGlobalCoop || (state.team ?? 1) === groupId),
		)
}

const getCoopBlindSnapshot = (group: CoopBlindGroup) => {
	const { players } = group
	const reservedStates = getReservedCoopBlindStates(group)
	return {
		teamScore: sumScoreValues([
			...players.map((player) => player.score),
			...reservedStates.map((state) => state.score),
		]),
		allTeammatesFinished:
			players.every((player) => player.handsLeft === 0) &&
			reservedStates.every((state) => state.handsLeft === 0),
	}
}

const resolveTeamCoopBlindFailureForGroup = (
	group: CoopBlindGroup,
	client?: Client,
) => {
	const { lobby, groupId, players, isGlobalCoop } = group
	if (lobby.teamState.hasResolvedCoopTeam(groupId)) {
		if (client) {
			resendResolvedTeamCoopBlindToClient(
				client,
				lobby.teamState.getResolvedCoopTeamLost(groupId) ?? false,
			)
		}
		return true
	}

	lobby.teamState.deleteBlindTarget(groupId)

	if (isGlobalCoop) {
		lobby.teamState.addResolvedCoopTeam(groupId, true)
		for (const player of players) {
			clearPlayerCoopBlindState(player)
			clearPlayerActiveBlindState(player)
		}
		finalizeMatchResults(lobby, players, { losers: players })
		return true
	}

	const remainingLives = loseLobbyTeamLife(
		lobby,
		groupId,
		'team_coop_blind_failed',
	)
	lobby.teamState.addResolvedCoopTeam(groupId, true)
	if (remainingLives <= 0) {
		for (const player of players) {
			clearPlayerCoopBlindState(player)
			clearPlayerActiveBlindState(player)
		}
		resolveTeamsGameOver(lobby, groupId)
		return true
	}

	endTeamCoopBlind(players, true)
	return true
}

const tryResolveTeamCoopBlind = (
	group: CoopBlindGroup,
	parsedBlindTarget: InsaneInt | null = null,
	client?: Client,
) => {
	const { lobby, groupId, players } = group
	if (!lobby.teamState.getBlindTarget(groupId) && parsedBlindTarget) {
		lobby.teamState.setBlindTarget(groupId, parsedBlindTarget)
	}

	const { teamScore, allTeammatesFinished } = getCoopBlindSnapshot(group)
	const teamBlindTarget =
		lobby.teamState.getBlindTarget(groupId) ?? parsedBlindTarget

	if (!teamBlindTarget && !allTeammatesFinished) {
		return true
	}
	if (!teamBlindTarget) {
		return resolveTeamCoopBlindFailureForGroup(group, client)
	}

	if (!teamScore.lessThan(teamBlindTarget)) {
		lobby.teamState.addResolvedCoopTeam(groupId, false)
		lobby.teamState.deleteBlindTarget(groupId)
		endTeamCoopBlind(players, false)
		return true
	}

	if (!allTeammatesFinished) {
		return true
	}

	return resolveTeamCoopBlindFailureForGroup(group, client)
}

export const resolveTeamCoopBlindAfterRosterChange = (
	lobby: Lobby,
	groupId: number,
) => {
	if (!lobby.isInGame) {
		return false
	}

	const group = getCoopBlindGroupById(lobby, groupId)
	if (!group) {
		return false
	}

	if (lobby.teamState.hasResolvedCoopTeam(groupId)) {
		return false
	}

	if (!lobby.teamState.getBlindTarget(groupId)) {
		return false
	}

	if (!group.players.some((player) => player.coopBlindActive)) {
		return false
	}

	return tryResolveTeamCoopBlind(group)
}

export const handleTeamCoopBlindRoundFailure = (client: Client) => {
	const group = getCoopBlindGroup(client)
	if (!group) {
		return false
	}

	const { lobby, groupId, players } = group
	if (lobby.teamState.hasResolvedCoopTeam(groupId)) {
		resendResolvedTeamCoopBlindToClient(
			client,
			lobby.teamState.getResolvedCoopTeamLost(groupId) ?? false,
		)
		return true
	}

	if (!client.coopBlindActive) {
		return false
	}

	client.handsLeft = 0
	broadcastLobbyMatchPlayerStates(lobby, players)
	return handleTeamCoopBlindPlayHand(undefined, client)
}

export const handleTeamCoopBlindPlayHand = (
	blindTarget: ActionHandlerArgs<ActionPlayHand>['blindTarget'],
	client: Client,
) => {
	const group = getCoopBlindGroup(client)
	if (!group) {
		return false
	}

	const { lobby, groupId } = group
	if (lobby.teamState.hasResolvedCoopTeam(groupId)) {
		resendResolvedTeamCoopBlindToClient(
			client,
			lobby.teamState.getResolvedCoopTeamLost(groupId) ?? false,
		)
		return true
	}

	if (!client.coopBlindActive) {
		return false
	}

	return tryResolveTeamCoopBlind(
		group,
		parseReportedBlindTarget(blindTarget),
		client,
	)
}
