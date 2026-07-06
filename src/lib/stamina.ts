import { ClientUserInfo, Player } from "../data/types";
import { getServerTime } from "../utils";

type SerializedStamina = Pick<ClientUserInfo, "stamina" | "stamina_heal_time">;

export function serializeInfiniteStamina(
    playerData: Pick<Player, "stamina"> | null | undefined,
    fallbackStamina: number = 20
): SerializedStamina {
    return {
        "stamina": playerData?.stamina ?? fallbackStamina,
        "stamina_heal_time": getServerTime()
    };
}
