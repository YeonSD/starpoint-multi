import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const rootDir = path.join(__dirname, "..", "..");
const databaseDir = path.join(rootDir, ".database");
const adminAuthPath = path.join(databaseDir, "admin.json");
const defaultUsername = "admin";
const defaultPassword = "admin";
const iterations = 210000;
const keyLength = 32;
const digest = "sha256";

interface AdminAuthStore {
    username: string,
    salt: string,
    passwordHash: string,
    iterations: number,
    keyLength: number,
    digest: string,
    updatedAt: string
}

function hashPassword(password: string, salt: string, rounds = iterations): string {
    return pbkdf2Sync(password, salt, rounds, keyLength, digest).toString("base64url");
}

function readStore(): AdminAuthStore | null {
    if (!existsSync(adminAuthPath)) return null;

    try {
        return JSON.parse(readFileSync(adminAuthPath, "utf-8")) as AdminAuthStore;
    } catch {
        return null;
    }
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyAdminCredentials(username: string, password: string): boolean {
    const store = readStore();
    if (store === null) {
        return username === defaultUsername && password === defaultPassword;
    }

    if (!safeEqual(username, store.username)) return false;
    return safeEqual(
        hashPassword(password, store.salt, store.iterations),
        store.passwordHash
    );
}

export function setAdminPassword(password: string, username = defaultUsername): void {
    if (password.length < 4) throw new Error("Password must be at least 4 characters.");

    if (!existsSync(databaseDir)) mkdirSync(databaseDir, { recursive: true });

    const salt = randomBytes(18).toString("base64url");
    const store: AdminAuthStore = {
        username,
        salt,
        passwordHash: hashPassword(password, salt),
        iterations,
        keyLength,
        digest,
        updatedAt: new Date().toISOString()
    };

    writeFileSync(adminAuthPath, JSON.stringify(store, null, 2));
}

export function isDefaultAdminPasswordActive(): boolean {
    return readStore() === null;
}
