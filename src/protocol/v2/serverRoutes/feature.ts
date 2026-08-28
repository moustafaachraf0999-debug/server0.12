import type { ActionHandlerArgs } from '../../../actions.js'
import type {
	ActionEatPizzaRequest,
	ActionMagnetResponseRequest,
	ActionModdedRequest,
	ActionRemovePhantomRequest,
	ActionSendPhantomRequest,
	ActionSpectatorActionStreamRequest,
	ActionSpectatorProvideSnapshotRequest,
	ActionSpectatorRequestSnapshotRequest,
	ActionSpectatorWatchTargetRequest,
	ActionSpectatorSetRoleRequest,
	ActionSpentLastShopRequest,
} from '../../../actionClientFeatureRelay.js'
import { moddedAction } from '../../../headToHeadHandlers.js'
import {
	asteroidAction,
	eatPizzaAction,
	letsGoGamblingNemesisAction,
	magnetAction,
	magnetResponseAction,
	removePhantomAction,
	sendPhantomAction,
	soldJokerAction,
	spentLastShopAction,
} from '../../../relayHandlers.js'
import {
	spectatorActionStreamAction,
	spectatorProvideSnapshotAction,
	spectatorRequestSnapshotAction,
	spectatorWatchTargetAction,
	spectatorSetRoleAction,
} from '../../../spectatorHandlers.js'
import { PROTOCOL_V2_SCHEMA_IDS } from '../schemaIds.js'
import {
	MAX_ENCODED_CARD_PAYLOAD_LENGTH,
	MAX_FEATURE_KEY_LENGTH,
	MAX_MOD_ACTION_FIELD_LENGTH,
	MAX_PLAYER_ID_LENGTH,
	MAX_SPECTATOR_ACTION_DATA_LENGTH,
	MAX_SPECTATOR_SNAPSHOT_LENGTH,
} from './limits.js'
import {
	type IncomingProtocolV2RouteEntry,
	type ProtocolPayloadValidator,
	clientIncomingRoute,
	hasFiniteNumber,
	hasNonEmptyStringWithinLength,
	hasOptionalStringWithinLength,
	isRecordPayload,
	validatedIncomingRoute,
} from './shared.js'

const hasOptionalFeatureTarget = (payload: Record<string, unknown>) =>
	payload.target === undefined ||
	payload.target === 'nemesis' ||
	payload.target === 'all'

const validatePhantomPayload: ProtocolPayloadValidator<
	ActionHandlerArgs<ActionSendPhantomRequest | ActionRemovePhantomRequest>
> = (
	payload: unknown,
): payload is ActionHandlerArgs<
	ActionSendPhantomRequest | ActionRemovePhantomRequest
> =>
	isRecordPayload(payload) &&
	hasNonEmptyStringWithinLength(payload, 'key', MAX_FEATURE_KEY_LENGTH) &&
	hasOptionalStringWithinLength(payload, 'playerId', MAX_PLAYER_ID_LENGTH)

const validateEatPizzaPayload: ProtocolPayloadValidator<
	ActionHandlerArgs<ActionEatPizzaRequest>
> = (payload: unknown): payload is ActionHandlerArgs<ActionEatPizzaRequest> =>
	isRecordPayload(payload) && hasFiniteNumber(payload, 'whole')

const validateSpentLastShopPayload: ProtocolPayloadValidator<
	ActionHandlerArgs<ActionSpentLastShopRequest>
> = (
	payload: unknown,
): payload is ActionHandlerArgs<ActionSpentLastShopRequest> =>
	isRecordPayload(payload) && hasFiniteNumber(payload, 'amount')

const validateMagnetResponsePayload: ProtocolPayloadValidator<
	ActionHandlerArgs<ActionMagnetResponseRequest>
> = (
	payload: unknown,
): payload is ActionHandlerArgs<ActionMagnetResponseRequest> =>
	isRecordPayload(payload) &&
	hasNonEmptyStringWithinLength(payload, 'key', MAX_ENCODED_CARD_PAYLOAD_LENGTH)

const validateModdedPayload: ProtocolPayloadValidator<
	ActionHandlerArgs<ActionModdedRequest>
> = (payload: unknown): payload is ActionHandlerArgs<ActionModdedRequest> =>
	isRecordPayload(payload) &&
	hasNonEmptyStringWithinLength(payload, 'modId', MAX_MOD_ACTION_FIELD_LENGTH) &&
	hasNonEmptyStringWithinLength(payload, 'modAction', MAX_MOD_ACTION_FIELD_LENGTH) &&
	hasOptionalFeatureTarget(payload)

const validateSpectatorActionStreamPayload: ProtocolPayloadValidator<
	ActionHandlerArgs<ActionSpectatorActionStreamRequest>
> = (
	payload: unknown,
): payload is ActionHandlerArgs<ActionSpectatorActionStreamRequest> =>
	isRecordPayload(payload) &&
	hasNonEmptyStringWithinLength(payload, 'actionData', MAX_SPECTATOR_ACTION_DATA_LENGTH) &&
	hasFiniteNumber(payload, 'stepIndex')

const validateSpectatorWatchTargetPayload: ProtocolPayloadValidator<
	ActionHandlerArgs<ActionSpectatorWatchTargetRequest>
> = (
	payload: unknown,
): payload is ActionHandlerArgs<ActionSpectatorWatchTargetRequest> =>
	isRecordPayload(payload) &&
	hasNonEmptyStringWithinLength(payload, 'targetPlayerId', MAX_PLAYER_ID_LENGTH)

