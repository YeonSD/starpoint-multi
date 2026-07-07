import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getAllPlayersSync, getPlayerSync, updatePlayerSync } from "../data/wdfpData";
import { MailCurrency, sendCurrencyMailToPlayers } from "./mail";

export type GrantCurrency = MailCurrency;
export type ScheduledGrantInterval = "daily" | "weekly" | "monthly";

export interface CurrencyGrantResult {
    player_id: number
    currency?: GrantCurrency
    amount?: number
    total?: number
    skipped?: boolean
    reason?: string
    mail_id?: number
    delivery?: "direct" | "mail"
}

export interface ScheduledCurrencyGrant {
    id: string
    currency: GrantCurrency
    amount: number
    interval: ScheduledGrantInterval
    enabled: boolean
    createdAt: string
    nextRunAt: string
    lastRunAt: string | null
    lastResultCount: number
}

const databaseDir = path.join(process.cwd(), ".database");
const schedulesPath = path.join(databaseDir, "item-grant-schedules.json");
let runner: ReturnType<typeof setInterval> | null = null;

export function isGrantCurrency(value: unknown): value is GrantCurrency {
    return value === "free_vmoney" || value === "free_mana" || value === "exp_pool";
}

export function isScheduledGrantInterval(value: unknown): value is ScheduledGrantInterval {
    return value === "daily" || value === "weekly" || value === "monthly";
}

export function getAllPlayerIdsForGrant(): number[] {
    return getAllPlayersSync(0, 100000).map((player) => player.id);
}

export function grantCurrencyToPlayers(
    playerIds: number[],
    currency: GrantCurrency,
    amount: number
): CurrencyGrantResult[] {
    return playerIds.map((playerId) => {
        const player = getPlayerSync(playerId);
        if (player === null) {
            return {
                player_id: playerId,
                skipped: true,
                reason: "Player not found."
            };
        }

        const total = Math.max(0, currency === "free_vmoney"
            ? player.freeVmoney + amount
            : currency === "free_mana"
                ? player.freeMana + amount
                : player.expPool + amount);

        updatePlayerSync(currency === "free_vmoney"
            ? { id: playerId, freeVmoney: total }
            : currency === "free_mana"
                ? { id: playerId, freeMana: total }
                : { id: playerId, expPool: total, expPooledTime: new Date() });

        return {
            player_id: playerId,
            currency: currency,
            amount: amount,
            total: total,
            delivery: "direct"
        };
    });
}

export function sendCurrencyMailGrantToPlayers(
    playerIds: number[],
    currency: GrantCurrency,
    amount: number,
    subject?: string,
    description?: string
): CurrencyGrantResult[] {
    return sendCurrencyMailToPlayers(playerIds, currency, amount, subject, description).map((entry) => ({
        ...entry,
        delivery: "mail"
    }));
}

export function listScheduledCurrencyGrants(): ScheduledCurrencyGrant[] {
    return readSchedules();
}

export function createScheduledCurrencyGrant(input: {
    currency: GrantCurrency,
    amount: number,
    interval: ScheduledGrantInterval,
    nextRunAt?: Date
}): ScheduledCurrencyGrant {
    const now = new Date();
    const schedule: ScheduledCurrencyGrant = {
        id: randomUUID(),
        currency: input.currency,
        amount: input.amount,
        interval: input.interval,
        enabled: true,
        createdAt: now.toISOString(),
        nextRunAt: (input.nextRunAt ?? now).toISOString(),
        lastRunAt: null,
        lastResultCount: 0
    };

    const schedules = readSchedules();
    schedules.push(schedule);
    writeSchedules(schedules);
    return schedule;
}

export function deleteScheduledCurrencyGrant(id: string): boolean {
    const schedules = readSchedules();
    const filtered = schedules.filter((schedule) => schedule.id !== id);
    if (filtered.length === schedules.length) return false;
    writeSchedules(filtered);
    return true;
}

export function setScheduledCurrencyGrantEnabled(id: string, enabled: boolean): ScheduledCurrencyGrant | null {
    const schedules = readSchedules();
    const schedule = schedules.find((entry) => entry.id === id);
    if (schedule === undefined) return null;
    schedule.enabled = enabled;
    writeSchedules(schedules);
    return schedule;
}

