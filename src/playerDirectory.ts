import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type Client from './Client.js'

const MAX_NAMES_PER_IP = 80
const BAN_STORE_PATH =
	process.env.MP_IP_BANS_FILE?.trim() || resolve(process.cwd(), 'data', 'ip_bans.json')
const PLAYER_DIRECTORY_STORE_PATH =
	process.env.MP_PLAYER_DIRECTORY_FILE?.trim() ||
	resolve(process.cwd(), 'data', 'player_directory.json')
const IS_TEST_RUN =
	process.env.NODE_ENV === 'test' ||
	process.env.NODE_TEST_CONTEXT !== undefined ||
	process.env.npm_lifecycle_event === 'test' ||
	process.argv.includes('--test')
const SHOULD_PERSIST =
	process.env.MP_PLAYER_DIRECTORY_DISABLE_PERSISTENCE !== '1' &&
	!IS_TEST_RUN

export type PlayerDirectoryEntry = {
	ip: string
	names: string[]
	firstSeenAt: string
	lastSeenAt: string
	connectionCount: number
	activeConnections: number
	lastClientId: string | null
	lastLobbyCode: string | null
	banned: boolean
	bannedAt: string | null
}

type ActiveConnection = {
	client: Client
	disconnect: () => void
}

type IpBanRecord = {
	ip: string
	bannedAt: string
}

type PersistedBanStore = {
	version: 1
	bans: IpBanRecord[]
}

type PersistedPlayerRecord = {
	ip: string
	names?: string[]
	firstSeenAt?: string
	lastSeenAt?: string
	connectionCount?: number
	lastClientId?: string | null
	lastLobbyCode?: string | null
}

type PersistedPlayerDirectoryStore = {
	version: 1
	players: PersistedPlayerRecord[]
}

const nowIso = () => new Date().toISOString()

export const normalizeIpAddress = (value: unknown) => {
	const ip = typeof value === 'string' ? value.trim() : ''
	if (!ip) return 'unknown'
	if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length)
	return ip
}

const entriesByIp = new Map<string, PlayerDirectoryEntry>()
const activeConnections = new Map<string, ActiveConnection>()
const bannedIps = new Map<string, IpBanRecord>()

const loadBans = () => {
	if (!existsSync(BAN_STORE_PATH)) return

	try {
		const parsed = JSON.parse(readFileSync(BAN_STORE_PATH, 'utf8')) as Partial<PersistedBanStore>
		for (const record of parsed.bans ?? []) {
			const ip = normalizeIpAddress(record.ip)
			if (ip === 'unknown') continue
			bannedIps.set(ip, {
				ip,
				bannedAt: typeof record.bannedAt === 'string' ? record.bannedAt : nowIso(),
			})
		}
	} catch (error) {
		console.warn(`Failed to load IP ban store ${BAN_STORE_PATH}:`, error)
	}
}

