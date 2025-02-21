import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { type Writable, get, writable } from "svelte/store";
import type { NMetadata } from "../types/nostr";

export type Account = {
    pubkey: string;
    metadata: NMetadata;
    nostr_relays: string[];
    inbox_relays: string[];
    key_package_relays: string[];
    mls_group_ids: Uint8Array[];
    settings: AccountSettings;
    onboarding: AccountOnboarding;
    last_used: number;
    active: boolean;
};

export type AccountSettings = {
    darkTheme: boolean;
    devMode: boolean;
    lockdownMode: boolean;
};

export type AccountOnboarding = {
    inbox_relays: boolean;
    key_package_relays: boolean;
    publish_key_package: boolean;
};

type RelaysData = Record<string, string>;

export const accounts: Writable<Account[]> = writable([]);
export const activeAccount: Writable<Account | null> = writable(null);
export const relays: Writable<RelaysData> = writable({} as RelaysData);

/** Basic matching patterns for hex and nsec keys */
export const hexPattern = /^[a-fA-F0-9]{64}$/;
export const nsecPattern = /^nsec1[a-zA-Z0-9]{58}$/;

/** Custom error class for login-related errors */
export class LoginError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LoginError";
    }
}

/** Custom error class for logout-related errors */
export class LogoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LogoutError";
    }
}

/** Custom error class for NWC-related errors */
export class NostrWalletConnectError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NostrWalletConnectError";
    }
}

export async function setActiveAccount(pubkey: string): Promise<void> {
    if (
        !get(accounts)
            .map((account) => account.pubkey)
            .includes(pubkey) ||
        pubkey === get(activeAccount)?.pubkey
    )
        return;
    emit("account_changing", pubkey);
    return invoke("set_active_account", { hexPubkey: pubkey }).then(async (account) => {
        activeAccount.set(account as Account);
        await fetchRelays();
    });
}

export async function createAccount(): Promise<void> {
    return invoke("create_identity").then(async (account) => {
        activeAccount.set(account as Account);
        await fetchRelays();
    });
}

export async function logout(pubkey: string): Promise<void> {
    await invoke("logout", { hexPubkey: pubkey }).catch((e) => {
        if (e === "No account found") {
            throw new LogoutError("No account found");
        }
        throw new LogoutError(e);
    });
    await updateAccountsStore();
    await fetchRelays();
}

export async function login(nsecOrHex: string): Promise<void> {
    if (!nsecOrHex || (!hexPattern.test(nsecOrHex) && !nsecPattern.test(nsecOrHex))) {
        throw new LoginError("Invalid private key");
    }
    await invoke("login", { nsecOrHexPrivkey: nsecOrHex });
    await updateAccountsStore();
    await fetchRelays();
}

export async function updateAccountsStore(): Promise<void> {
    return invoke("get_accounts")
        .then((accountsResp) => {
            const sortedAccounts = (accountsResp as Account[]).sort((a, b) =>
                a.pubkey.localeCompare(b.pubkey)
            );
            accounts.set(sortedAccounts);
            const currentActiveAccount = sortedAccounts.find((account) => account.active) || null;
            activeAccount.set(currentActiveAccount);
        })
        .catch((_) => {
            accounts.set([]);
            activeAccount.set(null);
        });
}

export async function fetchRelays(): Promise<void> {
    const fetchedRelays: Record<string, string> = await invoke("fetch_relays");
    relays.set(fetchedRelays);
}

export function colorForRelayStatus(status: string): string {
    switch (status) {
        case "Pending":
        case "Initialized":
        case "Connecting":
            return "text-yellow-500";
        case "Connected":
            return "text-green-500";
        case "Disconnected":
        case "Terminated":
            return "text-red-500";
        default:
            return "";
    }
}

export async function hasNostrWalletConnectUri(): Promise<boolean> {
    try {
        return await invoke("has_nostr_wallet_connect_uri");
    } catch (error) {
        throw new NostrWalletConnectError(`Failed to check NWC URI: ${error}`);
    }
}

/** Validates a Nostr Wallet Connect URI and returns detailed error messages */
export function validateNostrWalletConnectUri(uri: string): { isValid: boolean; error?: string } {
    if (!uri.startsWith("nostr+walletconnect://")) {
        return {
            isValid: false,
            error: "Invalid URI format: must start with 'nostr+walletconnect://'"
        };
    }

    try {
        const url = new URL(uri);
        const relay = url.searchParams.get("relay");
        if (!relay) {
            return {
                isValid: false,
                error: "Missing required 'relay' parameter"
            };
        }

        try {
            const relayUrl = new URL(relay);
            if (relayUrl.protocol !== "wss:") {
                return {
                    isValid: false,
                    error: "Relay must use WSS protocol"
                };
            }
        } catch {
            return {
                isValid: false,
                error: "Invalid relay URL format"
            };
        }

        const secret = url.searchParams.get("secret");
        if (!secret) {
            return {
                isValid: false,
                error: "Missing required 'secret' parameter"
            };
        }

        return { isValid: true };
    } catch (error) {
        return {
            isValid: false,
            error: "Invalid URI format"
        };
    }
}

export async function setNostrWalletConnectUri(uri: string): Promise<void> {
    const validation = validateNostrWalletConnectUri(uri);
    if (!validation.isValid) {
        throw new NostrWalletConnectError(validation.error || "Invalid Nostr Wallet Connect URI");
    }

    try {
        await invoke("set_nostr_wallet_connect_uri", { nostrWalletConnectUri: uri });
    } catch (error) {
        throw new NostrWalletConnectError(`Failed to set NWC URI: ${error}`);
    }
}

export async function removeNostrWalletConnectUri(): Promise<void> {
    try {
        await invoke("remove_nostr_wallet_connect_uri");
    } catch (error) {
        throw new NostrWalletConnectError(`Failed to remove NWC URI: ${error}`);
    }
}