const validateSpectatorProvideSnapshotPayload: ProtocolPayloadValidator<
	ActionHandlerArgs<ActionSpectatorProvideSnapshotRequest>
> = (
	payload: unknown,
): payload is ActionHandlerArgs<ActionSpectatorProvideSnapshotRequest> =>
	isRecordPayload(payload) &&
	hasNonEmptyStringWithinLength(
		payload,
		'spectatorPlayerId',
		MAX_PLAYER_ID_LENGTH,
	) &&
	hasNonEmptyStringWithinLength(
		payload,
		'targetPlayerId',
		MAX_PLAYER_ID_LENGTH,
	) &&
	hasNonEmptyStringWithinLength(
		payload,
		'snapshotData',
		MAX_SPECTATOR_SNAPSHOT_LENGTH,
	)

const validateSpectatorRequestSnapshotPayload: ProtocolPayloadValidator<
	ActionHandlerArgs<ActionSpectatorRequestSnapshotRequest>
> = (
	payload: unknown,
): payload is ActionHandlerArgs<ActionSpectatorRequestSnapshotRequest> =>
	isRecordPayload(payload) &&
	hasNonEmptyStringWithinLength(payload, 'targetPlayerId', MAX_PLAYER_ID_LENGTH)

const validateSpectatorSetRolePayload: ProtocolPayloadValidator<
	ActionHandlerArgs<ActionSpectatorSetRoleRequest>
> = (
	payload: unknown,
): payload is ActionHandlerArgs<ActionSpectatorSetRoleRequest> =>
	isRecordPayload(payload) &&
	(payload.role === 'player' || payload.role === 'spectator')

export const FEATURE_INCOMING_PROTOCOL_ROUTE_ENTRIES: readonly IncomingProtocolV2RouteEntry[] =
	[
		validatedIncomingRoute<ActionHandlerArgs<ActionSendPhantomRequest>>(
			'feature',
			'sendPhantom',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			'feature.sendPhantom',
			validatePhantomPayload,
			() => sendPhantomAction,
		),
		validatedIncomingRoute<ActionHandlerArgs<ActionRemovePhantomRequest>>(
			'feature',
			'removePhantom',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			'feature.removePhantom',
			validatePhantomPayload,
			() => removePhantomAction,
		),
		clientIncomingRoute(
			'feature',
			'asteroid',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			() => asteroidAction,
		),
		clientIncomingRoute(
			'feature',
			'letsGoGamblingNemesis',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			() => letsGoGamblingNemesisAction,
		),
		validatedIncomingRoute<ActionHandlerArgs<ActionEatPizzaRequest>>(
			'feature',
			'eatPizza',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			'feature.eatPizza',
			validateEatPizzaPayload,
			() => eatPizzaAction,
		),
		clientIncomingRoute(
			'feature',
			'soldJoker',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			() => soldJokerAction,
		),
		validatedIncomingRoute<ActionHandlerArgs<ActionSpentLastShopRequest>>(
			'feature',
			'spentLastShop',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			'feature.spentLastShop',
			validateSpentLastShopPayload,
			() => spentLastShopAction,
		),
		clientIncomingRoute(
			'feature',
			'magnet',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			() => magnetAction,
		),
		validatedIncomingRoute<ActionHandlerArgs<ActionMagnetResponseRequest>>(
			'feature',
			'magnetResponse',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			'feature.magnetResponse',
			validateMagnetResponsePayload,
			() => magnetResponseAction,
		),
		validatedIncomingRoute<ActionHandlerArgs<ActionModdedRequest>>(
			'feature',
			'moddedAction',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			'feature.moddedAction',
			validateModdedPayload,
			() => moddedAction,
		),
		validatedIncomingRoute<ActionHandlerArgs<ActionSpectatorActionStreamRequest>>(
			'feature',
			'spectatorActionStream',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			'feature.spectatorActionStream',
			validateSpectatorActionStreamPayload,
			() => spectatorActionStreamAction,
		),
		validatedIncomingRoute<ActionHandlerArgs<ActionSpectatorWatchTargetRequest>>(
			'feature',
			'spectatorWatchTarget',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			'feature.spectatorWatchTarget',
			validateSpectatorWatchTargetPayload,
			() => spectatorWatchTargetAction,
		),
		validatedIncomingRoute<ActionHandlerArgs<ActionSpectatorProvideSnapshotRequest>>(
			'feature',
			'spectatorProvideSnapshot',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			'feature.spectatorProvideSnapshot',
			validateSpectatorProvideSnapshotPayload,
			() => spectatorProvideSnapshotAction,
		),
		validatedIncomingRoute<ActionHandlerArgs<ActionSpectatorRequestSnapshotRequest>>(
			'feature',
			'spectatorRequestSnapshot',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			'feature.spectatorRequestSnapshot',
			validateSpectatorRequestSnapshotPayload,
			() => spectatorRequestSnapshotAction,
		),
		validatedIncomingRoute<ActionHandlerArgs<ActionSpectatorSetRoleRequest>>(
			'feature',
			'spectatorSetRole',
			PROTOCOL_V2_SCHEMA_IDS.featureEvent,
			'feature.spectatorSetRole',
			validateSpectatorSetRolePayload,
			() => spectatorSetRoleAction,
		),
	]
