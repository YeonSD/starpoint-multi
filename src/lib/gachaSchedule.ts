import gachas from "../../assets/gacha.json";
import { Gacha, Gachas } from "./types";

export interface GachaScheduleOption {
    id: string,
    label: string,
    startDate: string,
    endDate: string,
    serverTime: string
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
            return {
                id,
                label: `${id} - ${getGachaTypeLabel(gacha)} (${gacha.startDate} to ${gacha.endDate})`,
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
