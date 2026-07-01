import boxGacha from "../../assets/box_gacha.json";
import exBoost from "../../assets/ex_boost.json";
import manaNodes from "../../assets/mana_node.json";
import bossCoinShopItems from "../../assets/boss_coin_shop.json";
import eventItemShopItems from "../../assets/event_item_shop.json";
import generalShopItems from "../../assets/general_shop.json";
import starGrainShopItems from "../../assets/star_grain_shop.json";
import treasureShopItems from "../../assets/treasure_shop.json";
import { BossCoinShopItems, EventShopItems, ManaNodes, ShopItems } from "./types";

export interface ItemCatalogEntry {
    id: number,
    label: string,
    source: string
}

function addItem(items: Map<number, Set<string>>, id: string | number | undefined, source: string): void {
    if (id === undefined) return;
    const parsedId = Number(id);
    if (Number.isNaN(parsedId)) return;

    const sources = items.get(parsedId) ?? new Set<string>();
    sources.add(source);
    items.set(parsedId, sources);
}

function collectShopCosts(items: Map<number, Set<string>>, shops: ShopItems, source: string): void {
    for (const shopItem of Object.values(shops)) {
        for (const cost of shopItem.costs ?? []) {
            addItem(items, cost.id, source);
        }
        for (const reward of shopItem.rewards ?? []) {
            if (reward.type === 3) addItem(items, (reward as { id?: number }).id, source);
        }
    }
}

export function getItemCatalog(): ItemCatalogEntry[] {
    const items = new Map<number, Set<string>>();

    for (const box of Object.values(boxGacha as Record<string, { itemId: number }>)) {
        addItem(items, box.itemId, "Box gacha token");
    }

    for (const itemId of Object.keys(exBoost as Record<string, unknown>)) {
        addItem(items, itemId, "EX boost item");
    }

    for (const characterNodes of Object.values(manaNodes as ManaNodes)) {
        for (const boardNodes of Object.values(characterNodes)) {
            for (const node of Object.values(boardNodes)) {
                for (const itemId of Object.keys(node.items ?? {})) {
                    addItem(items, itemId, "Mana board material");
                }
            }
        }
    }

    collectShopCosts(items, generalShopItems as ShopItems, "General shop");
    collectShopCosts(items, starGrainShopItems as ShopItems, "Star grain shop");
    collectShopCosts(items, treasureShopItems as ShopItems, "Treasure shop");
    for (const shop of Object.values(bossCoinShopItems as BossCoinShopItems)) {
        collectShopCosts(items, shop, "Boss coin shop");
    }
    for (const eventType of Object.values(eventItemShopItems as EventShopItems)) {
        for (const shop of Object.values(eventType)) {
            collectShopCosts(items, shop, "Event shop");
        }
    }

    return [...items.entries()]
        .map(([id, sources]) => ({
            id,
            label: `${id} (${[...sources].sort().join(", ")})`,
            source: [...sources].sort().join(", ")
        }))
        .sort((left, right) => left.id - right.id);
}
