import { createHash, randomUUID } from 'node:crypto'
import {
	appendFileSync,
	mkdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

export const MATCH_REPLAY_FORMAT_VERSION = 2

type JsonObject = Record<string, unknown>

type MatchStartConfig = {
	seed?: string
	stake: number
	back: string
	challenge: string
	sleeve: string
	cocktail: string
}

export type MatchReplayParticipant = {
	id: string
	username: string
	team: number | null
	lives: number
}

export type MatchReplayStart = {
	lobbyCode: string
	gameMode: string
	lobbyType: string
	options: JsonObject
	matchConfig: MatchStartConfig | null
	participants: MatchReplayParticipant[]
	resumedFrom?: string
}

export type MatchReplayEventInput = {
	actorId?: string
	actorStep?: number
	scope: 'player' | 'team' | 'match'
	scopeId?: number
	type: string
	data: JsonObject
}

type MatchReplayEvent = MatchReplayEventInput & { sequence: number }

type MatchCheckpoint = {
	actorId: string
	actorStep: number
	sequence: number
	position: 'initial' | 'before_action'
	path: string
}

type MatchReplayManifest = {
	formatVersion: number
	id: string
	lobbyCode: string
	status: 'recording' | 'completed' | 'abandoned' | 'interrupted' | 'error'
	createdAt: string
	updatedAt: string
	completedAt?: string
	rules: {
		gameMode: string
		lobbyType: string
		options: JsonObject
		matchConfig: MatchStartConfig | null
		resumedFrom?: string
	}
	participants: MatchReplayParticipant[]
	eventCount: number
	checkpoints: MatchCheckpoint[]
	gaps: Array<{ actorId: string; expectedStep: number; receivedStep: number }>
	result?: unknown
	error?: string
}

type ActiveRecording = {
	directory: string
	eventsPath: string
	manifest: MatchReplayManifest
	participantIds: Set<string>
	lastSteps: Map<string, number>
	failed: boolean
}

const ACTIONS_WITH_CANONICAL_SERVER_EVENTS = new Set([
	'ENEMY_LOCATION',
	'TEAM_CARD_SYNC',
])
const MANIFEST_WRITE_INTERVAL = 50

let defaultRootDirectory: string | null = null

export const configureMatchReplayRecording = (rootDirectory?: string) => {
	defaultRootDirectory = resolve(
		rootDirectory ?? process.env.MP_REPLAY_DATA_DIR ?? 'data/match-replays',
	)
}

const participantDirectory = (playerId: string) =>
	createHash('sha256').update(playerId).digest('hex').slice(0, 20)

const writeFileAtomic = (path: string, contents: string) => {
	const temporaryPath = `${path}.tmp`
	writeFileSync(temporaryPath, contents, 'utf8')
	renameSync(temporaryPath, path)
}

export class MatchReplayRecorder {
	private active: ActiveRecording | null = null

	constructor(private readonly rootDirectory: string | null = defaultRootDirectory) {}

	start = (input: MatchReplayStart): string | null => {
		this.finish('interrupted')
		if (!this.rootDirectory) return null

		try {
			const lobbyDirectory = join(
				this.rootDirectory,
				participantDirectory(input.lobbyCode),
			)
			// Server recordings are temporary. A new match replaces this lobby's last one.
			rmSync(lobbyDirectory, { recursive: true, force: true })
			const id = randomUUID()
			const directory = join(lobbyDirectory, id)
			mkdirSync(join(directory, 'players'), { recursive: true })
			const eventsPath = join(directory, 'events.jsonl')
			writeFileSync(eventsPath, '', 'utf8')
			const now = new Date().toISOString()
			this.active = {
				directory,
				eventsPath,
				participantIds: new Set(input.participants.map((player) => player.id)),
				lastSteps: new Map(),
				failed: false,
				manifest: {
					formatVersion: MATCH_REPLAY_FORMAT_VERSION,
					id,
					lobbyCode: input.lobbyCode,
					status: 'recording',
					createdAt: now,
					updatedAt: now,
					rules: {
						gameMode: input.gameMode,
						lobbyType: input.lobbyType,
						options: input.options,
						matchConfig: input.matchConfig,
						resumedFrom: input.resumedFrom,
					},
					participants: input.participants,
					eventCount: 0,
					checkpoints: [],
					gaps: [],
				},
			}
			this.persistManifest()
			return id
		} catch (error) {
			this.fail(error)
			return null
		}
	}

	private persistManifest = () => {
		if (!this.active) return
		this.active.manifest.updatedAt = new Date().toISOString()
		writeFileAtomic(
			join(this.active.directory, 'match.json'),
			`${JSON.stringify(this.active.manifest, null, 2)}\n`,
		)
	}

	private fail = (error: unknown) => {
		console.warn(`Match replay recording failed: ${String(error)}`)
		if (!this.active) return
		this.active.failed = true
		this.active.manifest.status = 'error'
		this.active.manifest.error = String(error)
		try {
			this.persistManifest()
		} catch {
			// Gameplay must continue even when replay storage is unavailable.
		}
	}

	private appendEvent = (event: MatchReplayEventInput): number | null => {
		if (!this.active || this.active.failed) return null
		try {
			const sequence = this.active.manifest.eventCount + 1
			const entry: MatchReplayEvent = { sequence, ...event }
			appendFileSync(this.active.eventsPath, `${JSON.stringify(entry)}\n`, 'utf8')
			this.active.manifest.eventCount = sequence
			if (sequence % MANIFEST_WRITE_INTERVAL === 0) this.persistManifest()
			return sequence
		} catch (error) {
			this.fail(error)
			return null
		}
	}

	recordEvent = (event: MatchReplayEventInput): number | null =>
		this.appendEvent(event)

	appendPlayerAction = (
		playerId: string,
		action: { actionData: string; stepIndex: number },
	): boolean => {
		if (!this.active || this.active.failed || !this.active.participantIds.has(playerId)) {
			return false
		}
		try {
			const parsed = JSON.parse(action.actionData) as {
				step?: unknown
				type?: unknown
				data?: unknown
			}
			if (
				!Number.isSafeInteger(action.stepIndex) ||
				action.stepIndex < 1 ||
				parsed.step !== action.stepIndex ||
				typeof parsed.type !== 'string' ||
				parsed.type.length === 0 ||
				typeof parsed.data !== 'object' ||
				parsed.data === null ||
				Array.isArray(parsed.data)
			) {
				return false
			}

			const previousStep = this.active.lastSteps.get(playerId) ?? 0
			if (action.stepIndex <= previousStep) return true
			if (action.stepIndex > previousStep + 1) {
				const gap = {
					actorId: playerId,
					expectedStep: previousStep + 1,
					receivedStep: action.stepIndex,
				}
				this.active.manifest.gaps.push(gap)
				this.appendEvent({
					actorId: playerId,
					scope: 'player',
					type: 'RECORDING_GAP',
					data: { expectedStep: gap.expectedStep, receivedStep: gap.receivedStep },
				})
			}
			this.active.lastSteps.set(playerId, action.stepIndex)

			// These are recipient-side copies. Their server handlers record one canonical event.
			if (ACTIONS_WITH_CANONICAL_SERVER_EVENTS.has(parsed.type)) return true
			return this.appendEvent({
				actorId: playerId,
				actorStep: action.stepIndex,
				scope: 'player',
				type: parsed.type,
				data: parsed.data as JsonObject,
			}) !== null
		} catch {
			return false
		}
	}

	captureCheckpoint = (
		playerId: string,
		input: {
			stepIndex: number
			position: 'initial' | 'before_action'
			snapshotData: string
		},
	): boolean => {
		if (!this.active || this.active.failed || !this.active.participantIds.has(playerId)) {
			return false
		}
		let snapshot: { step?: unknown }
		try {
			const parsed = JSON.parse(input.snapshotData) as unknown
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
				return false
			}
			snapshot = parsed as { step?: unknown }
		} catch {
			return false
		}
		try {
			if (
				!Number.isSafeInteger(input.stepIndex) ||
				(input.position === 'initial' ? input.stepIndex !== 0 : input.stepIndex < 1)
			) {
				return false
			}
			if (snapshot.step !== input.stepIndex) return false
			if (
				this.active.manifest.checkpoints.some(
					(checkpoint) =>
						checkpoint.actorId === playerId &&
						checkpoint.actorStep === input.stepIndex &&
						checkpoint.position === input.position,
				)
			) {
				return true
			}

			const filename = input.position === 'initial'
				? 'initial.json'
				: `checkpoint_${input.stepIndex}.json`
			const relativePath = `players/${participantDirectory(playerId)}/${filename}`
			const absolutePath = join(this.active.directory, ...relativePath.split('/'))
			mkdirSync(join(absolutePath, '..'), { recursive: true })
			writeFileAtomic(absolutePath, `${input.snapshotData}\n`)
			this.active.manifest.checkpoints.push({
				actorId: playerId,
				actorStep: input.stepIndex,
				sequence: this.active.manifest.eventCount,
				position: input.position,
				path: relativePath,
			})
			this.persistManifest()
			return true
		} catch (error) {
			this.fail(error)
			return false
		}
	}

	finish = (
		status: 'completed' | 'abandoned' | 'interrupted',
		result?: unknown,
	): boolean => {
		if (!this.active) return false
		const recording = this.active
		try {
			recording.manifest.status = recording.failed ? 'error' : status
			recording.manifest.completedAt = new Date().toISOString()
			recording.manifest.result = result
			this.persistManifest()
			this.active = null
			return !recording.failed
		} catch (error) {
			this.fail(error)
			return false
		}
	}
}
