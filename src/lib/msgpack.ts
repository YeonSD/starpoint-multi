function pushUInt16(out: number[], value: number) {
    out.push((value >>> 8) & 0xff, value & 0xff)
}

function pushUInt32(out: number[], value: number) {
    out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
}

function pushInt64(out: number[], value: bigint) {
    for (let shift = BigInt(56); shift >= BigInt(0); shift -= BigInt(8)) {
        out.push(Number((value >> shift) & BigInt(0xff)))
    }
}

function pushFloat64(out: number[], value: number) {
    const buffer = Buffer.allocUnsafe(8)
    buffer.writeDoubleBE(value, 0)
    out.push(...buffer)
}

function encodeString(out: number[], value: string) {
    const buffer = Buffer.from(value, "utf8")
    const length = buffer.length

    if (length < 32) {
        out.push(0xa0 | length)
    } else if (length <= 0xff) {
        out.push(0xd9, length)
    } else if (length <= 0xffff) {
        out.push(0xda)
        pushUInt16(out, length)
    } else {
        out.push(0xdb)
        pushUInt32(out, length)
    }

    out.push(...buffer)
}

function encodeArray(out: number[], value: unknown[]) {
    const length = value.length

    if (length < 16) {
        out.push(0x90 | length)
    } else if (length <= 0xffff) {
        out.push(0xdc)
        pushUInt16(out, length)
    } else {
        out.push(0xdd)
        pushUInt32(out, length)
    }

    for (const item of value) encodeValue(out, item)
}

function encodeObject(out: number[], value: Record<string, unknown>) {
    const entries = Object.entries(value)
    const length = entries.length

    if (length < 16) {
        out.push(0x80 | length)
    } else if (length <= 0xffff) {
        out.push(0xde)
        pushUInt16(out, length)
    } else {
        out.push(0xdf)
        pushUInt32(out, length)
    }

    for (const [key, item] of entries) {
        encodeString(out, key)
        encodeValue(out, item)
    }
}

function encodeNumber(out: number[], value: number) {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
        out.push(0xcb)
        pushFloat64(out, value)
        return
    }

    if (value >= 0) {
        if (value < 0x80) {
            out.push(value)
        } else if (value <= 0xff) {
            out.push(0xcc, value)
        } else if (value <= 0xffff) {
            out.push(0xcd)
            pushUInt16(out, value)
        } else if (value <= 0xffffffff) {
            out.push(0xce)
            pushUInt32(out, value)
        } else {
            out.push(0xcf)
            pushInt64(out, BigInt(value))
        }
        return
    }

    if (value >= -32) {
        out.push(0xe0 | (value + 32))
    } else if (value >= -0x80) {
        out.push(0xd0, value & 0xff)
    } else if (value >= -0x8000) {
        out.push(0xd1)
        pushUInt16(out, value & 0xffff)
    } else if (value >= -0x80000000) {
        out.push(0xd2)
        pushUInt32(out, value >>> 0)
    } else {
        out.push(0xd3)
        pushInt64(out, BigInt(value))
    }
}

function encodeValue(out: number[], value: unknown) {
    if (value === null || value === undefined) {
        out.push(0xc0)
    } else if (typeof value === "boolean") {
        out.push(value ? 0xc3 : 0xc2)
    } else if (typeof value === "number") {
        encodeNumber(out, value)
    } else if (typeof value === "string") {
        encodeString(out, value)
    } else if (Array.isArray(value)) {
        encodeArray(out, value)
    } else if (typeof value === "object") {
        encodeObject(out, value as Record<string, unknown>)
    } else {
        out.push(0xc0)
    }
}

export function packMessagePack(value: unknown): Buffer {
    const out: number[] = []
    encodeValue(out, value)
    return Buffer.from(out)
}
