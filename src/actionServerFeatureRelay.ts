export type ActionSendPhantom = {
	action: 'sendPhantom'
	key: string
	playerId?: string
}
export type ActionRemovePhantom = {
	action: 'removePhantom'
	key: string
	playerId?: string
}
export type ActionAsteroid = { action: 'asteroid'; playerId?: string }
export type ActionLetsGoGamblingNemesis = {
	action: 'letsGoGamblingNemesis'
	playerId?: string
}
export type ActionEatPizza = {
	action: 'eatPizza'
	whole: number
	playerId?: string
}
export type ActionSoldJoker = { action: 'soldJoker'; playerId?: string }
export type ActionSpentLastShop = {
	action: 'spentLastShop'
	amount: number
	playerId?: string
}
export type ActionMagnet = { action: 'magnet' }
export type ActionMagnetResponse = { action: 'magnetResponse'; key: string }
export type ActionModded = {
	action: 'moddedAction'
	modId: string
	modAction: string
	fromPlayerId: string
	target?: 'nemesis' | 'all'
	[key: string]: unknown
}
export type ActionTeamCardSync = {
	action: 'teamCardSync'
	playerId: string
	username: string
	cardKey: string
	actionType: 'sync' | 'removed'
	cardData?: string
}
export type ActionTeamHandLevelSync = {
	action: 'teamHandLevelSync'
	playerId: string
	username: string
	hand: string
	level: string
}

export type ActionSpectatorActionStream = {
	action: 'spectatorActionStream'
	playerId: string
	actionData: string
	stepIndex: number
}
export type ActionSpectatorHistory = {
	action: 'spectatorHistory'
	targetPlayerId: string
	seed?: string
	stake?: number
	back?: string
	challenge?: string
	sleeve?: string
	cocktail?: string
}
export type ActionSpectatorRequestSnapshot = {
	action: 'spectatorRequestSnapshot'
	spectatorPlayerId: string
}
export type ActionSpectatorReceiveSnapshot = {
	action: 'spectatorReceiveSnapshot'
	targetPlayerId: string
	snapshotData: string
}

export type ActionServerFeatureRelay =
	| ActionSendPhantom
	| ActionRemovePhantom
	| ActionAsteroid
	| ActionLetsGoGamblingNemesis
	| ActionEatPizza
	| ActionSoldJoker
	| ActionSpentLastShop
	| ActionMagnet
	| ActionMagnetResponse
	| ActionModded
	| ActionTeamCardSync
	| ActionTeamHandLevelSync
	| ActionSpectatorActionStream
	| ActionSpectatorHistory
	| ActionSpectatorRequestSnapshot
	| ActionSpectatorReceiveSnapshot
