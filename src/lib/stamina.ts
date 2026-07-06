import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { ClientUserInfo, Player } from "../data/types";
import { getServerTime, getServerTimeSettings } from "../utils";

export type StaminaMode = "infinite" | "normal";

export interface StaminaSettings {
    liveMode: StaminaMode
    updatedAt: string
}

const databaseDir = path.join(process.cwd(), ".database");
const staminaSettingsPath = path.join(databaseDir, "stamina-settings.json");
const defaultStamina = 20;
let staminaSettings: StaminaSettings = readPersistedStaminaSettings();

export function getStaminaSettings(): StaminaSettings {
    return { ...staminaSettings };
}

export function setStaminaSettings(input: { liveMode: StaminaMode }): StaminaSettings {
    staminaSettings = {
        liveMode: input.liveMode,
        updatedAt: new Date().toISOString()
    };
    persistStaminaSettings(staminaSettings);
    return getStaminaSettings();
}

export function isStaminaMode(value: unknown): value is StaminaMode {
    return value === "infinite" || value === "normal";
}

export function getEffectiveStaminaMode(): StaminaMode {
    return getServerTimeSettings().mode === "fixed"
        ? "infinite"
        : staminaSettings.liveMode;
}

export function serializeStaminaUserInfo(
    player: Pick<Player, "stamina" | "staminaHealTime"> | null | undefined
): Pick<ClientUserInfo, "stamina" | "stamina_heal_time"> {
    const now = getServerTime();
    const stamina = player?.stamina ?? defaultStamina;

    if (getEffectiveStaminaMode() === "infinite") {
        return {
            "stamina": Math.max(stamina, defaultStamina),
            "stamina_heal_time": now
        };
    }

    const storedHealTime = player === null || player === undefined
        ? now
        : getServerTime(player.staminaHealTime);

    return {
        "stamina": stamina,
        "stamina_heal_time": Math.min(storedHealTime, now)
    };
}

function readPersistedStaminaSettings(): StaminaSettings {
    if (!existsSync(staminaSettingsPath)) return defaultStaminaSettings();

    try {
        const raw = JSON.parse(readFileSync(staminaSettingsPath, "utf-8")) as unknown;
        if (typeof raw !== "object" || raw === null) return defaultStaminaSettings();
        const settings = raw as Partial<StaminaSettings>;
        if (!isStaminaMode(settings.liveMode)) return defaultStaminaSettings();
        return {
            liveMode: settings.liveMode,
            updatedAt: typeof settings.updatedAt === "string" ? settings.updatedAt : new Date().toISOString()
        };
    } catch {
        return defaultStaminaSettings();
    }
}

function persistStaminaSettings(settings: StaminaSettings): void {
    if (!existsSync(databaseDir)) mkdirSync(databaseDir, { recursive: true });
    writeFileSync(staminaSettingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

function defaultStaminaSettings(): StaminaSettings {
    return {
        liveMode: "infinite",
        updatedAt: new Date().toISOString()
    };
}
