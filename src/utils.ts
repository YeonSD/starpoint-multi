import { randomInt } from "crypto"
import { FastifyRequest } from "fastify"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"

export type ServerTimeMode = "fixed" | "live";

export interface ServerTimeSettings {
    mode: ServerTimeMode
    fixedTime?: string
    liveDate?: string
    updatedAt: string
}

const defaultFixedServerTime = "2021-07-24T15:00:00.000Z";
const databaseDir = path.join(process.cwd(), ".database");
const serverTimePath = path.join(databaseDir, "server-time.json");
let serverTimeSettings: ServerTimeSettings = readPersistedServerTimeSettings();

/**
 * Returns the current server time as a unix epoch.
 * 
 * @param date An optional date; The date to get the time of.
 * @returns The unix epoch.
 */
export function getServerTime(
    date: Date = new Date()
): number {
    return Math.floor(getServerDate(date).getTime() / 1000) //1710116388//
}

/**
 * Gets the current server time as a Date.
 * 
 * @returns The current server time as a date.
 */
export function getServerDate(date: Date = new Date()): Date {
    if (serverTimeSettings.mode === "fixed" && serverTimeSettings.fixedTime !== undefined) {
        return readValidDate(serverTimeSettings.fixedTime) ?? new Date(date);
    }

    if (serverTimeSettings.mode === "live" && serverTimeSettings.liveDate !== undefined) {
        return combineServerDateWithCurrentTime(serverTimeSettings.liveDate, date);
    }

    return new Date(date)
}

