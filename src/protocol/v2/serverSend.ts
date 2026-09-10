import type { ActionServerToClient } from '../../actions.js'
import { COOP_SAVE_SERVER_ROUTES } from './routeDescriptors/coopSave.js'
import { ENDGAME_SERVER_ROUTES } from './routeDescriptors/endgame.js'
import { FEATURE_SERVER_ROUTES } from './routeDescriptors/feature.js'
import { LOBBY_SERVER_ROUTES } from './routeDescriptors/lobby.js'
import { MATCH_SERVER_ROUTES } from './routeDescriptors/match.js'
import { SYNC_ROUTES } from './routeDescriptors/sync.js'
import { TEAM_SERVER_ROUTES } from './routeDescriptors/team.js'
import {
	isUtilityServerAction,
	sendProtocolV2EnvelopeOrUtilityAction,
} from './serverEnvelope.js'
import {
	type ProtocolServerActionForRouteSpecs,
	type ProtocolV2CapableClient,
	sendProtocolServerAction,
} from './serverSend/shared.js'
export {
	sendSystemConnected,
	sendSystemError,
	sendSystemRequestVersion,
} from './serverSend/system.js'
import {
	type LegacyOnlyServerAction,
	sendUtilityServerAction,
} from './serverSend/utility.js'
export { type LegacyOnlyServerAction, sendUtilityServerAction }

export type CoopSaveProtocolServerAction =
	ProtocolServerActionForRouteSpecs<typeof COOP_SAVE_SERVER_ROUTES>
export const sendCoopSaveServerAction: (
	client: ProtocolV2CapableClient,
	action: CoopSaveProtocolServerAction,
) => void = sendProtocolServerAction

export type EndgameProtocolServerAction =
	ProtocolServerActionForRouteSpecs<typeof ENDGAME_SERVER_ROUTES>
export const sendEndgameServerAction: (
	client: ProtocolV2CapableClient,
	action: EndgameProtocolServerAction,
) => void = sendProtocolServerAction

export type FeatureProtocolServerAction =
	ProtocolServerActionForRouteSpecs<typeof FEATURE_SERVER_ROUTES>
export const sendFeatureServerAction: (
	client: ProtocolV2CapableClient,
	action: FeatureProtocolServerAction,
) => void = sendProtocolServerAction

export type LobbyProtocolServerAction =
	ProtocolServerActionForRouteSpecs<typeof LOBBY_SERVER_ROUTES>
export const sendLobbyServerAction: (
	client: ProtocolV2CapableClient,
	action: LobbyProtocolServerAction,
) => void = sendProtocolServerAction

export type MatchProtocolServerAction =
	ProtocolServerActionForRouteSpecs<typeof MATCH_SERVER_ROUTES>
export const sendMatchServerAction: (
	client: ProtocolV2CapableClient,
	action: MatchProtocolServerAction,
) => void = sendProtocolServerAction

export type SyncProtocolServerAction =
	ProtocolServerActionForRouteSpecs<typeof SYNC_ROUTES>
export const sendSyncServerAction: (
	client: ProtocolV2CapableClient,
	action: SyncProtocolServerAction,
) => void = sendProtocolServerAction

export type TeamProtocolServerAction =
	ProtocolServerActionForRouteSpecs<typeof TEAM_SERVER_ROUTES>
export const sendTeamServerAction: (
	client: ProtocolV2CapableClient,
	action: TeamProtocolServerAction,
) => void = sendProtocolServerAction

export const sendServerAction = (
	client: ProtocolV2CapableClient,
	action: ActionServerToClient | LegacyOnlyServerAction,
) => {
	if (isUtilityServerAction(action.action)) {
		sendUtilityServerAction(client, action as LegacyOnlyServerAction)
		return
	}

	sendProtocolV2EnvelopeOrUtilityAction(client, action as ActionServerToClient)
}
