import { ClientUserInfo, Player } from "../data/types";
import { getServerTime } from "../utils";

type SerializedStamina = Pick<ClientUserInfo, "stamina" | "stamina_heal_time">;

export function serializeInfiniteStamina(
    playerData: Pick<Player, "stamina"> | null | undefined,
    fallbackStamina: number = 20
): SerializedStamina {
    const stamina = Math.max(playerData?.stamina ?? fallbackStamina, fallbackStamina);
    return {
        "stamina": stamina,
        "stamina_heal_time": getServerTime()
    };
}
