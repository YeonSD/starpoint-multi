import itemMasterJson from "../../assets/item_master.generated.json";

export type ItemCatalogKind = "currency" | "item";
export type ItemCatalogConfidence = "confirmed" | "inferred" | "unknown";

export interface ItemCatalogEntry {
    key: string;
    kind: ItemCatalogKind;
    id: number | null;
    nameKo: string;
    nameEn: string;
    categoryKo: string;
    descriptionKo?: string;
    usageKo?: string;
    iconPath?: string;
    thumbnailId?: string;
    smallVectorIconId?: string;
    screenOrder?: number;
    confidence: ItemCatalogConfidence;
    sources: string[];
}

interface GeneratedItemMasterEntry {
    id: number;
    stringId: string | null;
    nameKo: string;
    thumbnailId: string | null;
    smallVectorIconId: string | null;
    descriptionKo: string | null;
    effectKind: number | null;
    category: number | null;
    group: number | null;
    rarity: number | null;
    maxCount: number | null;
    sourceArchive: string;
    sourceEntry: string;
}

const itemMaster = itemMasterJson as Record<string, GeneratedItemMasterEntry>;

function resolveSaveItemId(entry: GeneratedItemMasterEntry): number {
    const abilityMaterialMatch = entry.stringId?.match(/^ability_material_(\d+)$/);
    if (abilityMaterialMatch !== undefined && abilityMaterialMatch !== null) {
        return Number.parseInt(abilityMaterialMatch[1], 10) + 1;
    }

    return entry.id;
}

const itemScreenOrder = new Map<number, number>([
    [1, 1], [2, 2], [3, 3], [5, 4], [6, 5],
    [9, 6], [10, 7], [13, 8], [14, 9], [42, 10], [43, 11], [44, 12],
    [46, 13], [47, 14], [14001, 15], [14002, 16], [14003, 17],
    [14004, 18], [14005, 19], [14006, 20], [14007, 21], [14008, 22],
    [14009, 23], [14010, 24], [14011, 25], [14012, 26], [14013, 27],
    [14014, 28], [14015, 29], [14016, 30], [14017, 31], [14018, 32],
    [40000, 101], [40020, 102], [40050, 103], [40090, 104], [40110, 105]
]);

const knownSaveItemIds = [...itemScreenOrder.keys()];

const groupLabels: Record<number, string> = {
    0: "퍼플 코인",
    1: "골드 코인",
    2: "실버 코인",
    3: "퍼플 코인 조각",
    4: "골드 코인 조각",
    5: "실버 코인 조각",
    6: "파성 결정",
    7: "파성 결정 조각",
    8: "에테르",
    9: "속성 아이템",
    10: "꿈꾸는 문장",
    11: "크래프트 포인트",
    12: "별의 가루"
};

const effectKindLabels: Record<number, string> = {
    0: "육성 아이템",
    1: "장비 강화",
    2: "스태미나",
    3: "스태미나",
    4: "오버 리미트",
    5: "오버 리미트 조각",
    6: "장비 각성",
    7: "장비 각성 조각",
    8: "뽑기 티켓",
    9: "이벤트 교환",
    10: "입장 아이템",
    11: "어빌리티 소울",
    12: "특별 교환권",
    13: "스타트 대시 교환권",
    14: "기타",
    15: "교환 아이템",
    16: "크래프트 포인트",
    17: "컨티뉴",
    18: "퀘스트 해금",
    19: "퀘스트 시작",
    20: "별의 가루",
    21: "EX 부스트"
};

const currencyEntries: ItemCatalogEntry[] = [
    {
        key: "free_vmoney",
        kind: "currency",
        id: null,
        nameKo: "성도석",
        nameEn: "Lodestar Beads",
        categoryKo: "재화",
        confidence: "confirmed",
        sources: ["mail_receive_test", "save.json"]
    },
    {
        key: "free_mana",
        kind: "currency",
        id: null,
        nameKo: "마나",
        nameEn: "Mana",
        categoryKo: "재화",
        confidence: "confirmed",
        sources: ["mail_receive_test", "save.json"]
    },
    {
        key: "exp_pool",
        kind: "currency",
        id: null,
        nameKo: "경험치",
        nameEn: "Experience",
        categoryKo: "재화",
        confidence: "confirmed",
        sources: ["mail_receive_test", "save.json"]
    }
];

function categoryLabel(entry: GeneratedItemMasterEntry): string {
    if (entry.group !== null && groupLabels[entry.group] !== undefined) {
        return groupLabels[entry.group];
    }
    if (entry.effectKind !== null && effectKindLabels[entry.effectKind] !== undefined) {
        return effectKindLabels[entry.effectKind];
    }
    if (entry.category !== null) {
        return `카테고리 ${entry.category}`;
    }
    return "아이템";
}

function generatedEntryToCatalogEntry(entry: GeneratedItemMasterEntry): ItemCatalogEntry {
    const itemId = resolveSaveItemId(entry);
    const sources = [
        `cdn:${entry.sourceArchive}`,
        entry.sourceEntry
    ];

    if (itemScreenOrder.has(itemId)) {
        sources.push("save.json item_list", "item_list_screen");
    }

    return {
        key: `item:${itemId}`,
        kind: "item",
        id: itemId,
        nameKo: entry.nameKo,
        nameEn: entry.stringId ?? `Item ${itemId}`,
        categoryKo: categoryLabel(entry),
        descriptionKo: entry.descriptionKo ?? undefined,
        thumbnailId: entry.thumbnailId ?? undefined,
        smallVectorIconId: entry.smallVectorIconId ?? undefined,
        screenOrder: itemScreenOrder.get(itemId),
        confidence: "confirmed",
        sources
    };
}

function fallbackSaveItemEntry(id: number): ItemCatalogEntry {
    return {
        key: `item:${id}`,
        kind: "item",
        id,
        nameKo: id >= 40000 ? `미확인 교환용 아이템 ${id}` : `미확인 아이템 ${id}`,
        nameEn: id >= 40000 ? `Unknown Exchange Item ${id}` : `Unknown Item ${id}`,
        categoryKo: id >= 40000 ? "교환용 아이템" : "아이템",
        screenOrder: itemScreenOrder.get(id),
        confidence: "unknown",
        sources: ["save.json item_list", "item_list_screen"]
    };
}

const generatedItemEntries = Object.values(itemMaster).map(generatedEntryToCatalogEntry);
const generatedItemIds = new Set(generatedItemEntries.map((entry) => entry.id));
const fallbackItemEntries = knownSaveItemIds
    .filter((id) => !generatedItemIds.has(id))
    .map(fallbackSaveItemEntry);

export const itemCatalogEntries: ItemCatalogEntry[] = [
    ...currencyEntries,
    ...generatedItemEntries,
    ...fallbackItemEntries
];

export function getItemCatalogEntries(): ItemCatalogEntry[] {
    return [...itemCatalogEntries].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "currency" ? -1 : 1;
        const screenOrderDiff = (a.screenOrder ?? Number.MAX_SAFE_INTEGER) - (b.screenOrder ?? Number.MAX_SAFE_INTEGER);
        if (screenOrderDiff !== 0) return screenOrderDiff;
        return (a.id ?? 0) - (b.id ?? 0);
    });
}

export function getItemCatalogEntryByItemId(itemId: number): ItemCatalogEntry | undefined {
    return itemCatalogEntries.find((entry) => entry.kind === "item" && entry.id === itemId);
}
