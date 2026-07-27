import type Lobby from './Lobby.js'
import type Client from './Client.js'
import type { LobbyType } from './actions.js'
import { syncDuelNemesisAssignmentsForLobby } from './lobbyDuelCoordinator.js'
import { isDuelsLobbyType } from './lobbyTypes.js'

const stableNemesisHash = (value: string): number => {
	let hash = 2166136261
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return hash >>> 0
}

const rankPlayers = (
	lobbyCode: string,
	scope: string,
	players: Client[],
) =>
	[...players].sort((a, b) => {
		const scoreA = stableNemesisHash(`${lobbyCode}:${scope}:${a.id}`)
		const scoreB = stableNemesisHash(`${lobbyCode}:${scope}:${b.id}`)
		if (scoreA !== scoreB) {
			return scoreA - scoreB
		}

		return a.id.localeCompare(b.id)
	})

const getEligiblePlayers = (
	players: ReadonlyMap<string, Client>,
	requireActive: boolean,
) =>
	Array.from(players.values()).filter(
		(player) => !requireActive || player.isInMatch,
	)

const pairNemeses = (left: Client, right: Client) => {
	left.nemesisPlayerId = right.id
	right.nemesisPlayerId = left.id
}

const assignFfaNemeses = (lobbyCode: string, players: Client[]) => {
	const rankedPlayers = rankPlayers(lobbyCode, 'ffa-pairs', players)
	for (let index = 0; index + 1 < rankedPlayers.length; index += 2) {
		pairNemeses(rankedPlayers[index], rankedPlayers[index + 1])
	}
}

type TeamBucket = {
	teamId: number
	players: Client[]
}

const rankTeamBuckets = (
	lobbyCode: string,
	buckets: TeamBucket[],
	pairIndex: number,
) =>
	[...buckets]
		.filter((bucket) => bucket.players.length > 0)
		.sort((a, b) => {
			if (a.players.length !== b.players.length) {
				return b.players.length - a.players.length
			}

			const scoreA = stableNemesisHash(
				`${lobbyCode}:team-pairs:${pairIndex}:${a.teamId}`,
			)
			const scoreB = stableNemesisHash(
				`${lobbyCode}:team-pairs:${pairIndex}:${b.teamId}`,
			)
			if (scoreA !== scoreB) {
				return scoreA - scoreB
			}

			return a.teamId - b.teamId
		})

const assignTeamNemeses = (lobbyCode: string, players: Client[]) => {
	const bucketsByTeam = new Map<number, Client[]>()
	for (const player of players) {
		const teamId = player.team ?? 1
		bucketsByTeam.set(teamId, [...(bucketsByTeam.get(teamId) ?? []), player])
	}

	const buckets: TeamBucket[] = Array.from(bucketsByTeam.entries()).map(
		([teamId, teamPlayers]) => ({
			teamId,
			players: rankPlayers(lobbyCode, `team-${teamId}-players`, teamPlayers),
		}),
	)

	let pairIndex = 0
	while (true) {
		const [leftBucket, rightBucket] = rankTeamBuckets(
			lobbyCode,
			buckets,
			pairIndex,
		)
		if (!leftBucket || !rightBucket) {
			break
		}

		const left = leftBucket.players.shift()
		const right = rightBucket.players.shift()
		if (!left || !right) {
			break
		}

		pairNemeses(left, right)
		pairIndex += 1
	}
}

export const refreshLobbyNemesisAssignments = (
	lobbyCode: string,
	lobbyType: LobbyType,
	players: ReadonlyMap<string, Client>,
	requireActive: boolean,
): void => {
	if (isDuelsLobbyType(lobbyType)) {
		return
	}

	for (const player of players.values()) {
		player.nemesisPlayerId = null
	}

	const eligiblePlayers = getEligiblePlayers(players, requireActive)
	if (lobbyType === 'teams') {
		assignTeamNemeses(lobbyCode, eligiblePlayers)
	} else {
		assignFfaNemeses(lobbyCode, eligiblePlayers)
	}
}

export const refreshLobbyNemesisAssignmentsForLobby = (lobby: Lobby): void => {
	if (syncDuelNemesisAssignmentsForLobby(lobby)) {
		return
	}

	refreshLobbyNemesisAssignments(
		lobby.code,
		lobby.lobbyType,
		lobby.getPlayerMap(),
		lobby.isInGame,
	)
}
