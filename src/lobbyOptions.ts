import type { LobbyOptionWireValue, LobbyType } from './actions.js'
import contractData from './lobbyOptionContract.json' with { type: 'json' }
import {
	isCoopLobbyType,
	isDuelsLobbyType,
	isHeadToHeadLobbyType,
	isTeamLobbyType,
} from './lobbyTypes.js'

export interface LobbyOptions {
	back?: string
	bonus_consumable_slots?: number
	bonus_discards?: number
	bonus_hands?: number
	bonus_joker_slots?: number
	bonus_money?: number
	challenge?: string
	cocktail?: string
	custom_bans?: string
	coop_blind_scaling_per_player?: number
	custom_seed?: string
	death_on_round_loss?: boolean
	different_decks?: boolean
	different_seeds?: boolean
	disable_live_and_timer_hud?: boolean
	forced_config?: boolean
	gold_on_life_loss?: boolean
	legacy_smallworld?: boolean
	max_players?: number
	modifier_layers?: string
	disable_asteroid?: boolean
	multiplayer_jokers?: boolean
	no_gold_on_round_loss?: boolean
	normal_bosses?: boolean
	preview_disabled?: boolean
	pvp_custom_winners?: number
	pvp_custom_winners_percent?: number
	pvp_score_rule?: PvpScoreRule
	random_loadout?: boolean
	team_card_sync?: boolean
	team_hand_level_sync?: boolean
	team_money_sync?: boolean
	pvp_start_round?: number
	ruleset?: string
	showdown_starting_antes?: number
	sleeve?: string
	stake?: number
	starting_lives?: number
	the_order?: boolean
	timer?: boolean
	timer_base_seconds?: number
	timer_forgiveness?: number
	timer_increment_seconds?: number
	timer_ownership?: TimerOwnership
	weekly?: string
	[key: string]: string | number | boolean | undefined
}

export const PVP_SCORE_RULES = [
	'highest',
	'average',
	'median',
	'geometric',
	'custom',
] as const

export type PvpScoreRule = (typeof PVP_SCORE_RULES)[number]

export const TIMER_OWNERSHIP_MODES = ['anyone', 'host'] as const

export type TimerOwnership = (typeof TIMER_OWNERSHIP_MODES)[number]

const TIMER_OWNERSHIP_SET = new Set<string>(TIMER_OWNERSHIP_MODES)

export const DEFAULT_TIMER_OWNERSHIP: TimerOwnership = 'anyone'

const PVP_SCORE_RULE_SET = new Set<string>(PVP_SCORE_RULES)

export const isValidPvpScoreRule = (
	value: string | undefined,
): value is PvpScoreRule => !!value && PVP_SCORE_RULE_SET.has(value)

export const isValidTimerOwnership = (
	value: string | undefined,
): value is TimerOwnership => !!value && TIMER_OWNERSHIP_SET.has(value)

type LobbyOptionContract = {
	booleanKeys: string[]
	numericKeys: string[]
	stringKeys: string[]
	sharedDeckKeys: string[]
	baseDefaults: Record<string, string | number | boolean>
	groupLobbyDefaults: Record<string, string | number | boolean>
}

const LOBBY_OPTION_CONTRACT = contractData as LobbyOptionContract

const BOOLEAN_LOBBY_OPTION_KEYS = new Set<string>(
	LOBBY_OPTION_CONTRACT.booleanKeys,
)

const NUMERIC_LOBBY_OPTION_KEYS = new Set<string>(
	LOBBY_OPTION_CONTRACT.numericKeys,
)

const STRING_LOBBY_OPTION_KEYS = new Set<string>(
	LOBBY_OPTION_CONTRACT.stringKeys,
)

const normalizeBooleanLobbyOption = (
	value: LobbyOptionWireValue | undefined,
): boolean | undefined => {
	if (typeof value === 'boolean') {
		return value
	}
	if (value === 'true') {
		return true
	}
	if (value === 'false') {
		return false
	}
	return undefined
}

const normalizeNumberLobbyOption = (
	value: LobbyOptionWireValue | undefined,
): number | undefined => {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.trunc(value)
	}
	if (typeof value === 'string') {
		const trimmed = value.trim()
		if (!trimmed) {
			return undefined
		}

		const parsed = Number.parseInt(trimmed, 10)
		if (Number.isFinite(parsed)) {
			return parsed
		}
	}
	return undefined
}

const normalizeFiniteNumberLobbyOption = (
	value: LobbyOptionWireValue | undefined,
): number | undefined => {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value
	}
	if (typeof value === 'string') {
		const trimmed = value.trim()
		if (!trimmed) {
			return undefined
		}

		const parsed = Number.parseFloat(trimmed)
		if (Number.isFinite(parsed)) {
			return parsed
		}
	}
	return undefined
}

export const normalizeLobbyOptionString = (
	value: LobbyOptionWireValue | undefined,
): string | undefined => {
	if (typeof value === 'string') {
		return value
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value)
	}
	return undefined
}

const normalizePvpScoreRule = (
	value: LobbyOptionWireValue | undefined,
): PvpScoreRule | undefined => {
	const normalized = normalizeLobbyOptionString(value)
	return isValidPvpScoreRule(normalized) ? normalized : undefined
}

const normalizeTimerOwnershipOption = (
	value: LobbyOptionWireValue | undefined,
): TimerOwnership | undefined => {
	const normalized = normalizeLobbyOptionString(value)
	return isValidTimerOwnership(normalized) ? normalized : undefined
}