export function getServerTimeZone(): string {
    return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function formatServerDateForTimeZone(date: Date = getServerDate()): string {
    const parts = getDateTimePartsForTimeZone(date, getServerTimeZone());
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatServerDateInputForTimeZone(date: Date, timeZone: string = getServerTimeZone()): string {
    const parts = getDateTimePartsForTimeZone(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function getDateTimePartsForTimeZone(date: Date, timeZone: string): Record<string, string> {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
        result[part.type] = part.value;
        return result;
    }, {});
}

export function setServerTime(date: Date | null) {
    if (date !== null && Number.isNaN(date.getTime())) {
        throw new Error("Invalid server time.");
    }

    if (date === null) {
        setServerTimeSettings({ mode: "fixed", fixedTime: defaultFixedServerTime });
        return;
    }

    setServerTimeSettings({
        mode: "fixed",
        fixedTime: date
    });
}

export function getServerTimeSettings(): ServerTimeSettings {
    return { ...serverTimeSettings };
}

export function setServerTimeSettings(input: {
    mode: ServerTimeMode,
    fixedTime?: string | Date,
    liveDate?: string
}) {
    const now = new Date();
    let settings: ServerTimeSettings;

    if (input.mode === "fixed") {
        const fixedTime = normalizeRequiredDate(input.fixedTime, "Invalid fixed server time.");
        settings = {
            mode: "fixed",
            fixedTime: fixedTime.toISOString(),
            updatedAt: now.toISOString()
        };
    } else {
        if (input.liveDate === undefined || !/^\d{4}-\d\d-\d\d$/.test(input.liveDate)) {
            throw new Error("Invalid live server date.");
        }
        settings = {
            mode: "live",
            liveDate: input.liveDate,
            updatedAt: now.toISOString()
        };
    }

    serverTimeSettings = settings;
    persistServerTimeSettings(settings);
}

function readPersistedServerTimeSettings(): ServerTimeSettings {
    if (!existsSync(serverTimePath)) return defaultServerTimeSettings();

    try {
        const raw = JSON.parse(readFileSync(serverTimePath, "utf-8")) as unknown;
        const migrated = migrateServerTimeSettings(raw);
        if (migrated !== null) return migrated;

        const value = typeof raw === "object" && raw !== null && "serverTime" in raw
            ? (raw as { serverTime?: unknown }).serverTime
            : raw;
        if (typeof value !== "string") return defaultServerTimeSettings();

        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? defaultServerTimeSettings()
            : {
                mode: "fixed",
                fixedTime: date.toISOString(),
                updatedAt: new Date().toISOString()
            };
    } catch {
        return defaultServerTimeSettings();
    }
}

function persistServerTimeSettings(settings: ServerTimeSettings) {
    if (!existsSync(databaseDir)) mkdirSync(databaseDir, { recursive: true });
    writeFileSync(serverTimePath, JSON.stringify(settings, null, 2), "utf-8");
}

function defaultServerTimeSettings(): ServerTimeSettings {
    return {
        mode: "fixed",
        fixedTime: defaultFixedServerTime,
        updatedAt: new Date().toISOString()
    };
}

function normalizeRequiredDate(value: string | Date | undefined, errorMessage: string): Date {
    const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
    if (date === null || Number.isNaN(date.getTime())) {
        throw new Error(errorMessage);
    }

    return date;
}

function readValidDate(value: string): Date | null {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function migrateServerTimeSettings(value: unknown): ServerTimeSettings | null {
    if (typeof value !== "object" || value === null) return null;
    const settings = value as Omit<Partial<ServerTimeSettings>, "mode"> & {
        mode?: string,
        baseServerTime?: string,
        overrideDate?: string
    };

    if (settings.mode === "fixed" && typeof settings.fixedTime === "string" && typeof settings.updatedAt === "string") {
        return {
            mode: "fixed",
            fixedTime: settings.fixedTime,
            updatedAt: settings.updatedAt
        };
    }

    if (settings.mode === "live" && typeof settings.liveDate === "string" && typeof settings.updatedAt === "string") {
        return {
            mode: "live",
            liveDate: settings.liveDate,
            updatedAt: settings.updatedAt
        };
    }

    if (settings.mode === "date_override" && typeof settings.overrideDate === "string") {
        return {
            mode: "live",
            liveDate: settings.overrideDate,
            updatedAt: typeof settings.updatedAt === "string" ? settings.updatedAt : new Date().toISOString()
        };
    }

    if (settings.mode === "ticking" && typeof settings.baseServerTime === "string") {
        const baseServerTime = readValidDate(settings.baseServerTime);
        if (baseServerTime !== null) {
            return {
                mode: "live",
                liveDate: baseServerTime.toISOString().slice(0, 10),
                updatedAt: typeof settings.updatedAt === "string" ? settings.updatedAt : new Date().toISOString()
            };
        }
    }

    return null;
}

function combineServerDateWithCurrentTime(liveDate: string, date: Date): Date {
    const dateParts = /^(\d{4})-(\d\d)-(\d\d)$/.exec(liveDate);
    if (dateParts === null) return new Date(date);

    const timeParts = getTimePartsForTimeZone(date);
    const offsetMinutes = getTimeZoneOffsetMinutes(liveDate, timeParts, getServerTimeZone());
    return new Date(Date.UTC(
        Number(dateParts[1]),
        Number(dateParts[2]) - 1,
        Number(dateParts[3]),
        timeParts.hour,
        timeParts.minute,
        timeParts.second,
        timeParts.millisecond
    ) - offsetMinutes * 60_000);
}

function getTimePartsForTimeZone(date: Date): {
    hour: number,
    minute: number,
    second: number,
    millisecond: number
} {
    const timeZone = getServerTimeZone();
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
        result[part.type] = part.value;
        return result;
    }, {});

    return {
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
        millisecond: date.getMilliseconds()
    };
}

function getTimeZoneOffsetMinutes(
    localDate: string,
    localTime: { hour: number, minute: number, second: number, millisecond: number },
    timeZone: string
): number {
    const dateParts = /^(\d{4})-(\d\d)-(\d\d)$/.exec(localDate);
    if (dateParts === null) return 0;

    const utcGuess = new Date(Date.UTC(
        Number(dateParts[1]),
        Number(dateParts[2]) - 1,
        Number(dateParts[3]),
        localTime.hour,
        localTime.minute,
        localTime.second,
        localTime.millisecond
    ));
    const zonedParts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(utcGuess).reduce<Record<string, string>>((result, part) => {
        result[part.type] = part.value;
        return result;
    }, {});

    const zonedAsUtc = Date.UTC(
        Number(zonedParts.year),
        Number(zonedParts.month) - 1,
        Number(zonedParts.day),
        Number(zonedParts.hour),
        Number(zonedParts.minute),
        Number(zonedParts.second),
        localTime.millisecond
    );

    return Math.round((zonedAsUtc - utcGuess.getTime()) / 60_000);
}

/**
 * Converts a server time value (unix epoch in seconds) into a Date.
 * 
 * @param serverTime The unix epoch value.
 * @returns The date.
 */
export function getDateFromServerTime(serverTime: number): Date {
    return new Date(serverTime * 1000)
}

/**
 * Generates an IdpAlias to identify a particular device.
 * 
 * @param appId 
 * @param idpId 
 * @param serialNo 
 * @returns The generated IdpAlias
 */
export function generateIdpAlias(
    appId: string,
    deviceId: string,
    serialNo: string
): string {
    return `${appId}:${deviceId}:${serialNo}`
}

/**
 * Generates a random viewer ID using the crypto library.
 * 
 * @returns A number between 100,000,000 and 999,999,999
 */
export function generateViewerId(): number {
    return randomInt(100000000, 999999999)
}

export interface DataHeaders {
    force_update?: boolean
    asset_update?: boolean
    short_udid?: number
    viewer_id?: number
    servertime?: number
    result_code?: number
    udid?: string
}

/**
 * Generates a default data headers object, which is used in communication with the client.
 * 
 * @param customValues A partial DataHeaders object with custom fields to replace the default ones.
 * @returns A DataHeaders object.
 */
export function generateDataHeaders(
    customValues: Partial<DataHeaders> = {},
    fields: (keyof DataHeaders)[] = ['force_update', 'asset_update', 'short_udid', 'viewer_id', 'servertime', 'result_code'],
): Record<string, any> {
    const defaultHeaders: DataHeaders = {
        force_update: false,
        asset_update: false,
        short_udid: 0,
        viewer_id: 0,
        servertime: getServerTime(), //1651514014,//getServerTime(),
        result_code: 1
    }
    const headers: Record<string, any> = {}

    for (const field of fields) {
        const customValue = customValues[field]
        const defaultValue = defaultHeaders[field]
        headers[field] = customValue === undefined ? defaultValue : customValue
    }

    return headers
}

export enum Platform {
    ANDROID,
    IOS
}

export function getRequestPlatformSync(
    request: FastifyRequest
): Platform {
    // check user agent
    if ((request.headers["user-agent"] || '').includes('iOS;'))
        return Platform.IOS;

    // check requestedby header
    if ((request.headers["requestedby"] || '') === 'ios')
        return Platform.IOS;

    return Platform.ANDROID
}

export function getForwardedClientIp(request: FastifyRequest): string | undefined {
    const forwardedFor = request.headers["x-forwarded-for"]
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
        return forwardedFor.split(",")[0].trim()
    }

    if (Array.isArray(forwardedFor) && forwardedFor[0]) {
        return forwardedFor[0].split(",")[0].trim()
    }

    return request.ip
}