export function runScheduledCurrencyGrantNow(id: string): {
    schedule: ScheduledCurrencyGrant,
    result: CurrencyGrantResult[]
} | null {
    const schedules = readSchedules();
    const schedule = schedules.find((entry) => entry.id === id);
    if (schedule === undefined) return null;

    const result = executeSchedule(schedule, new Date());
    writeSchedules(schedules);
    return { schedule, result };
}

export function runDueScheduledCurrencyGrants(now: Date = new Date()): number {
    const schedules = readSchedules();
    let executed = 0;

    for (const schedule of schedules) {
        if (!schedule.enabled) continue;

        const nextRun = new Date(schedule.nextRunAt);
        if (Number.isNaN(nextRun.getTime()) || nextRun.getTime() <= now.getTime()) {
            executeSchedule(schedule, now);
            executed += 1;
        }
    }

    if (executed > 0) writeSchedules(schedules);
    return executed;
}

export function startScheduledCurrencyGrantRunner() {
    if (runner !== null) return;

    runDueScheduledCurrencyGrants();
    runner = setInterval(() => {
        try {
            const executed = runDueScheduledCurrencyGrants();
            if (executed > 0) {
                console.log(`[items] executed ${executed} scheduled grant(s)`);
            }
        } catch (error) {
            console.error("[items] failed to execute scheduled grants", error);
        }
    }, 60_000);
}

function executeSchedule(schedule: ScheduledCurrencyGrant, now: Date): CurrencyGrantResult[] {
    const result = sendCurrencyMailGrantToPlayers(getAllPlayerIdsForGrant(), schedule.currency, schedule.amount);
    schedule.lastRunAt = now.toISOString();
    schedule.lastResultCount = result.filter((entry) => entry.skipped !== true).length;

    let nextRunAt = nextDate(new Date(schedule.nextRunAt), schedule.interval);
    if (Number.isNaN(nextRunAt.getTime()) || nextRunAt.getTime() <= now.getTime()) {
        nextRunAt = nextDate(now, schedule.interval);
    }
    while (nextRunAt.getTime() <= now.getTime()) {
        nextRunAt = nextDate(nextRunAt, schedule.interval);
    }
    schedule.nextRunAt = nextRunAt.toISOString();

    return result;
}

function nextDate(date: Date, interval: ScheduledGrantInterval): Date {
    const next = new Date(date);
    if (interval === "daily") {
        next.setUTCDate(next.getUTCDate() + 1);
        return next;
    }
    if (interval === "weekly") {
        next.setUTCDate(next.getUTCDate() + 7);
        return next;
    }
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
}

function readSchedules(): ScheduledCurrencyGrant[] {
    if (!existsSync(schedulesPath)) return [];

    try {
        const parsed = JSON.parse(readFileSync(schedulesPath, "utf-8")) as unknown;
        if (!Array.isArray(parsed)) return [];

        return parsed.filter(isSchedule);
    } catch {
        return [];
    }
}

function writeSchedules(schedules: ScheduledCurrencyGrant[]) {
    if (!existsSync(databaseDir)) mkdirSync(databaseDir, { recursive: true });
    writeFileSync(schedulesPath, JSON.stringify(schedules, null, 2), "utf-8");
}

function isSchedule(value: unknown): value is ScheduledCurrencyGrant {
    if (typeof value !== "object" || value === null) return false;
    const schedule = value as Partial<ScheduledCurrencyGrant>;
    return typeof schedule.id === "string"
        && isGrantCurrency(schedule.currency)
        && typeof schedule.amount === "number"
        && Number.isInteger(schedule.amount)
        && schedule.amount > 0
        && isScheduledGrantInterval(schedule.interval)
        && typeof schedule.enabled === "boolean"
        && typeof schedule.createdAt === "string"
        && typeof schedule.nextRunAt === "string"
        && (schedule.lastRunAt === null || typeof schedule.lastRunAt === "string")
        && typeof schedule.lastResultCount === "number";
}