export const normalizeLobbyOptionValue = (
	key: string,
	value: LobbyOptionWireValue | undefined,
): string | number | boolean | undefined => {
	if (key === 'coop_blind_scaling_per_player') {
		return normalizeFiniteNumberLobbyOption(value)
	}

	if (key === 'pvp_score_rule') {
		return normalizePvpScoreRule(value)
	}

	if (key === 'timer_ownership') {
		return normalizeTimerOwnershipOption(value)
	}

	if (BOOLEAN_LOBBY_OPTION_KEYS.has(key)) {
		return normalizeBooleanLobbyOption(value)
	}

	if (NUMERIC_LOBBY_OPTION_KEYS.has(key)) {
		return normalizeNumberLobbyOption(value)
	}

	if (STRING_LOBBY_OPTION_KEYS.has(key)) {
		return normalizeLobbyOptionString(value)
	}

	return undefined
}

const BASE_DEFAULT_LOBBY_OPTIONS = {
	...LOBBY_OPTION_CONTRACT.baseDefaults,
} as LobbyOptions

const GROUP_DEFAULT_LOBBY_OPTIONS = {
	...LOBBY_OPTION_CONTRACT.groupLobbyDefaults,
} as LobbyOptions

const HEAD_TO_HEAD_LOBBY_OPTIONS = {
	max_players: 2,
	pvp_custom_winners: 1,
	pvp_custom_winners_percent: 0,
	pvp_score_rule: 'highest',
} as LobbyOptions

const DUELS_LOBBY_OPTIONS = {
	pvp_score_rule: 'highest',
} as LobbyOptions

export const getDefaultCustomWinnerCount = (maxPlayers: number | undefined) =>
	Math.min(
		getCustomWinnerLimit(maxPlayers),
		Math.max(1, Math.ceil(Math.max(1, maxPlayers ?? 1) / 2)),
	)

export const getCustomWinnerLimit = (maxPlayers: number | undefined) =>
	Math.max(1, Math.trunc(Math.max(1, maxPlayers ?? 1)) - 1)

const getCustomWinnerCountFromPercent = (
	percent: number,
	entryCount: number,
) => Math.floor((entryCount * percent) / 100 + 0.5)

export const getLobbyCustomWinnerCount = (
	options: LobbyOptions | undefined,
	entryCount?: number,
) => {
	const maxPlayers = Math.max(1, Math.trunc(Number(options?.max_players) || 1))
	const maxEntries = Math.max(1, Math.trunc(entryCount ?? maxPlayers))
	const maxWinners = Math.min(
		getCustomWinnerLimit(maxPlayers),
		Math.max(1, maxEntries - 1),
	)
	const configuredPercent = Math.trunc(
		Number(options?.pvp_custom_winners_percent),
	)
	const configuredCount = Math.trunc(Number(options?.pvp_custom_winners))
	const winnerCount =
		Number.isFinite(configuredPercent) && configuredPercent > 0
			? getCustomWinnerCountFromPercent(
					Math.min(100, configuredPercent),
					maxEntries,
			  )
			: Number.isFinite(configuredCount)
			  ? configuredCount
			  : getDefaultCustomWinnerCount(maxPlayers)

	return Math.max(1, Math.min(maxWinners, winnerCount))
}

export const getLobbyOptionsScoreRule = (
	options: LobbyOptions | undefined,
): PvpScoreRule => {
	if (isValidPvpScoreRule(options?.pvp_score_rule)) {
		return options.pvp_score_rule
	}

	return 'highest'
}

export const getLobbyTypeLockedOptions = (
	lobbyType: LobbyType,
): LobbyOptions =>
	isHeadToHeadLobbyType(lobbyType)
		? { ...HEAD_TO_HEAD_LOBBY_OPTIONS }
		: isDuelsLobbyType(lobbyType)
		  ? { ...DUELS_LOBBY_OPTIONS }
		  : {}

const getLobbyTypeDefaultOptionOverrides = (
	lobbyType: LobbyType,
): LobbyOptions => ({
	team_card_sync: isTeamLobbyType(lobbyType) || isCoopLobbyType(lobbyType),
})

export const getLobbyTypeChangeOptionUpdates = (
	previousLobbyType: LobbyType,
	nextLobbyType: LobbyType,
): LobbyOptions => {
	if (isHeadToHeadLobbyType(nextLobbyType)) {
		return {
			...getLobbyTypeDefaultOptionOverrides(nextLobbyType),
			...getLobbyTypeLockedOptions(nextLobbyType),
		}
	}

	const groupResetOptions = isHeadToHeadLobbyType(previousLobbyType)
		? {
				max_players: GROUP_DEFAULT_LOBBY_OPTIONS.max_players,
				pvp_custom_winners: GROUP_DEFAULT_LOBBY_OPTIONS.pvp_custom_winners,
		  }
		: {}

	if (isDuelsLobbyType(nextLobbyType)) {
		return {
			...getLobbyTypeDefaultOptionOverrides(nextLobbyType),
			...groupResetOptions,
			...getLobbyTypeLockedOptions(nextLobbyType),
		}
	}

	return {
		...getLobbyTypeDefaultOptionOverrides(nextLobbyType),
		...groupResetOptions,
	}
}

export const getDefaultLobbyOptions = (lobbyType: LobbyType): LobbyOptions => ({
	...BASE_DEFAULT_LOBBY_OPTIONS,
	...(isHeadToHeadLobbyType(lobbyType) ? {} : GROUP_DEFAULT_LOBBY_OPTIONS),
	...getLobbyTypeDefaultOptionOverrides(lobbyType),
	...getLobbyTypeLockedOptions(lobbyType),
})
