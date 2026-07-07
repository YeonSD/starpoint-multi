import { clientSerializeDate } from "../data/utils";
import {
    getPlayerMailSync,
    getPlayerMailsSync,
    getPlayerSync,
    getPlayerUnreceivedMailCountSync,
    insertPlayerMailSync,
    markPlayerMailReceivedSync
} from "../data/wdfpData";
import { Player, PlayerMail } from "../data/types";
import { getServerTime } from "../utils";
import { givePlayerRewardsSync } from "./quest";
import { serializeInfiniteStamina } from "./stamina";
import { CurrencyReward, EquipmentItemReward, PlayerRewardResult, Reward, RewardType } from "./types";

const UNRECEIVED_MAIL_TIME = "0000-00-00 00:00:00";

export enum MailKind {
    ITEM = 0,
    EQUIPMENT = 1,
    FREE_VMONEY = 2,
    FREE_MANA = 3,
    EXP = 4,
    CHARACTER = 5,
    DEGREE = 6
}

export interface SerializedMail {
    create_time: string
    description: string | null
    id: number
    number: number
    reason_id: number
    receive_time: string
    reward_limit_time: string | null
    reward_period_limited: boolean
    subject: string | null
    type: number
    type_id: number | null
}

export interface SendCurrencyMailResult {
    player_id: number
    currency?: "free_vmoney" | "free_mana"
    amount?: number
    mail_id?: number
    skipped?: boolean
    reason?: string
}

export function serializeMail(mail: PlayerMail): SerializedMail {
    return {
        "create_time": clientSerializeDate(mail.createTime),
        "description": mail.description,
        "id": mail.id,
        "number": mail.number,
        "reason_id": mail.reasonId,
        "receive_time": mail.receiveTime === null ? UNRECEIVED_MAIL_TIME : clientSerializeDate(mail.receiveTime),
        "reward_limit_time": mail.rewardLimitTime === null ? null : clientSerializeDate(mail.rewardLimitTime),
        "reward_period_limited": mail.rewardPeriodLimited,
        "subject": mail.subject,
        "type": mail.type,
        "type_id": mail.typeId
    }
}

export function sendCurrencyMailToPlayers(
    playerIds: number[],
    currency: "free_vmoney" | "free_mana",
    amount: number,
    subject?: string,
    description?: string
): SendCurrencyMailResult[] {
    return playerIds.map((playerId) => {
        if (getPlayerSync(playerId) === null) {
            return {
                player_id: playerId,
                skipped: true,
                reason: "Player not found."
            };
        }

        const mail = insertPlayerMailSync(playerId, {
            type: currency === "free_vmoney" ? MailKind.FREE_VMONEY : MailKind.FREE_MANA,
            number: amount,
            subject: subject ?? defaultCurrencySubject(currency),
            description: description ?? defaultCurrencyDescription(currency, amount)
        });

        return {
            player_id: playerId,
            currency,
            amount,
            mail_id: mail.id
        };
    });
}

export function listPlayerMailPage(playerId: number, currentPage: number = 1) {
    const pageSize = 100;
    const page = Math.max(1, Math.trunc(currentPage));
    const mails = getPlayerMailsSync(playerId, (page - 1) * pageSize, pageSize);
    return {
        "mail": mails.map(serializeMail),
        "total_count": getPlayerUnreceivedMailCountSync(playerId)
    }
}

export function receivePlayerMail(playerId: number, mailId: number) {
    const mail = getPlayerMailSync(playerId, mailId);
    if (mail === null || mail.receiveTime !== null) return null;

    const reward = mailToReward(mail);
    const rewardResult = reward === null ? emptyRewardResult() : givePlayerRewardsSync(playerId, [reward]);
    if (rewardResult === null) return null;

    markPlayerMailReceivedSync(playerId, mailId);
    return buildReceiveResponse(playerId, rewardResult);
}

