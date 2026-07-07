import gachas from "../../assets/gacha.json";
import gachaDisplayOverrides from "../../assets/gacha_display_overrides.json";
import { Gacha, Gachas } from "./types";

export interface GachaScheduleOption {
    id: string,
    label: string,
    typeLabel: string,
    title: string,
    subtitle: string | null,
    bannerPath: string | null,
    startDate: string,
    endDate: string,
    serverTime: string
}

interface GachaDisplayOverride {
    titleKo?: string,
    subtitleKo?: string,
    bannerPath?: string | null
}

function parseAssetDate(value: string): Date {
    return new Date(`${value.replace(" ", "T")}.000Z`);
}

function formatInputDate(date: Date): string {
    return date.toISOString().replace(/\.\d\d\dZ$/, "");
}

function getGachaTypeLabel(gacha: Gacha): string {
    return gacha.type === 0 ? "Unit" : "Armament";
}

export function getGachaScheduleOptions(): GachaScheduleOption[] {
    return Object.entries(gachas as Gachas)
        .filter(([, gacha]) => gacha.startDate !== undefined && gacha.endDate !== undefined)
        .map(([id, gacha]) => {
            const startDate = parseAssetDate(gacha.startDate);
            const serverTime = new Date(startDate.getTime() + 60 * 60 * 1000);
            const typeLabel = getGachaTypeLabel(gacha);
            const override = (gachaDisplayOverrides as Record<string, GachaDisplayOverride>)[id];
            const title = override?.titleKo ?? `${typeLabel} Gacha ${id}`;
            const subtitle = override?.subtitleKo ?? null;
            return {
                id,
                label: `${title} (${typeLabel}, ${gacha.startDate} to ${gacha.endDate})`,
                typeLabel,
                title,
                subtitle,
                bannerPath: override?.bannerPath ?? null,
                startDate: gacha.startDate,
                endDate: gacha.endDate,
                serverTime: formatInputDate(serverTime)
            };
        })
        .sort((left, right) => left.startDate.localeCompare(right.startDate) || Number(left.id) - Number(right.id));
}

export function getGachaScheduleOption(id: string | number): GachaScheduleOption | null {
    return getGachaScheduleOptions().find((option) => option.id === String(id)) ?? null;
}