const saveBans = () => {
	if (!SHOULD_PERSIST) return

	try {
		mkdirSync(dirname(BAN_STORE_PATH), { recursive: true })
		const body: PersistedBanStore = {
			version: 1,
			bans: Array.from(bannedIps.values()).sort((left, right) =>
				left.ip.localeCompare(right.ip),
			),
		}
		writeFileSync(BAN_STORE_PATH, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
	} catch (error) {
		console.warn(`Failed to save IP ban store ${BAN_STORE_PATH}:`, error)
	}
}

const getOrCreateEntry = (ip: string) => {
	const normalizedIp = normalizeIpAddress(ip)
	let entry = entriesByIp.get(normalizedIp)
	if (!entry) {
		const at = nowIso()
		entry = {
			ip: normalizedIp,
			names: [],
			firstSeenAt: at,
			lastSeenAt: at,
			connectionCount: 0,
			activeConnections: 0,
			lastClientId: null,
			lastLobbyCode: null,
			banned: bannedIps.has(normalizedIp),
			bannedAt: bannedIps.get(normalizedIp)?.bannedAt ?? null,
		}
		entriesByIp.set(normalizedIp, entry)
	}
	return entry
}

const addNameToEntry = (entry: PlayerDirectoryEntry, name: string) => {
	const cleanName = name.trim()
	if (!cleanName || entry.names.includes(cleanName)) return false
	entry.names.push(cleanName)
	if (entry.names.length > MAX_NAMES_PER_IP) {
		entry.names.splice(0, entry.names.length - MAX_NAMES_PER_IP)
	}
	return true
}

const syncEntryBanState = (entry: PlayerDirectoryEntry) => {
	const ban = bannedIps.get(entry.ip)
	entry.banned = !!ban
	entry.bannedAt = ban?.bannedAt ?? null
}

const loadPlayerDirectory = () => {
	if (!existsSync(PLAYER_DIRECTORY_STORE_PATH)) return

	try {
		const parsed = JSON.parse(
			readFileSync(PLAYER_DIRECTORY_STORE_PATH, 'utf8'),
		) as Partial<PersistedPlayerDirectoryStore>
		for (const record of parsed.players ?? []) {
			const ip = normalizeIpAddress(record.ip)
			if (ip === 'unknown') continue
			const at = nowIso()
			const entry: PlayerDirectoryEntry = {
				ip,
				names: [],
				firstSeenAt:
					typeof record.firstSeenAt === 'string' ? record.firstSeenAt : at,
				lastSeenAt: typeof record.lastSeenAt === 'string' ? record.lastSeenAt : at,
				connectionCount:
					typeof record.connectionCount === 'number' &&
					Number.isFinite(record.connectionCount)
						? Math.max(0, Math.floor(record.connectionCount))
						: 0,
				activeConnections: 0,
				lastClientId:
					typeof record.lastClientId === 'string' ? record.lastClientId : null,
				lastLobbyCode:
					typeof record.lastLobbyCode === 'string' ? record.lastLobbyCode : null,
				banned: false,
				bannedAt: null,
			}
			for (const name of record.names ?? []) {
				if (typeof name === 'string') addNameToEntry(entry, name)
			}
			syncEntryBanState(entry)
			entriesByIp.set(ip, entry)
		}
	} catch (error) {
		console.warn(
			`Failed to load player directory store ${PLAYER_DIRECTORY_STORE_PATH}:`,
			error,
		)
	}
}

const savePlayerDirectory = () => {
	if (!SHOULD_PERSIST) return

	try {
		mkdirSync(dirname(PLAYER_DIRECTORY_STORE_PATH), { recursive: true })
		const body: PersistedPlayerDirectoryStore = {
			version: 1,
			players: Array.from(entriesByIp.values())
				.map((entry) => ({
					ip: entry.ip,
					names: [...entry.names],
					firstSeenAt: entry.firstSeenAt,
					lastSeenAt: entry.lastSeenAt,
					connectionCount: entry.connectionCount,
					lastClientId: entry.lastClientId,
					lastLobbyCode: entry.lastLobbyCode,
				}))
				.sort((left, right) => left.ip.localeCompare(right.ip)),
		}
		writeFileSync(
			PLAYER_DIRECTORY_STORE_PATH,
			`${JSON.stringify(body, null, 2)}\n`,
			'utf8',
		)
	} catch (error) {
		console.warn(
			`Failed to save player directory store ${PLAYER_DIRECTORY_STORE_PATH}:`,
			error,
		)
	}
}

loadBans()
loadPlayerDirectory()

export const isIpBanned = (ip: unknown) => bannedIps.has(normalizeIpAddress(ip))

export const recordPlayerConnection = (
	client: Client,
	options: { disconnect: () => void },
) => {
	const ip = normalizeIpAddress(client.remoteAddress)
	client.remoteAddress = ip
	const entry = getOrCreateEntry(ip)
	entry.connectionCount += 1
	entry.activeConnections += 1
	entry.lastSeenAt = nowIso()
	entry.lastClientId = client.id
	entry.lastLobbyCode = client.lobby?.code ?? null
	addNameToEntry(entry, client.username)
	syncEntryBanState(entry)
	activeConnections.set(client.id, { client, disconnect: options.disconnect })
	savePlayerDirectory()
}

export const recordPlayerDisconnected = (client: Client) => {
	const active = activeConnections.get(client.id)
	if (!active) return

	activeConnections.delete(client.id)
	const entry = getOrCreateEntry(client.remoteAddress)
	entry.activeConnections = Math.max(0, entry.activeConnections - 1)
	entry.lastSeenAt = nowIso()
	entry.lastClientId = client.id
	entry.lastLobbyCode = client.lobby?.code ?? entry.lastLobbyCode
	syncEntryBanState(entry)
	savePlayerDirectory()
}

export const recordPlayerName = (client: Client, username: string) => {
	const entry = getOrCreateEntry(client.remoteAddress)
	entry.lastSeenAt = nowIso()
	entry.lastClientId = client.id
	entry.lastLobbyCode = client.lobby?.code ?? null
	addNameToEntry(entry, username)
	syncEntryBanState(entry)
	savePlayerDirectory()
}

export const banIp = (ip: unknown) => {
	const normalizedIp = normalizeIpAddress(ip)
	if (normalizedIp === 'unknown') {
		throw new Error('Cannot ban unknown IP')
	}
	const existing = bannedIps.get(normalizedIp)
	const record = existing ?? { ip: normalizedIp, bannedAt: nowIso() }
	bannedIps.set(normalizedIp, record)
	syncEntryBanState(getOrCreateEntry(normalizedIp))
	saveBans()
	savePlayerDirectory()
	return record
}

export const unbanIp = (ip: unknown) => {
	const normalizedIp = normalizeIpAddress(ip)
	const removed = bannedIps.delete(normalizedIp)
	syncEntryBanState(getOrCreateEntry(normalizedIp))
	saveBans()
	savePlayerDirectory()
	return removed
}

export const disconnectActiveClientsByIp = (ip: unknown) => {
	const normalizedIp = normalizeIpAddress(ip)
	let disconnected = 0
	const matchingConnections = Array.from(activeConnections.values()).filter(
		(active) => normalizeIpAddress(active.client.remoteAddress) === normalizedIp,
	)
	for (const active of matchingConnections) {
		active.disconnect()
		disconnected += 1
	}
	return disconnected
}

export const getPlayerDirectorySnapshot = () => {
	for (const entry of entriesByIp.values()) {
		syncEntryBanState(entry)
		entry.activeConnections = 0
	}

	for (const active of activeConnections.values()) {
		const entry = getOrCreateEntry(active.client.remoteAddress)
		entry.activeConnections += 1
		entry.lastClientId = active.client.id
		entry.lastLobbyCode = active.client.lobby?.code ?? null
		entry.lastSeenAt = nowIso()
		addNameToEntry(entry, active.client.username)
		syncEntryBanState(entry)
	}

	for (const ban of bannedIps.values()) {
		syncEntryBanState(getOrCreateEntry(ban.ip))
	}

	return Array.from(entriesByIp.values()).sort((left, right) => {
		if (left.banned !== right.banned) return left.banned ? -1 : 1
		if (left.activeConnections !== right.activeConnections) {
			return right.activeConnections - left.activeConnections
		}
		return right.lastSeenAt.localeCompare(left.lastSeenAt)
	})
}

export const resetPlayerDirectoryForTests = () => {
	entriesByIp.clear()
	activeConnections.clear()
	bannedIps.clear()
}