export function receivePlayerMails(playerId: number, mailIds: number[]) {
    const ids = mailIds.length > 0
        ? [...new Set(mailIds)]
        : getPlayerMailsSync(playerId).map((mail) => mail.id);
    const receivedIds: number[] = [];
    let rewardResult = emptyRewardResult();

    for (const mailId of ids) {
        const mail = getPlayerMailSync(playerId, mailId);
        if (mail === null || mail.receiveTime !== null) continue;

        const reward = mailToReward(mail);
        const result = reward === null ? emptyRewardResult() : givePlayerRewardsSync(playerId, [reward]);
        if (result === null) continue;

        rewardResult = mergeRewardResults(rewardResult, result);
        markPlayerMailReceivedSync(playerId, mailId);
        receivedIds.push(mailId);
    }

    return {
        ...buildReceiveResponse(playerId, rewardResult),
        "already_mail_count": Math.max(0, ids.length - receivedIds.length),
        "auto_sale_expired_mail_count": 0,
        "deleted_mail_count": 0,
        "dispose_expired_mail_count": 0,
        "ex_boost_item_list": [],
        "mail_ids": receivedIds,
        "max_overed_mail_count": 0,
        "outdated_mail_count": 0
    }
}

function mailToReward(mail: PlayerMail): Reward | null {
    if (mail.number === 0) return null;

    switch (mail.type) {
        case MailKind.ITEM:
            if (mail.typeId === null) return null;
            return { type: RewardType.ITEM, id: mail.typeId, count: mail.number } as EquipmentItemReward;
        case MailKind.FREE_VMONEY:
            return { type: RewardType.BEADS, count: mail.number } as CurrencyReward;
        case MailKind.FREE_MANA:
            return { type: RewardType.MANA, count: mail.number } as CurrencyReward;
        case MailKind.EXP:
            return { type: RewardType.EXP, count: mail.number } as CurrencyReward;
        default:
            return null;
    }
}

function buildReceiveResponse(playerId: number, rewardResult: PlayerRewardResult) {
    const player = getPlayerSync(playerId);
    if (player === null) throw new Error(`Player ${playerId} not found after receiving mail.`);

    return {
        "auto_sale_expired_mail": false,
        "dispose_expired_mail": false,
        "total_count": getPlayerUnreceivedMailCountSync(playerId),
        "user_periodic_reward_point_list": [],
        "user_daily_challenge_point_list": [],
        "character_list": rewardResult.character_list,
        "equipment_list": rewardResult.equipment_list,
        "item_list": rewardResult.items,
        "mail_arrived": getPlayerUnreceivedMailCountSync(playerId) > 0,
        "user_info": serializeMailUserInfo(player)
    }
}

function serializeMailUserInfo(player: Player) {
    return {
        ...serializeInfiniteStamina(player),
        "bond_token": player.bondToken,
        "boost_point": player.boostPoint,
        "boss_boost_point": player.bossBoostPoint,
        "degree_id": player.degreeId,
        "enable_auto_3x": player.enableAuto3x,
        "exp_pool": player.expPool,
        "exp_pooled_time": getServerTime(player.expPooledTime),
        "free_mana": player.freeMana,
        "free_vmoney": player.freeVmoney,
        "paid_mana": player.paidMana,
        "rank_point": player.rankPoint,
        "star_crumb": player.starCrumb,
        "vmoney": player.vmoney
    }
}

function emptyRewardResult(): PlayerRewardResult {
    return {
        "user_info": {
            "free_mana": 0,
            "free_vmoney": 0,
            "exp_pool": 0
        },
        "character_list": [],
        "joined_character_id_list": [],
        "equipment_list": [],
        "items": {}
    }
}

function mergeRewardResults(left: PlayerRewardResult, right: PlayerRewardResult): PlayerRewardResult {
    const items = { ...left.items };
    for (const [itemId, count] of Object.entries(right.items)) {
        items[itemId] = count;
    }

    return {
        "user_info": {
            "free_mana": left.user_info.free_mana + right.user_info.free_mana,
            "free_vmoney": left.user_info.free_vmoney + right.user_info.free_vmoney,
            "exp_pool": left.user_info.exp_pool + right.user_info.exp_pool
        },
        "character_list": [...left.character_list, ...right.character_list],
        "joined_character_id_list": [...left.joined_character_id_list, ...right.joined_character_id_list],
        "equipment_list": [...left.equipment_list, ...right.equipment_list],
        "items": items
    }
}

function defaultCurrencySubject(currency: "free_vmoney" | "free_mana"): string {
    return currency === "free_vmoney" ? "Lodestar Beads" : "Mana";
}

function defaultCurrencyDescription(currency: "free_vmoney" | "free_mana", amount: number): string {
    const name = currency === "free_vmoney" ? "lodestar beads" : "mana";
    return `You received ${amount} ${name}.`;
}
