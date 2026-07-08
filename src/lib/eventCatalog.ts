import { existsSync, readFileSync } from "fs";
import path from "path";

export interface EventCatalogGroup {
    id: string;
    name: string;
    eventType: string;
    bannerPath: string;
    backgroundPath: string;
    days: Record<string, boolean>;
    availableFrom: string;
    availableUntil: string | null;
    closeAt: string | null;
    sourceArchive: string;
    sourceEntry: string;
    sourceOffset: number;
}

export interface EventQuestTableSummary {
    id: string;
    label: string;
    file: string;
    questCount: number;
}

export interface EventBannerCandidate {
    index: number;
    file: string;
    width: number;
    height: number;
    sourceArchive: string;
    sourceEntry: string;
    sha1: string;
    note: string;
}

interface EventCatalogFile {
    eventGroups?: EventCatalogGroup[];
}

const eventQuestFiles: Array<{ id: string; label: string; file: string }> = [
    { id: "daily_week", label: "Daily week event quests", file: "daily_week_event_quest.json" },
    { id: "daily_exp_mana", label: "Daily EXP/Mana event quests", file: "daily_exp_mana_event_quest.json" },
    { id: "challenge_dungeon", label: "Challenge dungeon event quests", file: "challenge_dungeon_event_quest.json" },
    { id: "advent", label: "Advent event quests", file: "advent_event_quest.json" },
    { id: "raid", label: "Raid event quests", file: "raid_event_quest.json" },
    { id: "rush", label: "Rush event quests", file: "rush_event_quest.json" },
    { id: "score_attack", label: "Score attack event quests", file: "score_attack_event_quest.json" },
    { id: "story", label: "Story event quests", file: "story_event_single_quest.json" },
    { id: "world_story", label: "World story event quests", file: "world_story_event_quest.json" },
    { id: "tower", label: "Tower dungeon event quests", file: "tower_dungeon_event_quest.json" },
    { id: "carnival", label: "Carnival event quests", file: "carnival_event_quest.json" },
];

export function getEventCatalogGroups(): EventCatalogGroup[] {
    const catalogPath = path.join(__dirname, "../../.generated/event-catalog.json");
    if (!existsSync(catalogPath)) return [];

    const parsed = JSON.parse(readFileSync(catalogPath, "utf-8")) as EventCatalogFile;
    return parsed.eventGroups ?? [];
}

export function getEventQuestTableSummaries(): EventQuestTableSummary[] {
    const assetsDir = path.join(__dirname, "../../assets");

    return eventQuestFiles.map((entry) => {
        const filePath = path.join(assetsDir, entry.file);
        if (!existsSync(filePath)) {
            return { ...entry, questCount: 0 };
        }

        const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
        return {
            ...entry,
            questCount: Object.keys(parsed).length,
        };
    });
}

export function getEventBannerCandidates(): EventBannerCandidate[] {
    const manifestPath = path.join(__dirname, "../../.generated/event-banners.json");
    if (!existsSync(manifestPath)) return [];

    return JSON.parse(readFileSync(manifestPath, "utf-8")) as EventBannerCandidate[];
}
