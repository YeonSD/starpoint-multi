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
    screenOrder?: number;
    confidence: ItemCatalogConfidence;
    sources: string[];
}

export const itemCatalogEntries: ItemCatalogEntry[] = [
    {
        key: "free_vmoney",
        kind: "currency",
        id: null,
        nameKo: "성도석",
        nameEn: "Lodestar Beads",
        categoryKo: "재화",
        confidence: "confirmed",
        sources: ["mail_receive_test"]
    },
    {
        key: "free_mana",
        kind: "currency",
        id: null,
        nameKo: "마나",
        nameEn: "Mana",
        categoryKo: "재화",
        confidence: "confirmed",
        sources: ["mail_receive_test"]
    },
    {
        key: "exp_pool",
        kind: "currency",
        id: null,
        nameKo: "경험치",
        nameEn: "Experience",
        categoryKo: "재화",
        confidence: "confirmed",
        sources: ["mail_receive_test"]
    },
    {
        key: "item:1",
        kind: "item",
        id: 1,
        nameKo: "불의 엘리먼트",
        nameEn: "Fire Element",
        categoryKo: "육성 아이템",
        descriptionKo: "불 에너지가 응고되어 만들어진 작은 조각.",
        usageKo: "주로 화속성 캐릭터의 어빌리티 습득에 사용합니다",
        screenOrder: 1,
        confidence: "confirmed",
        sources: ["save.json item_list", "item_list_screen", "item_detail_screen"]
    },
    {
        key: "item:2",
        kind: "item",
        id: 2,
        nameKo: "불꽃의 엘리먼트",
        nameEn: "Fire Element Cluster",
        categoryKo: "육성 아이템",
        screenOrder: 2,
        confidence: "confirmed",
        sources: ["save.json item_list", "item_list_screen"]
    },
    {
        key: "item:3",
        kind: "item",
        id: 3,
        nameKo: "열화의 엘리먼트",
        nameEn: "Fire Element Core",
        categoryKo: "육성 아이템",
        screenOrder: 3,
        confidence: "confirmed",
        sources: ["save.json item_list", "item_list_screen"]
    },
    {
        key: "item:5",
        kind: "item",
        id: 5,
        nameKo: "물의 엘리먼트",
        nameEn: "Water Element",
        categoryKo: "육성 아이템",
        screenOrder: 4,
        confidence: "confirmed",
        sources: ["save.json item_list", "item_list_screen"]
    },
    {
        key: "item:6",
        kind: "item",
        id: 6,
        nameKo: "청류의 엘리먼트",
        nameEn: "Water Element Cluster",
        categoryKo: "육성 아이템",
        screenOrder: 5,
        confidence: "confirmed",
        sources: ["save.json item_list", "item_list_screen"]
    },
    ...[
        [9, 6], [10, 7], [13, 8], [14, 9], [42, 10], [43, 11], [44, 12],
        [46, 13], [47, 14], [14001, 15], [14002, 16], [14003, 17],
        [14004, 18], [14005, 19], [14006, 20], [14007, 21], [14008, 22],
        [14009, 23], [14010, 24], [14011, 25], [14012, 26], [14013, 27],
        [14014, 28], [14015, 29], [14016, 30], [14017, 31], [14018, 32]
    ].map(([id, screenOrder]) => ({
        key: `item:${id}`,
        kind: "item" as const,
        id,
        nameKo: `미확인 아이템 ${id}`,
        nameEn: `Unknown Item ${id}`,
        categoryKo: "육성 아이템",
        screenOrder,
        confidence: "inferred" as const,
        sources: ["save.json item_list", "item_list_screen"]
    })),
    ...[
        [40000, 1], [40020, 2], [40050, 3], [40090, 4], [40110, 5]
    ].map(([id, screenOrder]) => ({
        key: `item:${id}`,
        kind: "item" as const,
        id,
        nameKo: `미확인 교환용 아이템 ${id}`,
        nameEn: `Unknown Exchange Item ${id}`,
        categoryKo: "교환용 아이템",
        screenOrder,
        confidence: "inferred" as const,
        sources: ["save.json item_list", "item_list_screen"]
    }))
];

export function getItemCatalogEntries(): ItemCatalogEntry[] {
    return [...itemCatalogEntries].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "currency" ? -1 : 1;
        if (a.categoryKo !== b.categoryKo) return a.categoryKo.localeCompare(b.categoryKo);
        return (a.screenOrder ?? Number.MAX_SAFE_INTEGER) - (b.screenOrder ?? Number.MAX_SAFE_INTEGER);
    });
}

export function getItemCatalogEntryByItemId(itemId: number): ItemCatalogEntry | undefined {
    return itemCatalogEntries.find((entry) => entry.kind === "item" && entry.id === itemId);
}
