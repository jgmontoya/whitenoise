<script lang="ts">
import { goto } from "$app/navigation";
import Avatar from "$lib/components/Avatar.svelte";
import ConfirmSheet from "$lib/components/ConfirmSheet.svelte";
import FormattedNpub from "$lib/components/FormattedNpub.svelte";
import Header from "$lib/components/Header.svelte";
import LoginSheet from "$lib/components/LoginSheet.svelte";
import * as Accordion from "$lib/components/ui/accordion";
import Button from "$lib/components/ui/button/button.svelte";
import * as Sheet from "$lib/components/ui/sheet";
import {
    LogoutError,
    accounts,
    activeAccount,
    fetchRelays,
    logout,
    setActiveAccount,
    updateAccountsStore,
} from "$lib/stores/accounts";
import { nameFromMetadata, npubFromPubkey } from "$lib/utils/nostr";
import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from "@tauri-apps/plugin-notification";
import AddLarge from "carbon-icons-svelte/lib/AddLarge.svelte";
import ChevronRight from "carbon-icons-svelte/lib/ChevronRight.svelte";
import ChevronSort from "carbon-icons-svelte/lib/ChevronSort.svelte";
import Logout from "carbon-icons-svelte/lib/Logout.svelte";
import Notification from "carbon-icons-svelte/lib/Notification.svelte";
import Password from "carbon-icons-svelte/lib/Password.svelte";
import Satellite from "carbon-icons-svelte/lib/Satellite.svelte";
import TrashCan from "carbon-icons-svelte/lib/TrashCan.svelte";
import User from "carbon-icons-svelte/lib/User.svelte";
import Wallet from "carbon-icons-svelte/lib/Wallet.svelte";
import { onDestroy, onMount } from "svelte";
import { _ as t } from "svelte-i18n";
import { toast } from "svelte-sonner";

let showLoginSheet = $state(false);
let showSwitchAccountSheet = $state(false);
let addProfileLoading = $state(false);

let showLogoutConfirmSheet = $state(false);
let showDeleteAllConfirmSheet = $state(false);
let showDeleteAllKeyPackagesConfirmSheet = $state(false);
let showPublishKeyPackageConfirmSheet = $state(false);

let accordionOpenSection = $state("profile");

let unlisten: UnlistenFn;

onMount(async () => {
    if (!unlisten) {
        unlisten = await listen<string>("account_changed", (_event) => {
            updateAccountsStore().then(() => {
                console.log("account_changed & updateAccountStore from settings page.");
                fetchRelays();
                showSwitchAccountSheet = false;
                showLoginSheet = false;
            });
        });
    }

    fetchRelays();
});

onDestroy(() => {
    unlisten?.();
});

async function handleLogout(pubkey: string): Promise<void> {
    logout(pubkey)
        .then(() => {
            toast.success($t("settings.logoutSuccess"));
            showLogoutConfirmSheet = false;
        })
        .catch((e) => {
            if (e instanceof LogoutError) {
                goto("/");
            } else {
                toast.error($t("settings.logoutError"));
                console.error(e);
            }
        })
        .finally(() => {
            showLogoutConfirmSheet = false;
        });
}

async function testNotification() {
    let permissionGranted = await isPermissionGranted();

    if (!permissionGranted) {
        permissionGranted = "granted" === (await requestPermission());
    }
    if (permissionGranted) {
        sendNotification({
            title: "White Noise",
            body: $t("settings.notificationSuccess"),
        });
    }
}

async function deleteAll() {
    invoke("delete_all_data")
        .then(() => {
            toast.info($t("settings.deleteAllDataSuccess"));
            goto("/login");
        })
        .catch((e) => {
            toast.error($t("settings.deleteAllDataError"));
            console.error(e);
        })
        .finally(() => {
            showDeleteAllConfirmSheet = false;
        });
}

function deleteAllKeyPackages() {
    invoke("delete_all_key_packages")
        .then(() => toast.success($t("settings.deleteKeyPackagesSuccess")))
        .catch((e) => {
            toast.error($t("settings.deleteKeyPackagesError"));
            console.error(e);
        })
        .finally(() => {
            showDeleteAllKeyPackagesConfirmSheet = false;
        });
}

function publishKeyPackage() {
    invoke("publish_new_key_package", {})
        .then(() => toast.success($t("settings.publishKeyPackageSuccess")))
        .catch((e) => {
            toast.error($t("settings.publishKeyPackageError"));
            console.error(e);
        })
        .finally(() => {
            showPublishKeyPackageConfirmSheet = false;
        });
}
</script>

<Header backLocation="/chats" title={$t("settings.title")} />

<main class="px-4 py-6 flex flex-col gap-4">
    <Accordion.Root bind:value={accordionOpenSection} class="px-2">
        <Accordion.Item value="profile">
            <Accordion.Trigger onclick={(e) => {
                if ((e.target as HTMLElement).id === "add-profile-button") {
                    accordionOpenSection = "profile";
                }
            }}>
                <h2 class="text-3xl font-normal text-primary leading-none">
                  {$t("settings.profile")}
                </h2>
                <LoginSheet
                  title={$t("settings.addNewProfile")}
                  loading={addProfileLoading}
                  bind:sheetVisible={showLoginSheet}
                  showCreateAccount={true}
                >
                    <Button variant="ghost" size="icon" class="p-2 shrink-0 -mr-2" id="add-profile-button">
                        <AddLarge size={24} class="shrink-0 !h-6 !w-6" />
                    </Button>
                </LoginSheet>
            </Accordion.Trigger>
            <Accordion.Content class="overflow-visible">
                <div class="overflow-visible p-0 m-0">
                    <div class="flex flex-row gap-3 items-center min-w-0 w-full mb-4 overflow-visible">
                        <Avatar
                            pubkey={$activeAccount!.pubkey}
                            picture={$activeAccount!.metadata?.picture}
                            pxSize={56}
                        />
                        <div class="flex flex-col gap-0 min-w-0 justify-start text-left truncate w-full">
                            <div class="truncate text-lg font-medium">
                                {nameFromMetadata($activeAccount!.metadata, $activeAccount!.pubkey)}
                            </div>
                            <div class="flex gap-4 items-center">
                                <FormattedNpub npub={npubFromPubkey($activeAccount!.pubkey)} showCopy={true} />
                            </div>
                        </div>
                        {#if $accounts.length > 1}
                            <Sheet.Root bind:open={showSwitchAccountSheet}>
                                <Sheet.Trigger>
                                    <Button variant="ghost" size="icon" class="p-2 shrink-0 -mr-2">
                                        <ChevronSort size={24} class="text-muted-foreground shrink-0 !w-6 !h-6" />
                                    </Button>
                                </Sheet.Trigger>
                                <Sheet.Content side="bottom" class="pb-safe-bottom px-0 max-h-[90%]">
                                    <div class="flex flex-col h-full relative">
                                        <Sheet.Header class="text-left mb-4 px-6 sticky top-0">
                                            <Sheet.Title>{$t("settings.switchProfile")}</Sheet.Title>
                                        </Sheet.Header>
                                        <div class="max-h-[500px] flex flex-col gap-0.5 overflow-y-auto pb-6">
                                            {#each $accounts as account (account.pubkey)}
                                                <Button variant="ghost" size="lg" class="h-fit flex flex-row gap-3 items-center min-w-0 w-full py-2 focus-visible:outline-none focus-visible:ring-0" onclick={() => setActiveAccount(account.pubkey)}>
                                                    <Avatar
                                                        pubkey={account.pubkey}
                                                        picture={account.metadata?.picture}
                                                        pxSize={56}
                                                    />
                                                    <div class="flex flex-col gap-0 min-w-0 justify-start text-left truncate w-full">
                                                        <div class="truncate text-lg font-medium">
                                                            {nameFromMetadata(account.metadata, account.pubkey)}
                                                        </div>
                                                        <div class="flex gap-4 items-center">
                                                            <FormattedNpub npub={npubFromPubkey(account.pubkey)} showCopy={false} />
                                                        </div>
                                                    </div>
                                                </Button>
                                            {/each}
                                        </div>
                                    </div>
                                </Sheet.Content>
                            </Sheet.Root>
                        {:else}
                            <!-- Empty div to keep the layout consistent -->
                            <div class="w-6 h-6"></div>
                        {/if}
                    </div>

                    <ul class="list-none p-0 m-0 overflow-hidden">
                        <li class="p-0 m-0 leading-none text-2xl text-muted-foreground">
                            <a href="/settings/profile/" class="flex flex-row justify-between items-center py-4 w-full no-underline">
                                <div class="flex flex-row gap-3 items-center">
                                    <User size={24} class="shrink-0"/>
                                    <span>{$t("settings.editProfile")}</span>
                                </div>
                                <ChevronRight size={24} class="icon-right"/>
                            </a>
                        </li>
                        <li class="p-0 m-0 leading-none text-2xl text-muted-foreground">
                            <a href="/settings/nostr-keys/" class="flex flex-row justify-between items-center py-4 w-full no-underlinerow-button">
                                <div class="flex flex-row gap-3 items-center">
                                    <Password size={24} class="shrink-0"/>
                                    <span>{$t("settings.nostrKeys")}</span>
                                </div>
                                <ChevronRight size={24} class="icon-right"/>
                            </a>
                        </li>
                        <li class="p-0 m-0 leading-none text-2xl text-muted-foreground">
                            <a href="/settings/network/" class="flex flex-row justify-between items-center py-4 w-full no-underline">
                                <div class="flex flex-row gap-3 items-center">
                                    <Satellite size={24} class="shrink-0"/>
                                    <span>{$t("settings.network")}</span>
                                </div>
                                <ChevronRight size={24} class="icon-right"/>
                            </a>
                        </li>
                        <li class="p-0 m-0 leading-none text-2xl text-muted-foreground">
                            <a href="/settings/wallet/" class="flex flex-row justify-between items-center py-4 w-full no-underline">
                                <div class="flex flex-row gap-3 items-center">
                                    <Wallet size={24} class="shrink-0"/>
                                    <span>{$t("settings.wallet")}</span>
                                </div>
                                <ChevronRight size={24} class="icon-right"/>
                            </a>
                        </li>
                        <li class="p-0 m-0 leading-none text-2xl text-muted-foreground">
                            <ConfirmSheet
                                bind:open={showLogoutConfirmSheet}
                                title={$t("settings.signOutTitle")}
                                description={$t("settings.signOutDescription")}
                                acceptText={$t("settings.signOut")}
                                cancelText={$t("shared.cancel")}
                                acceptFn={() => handleLogout($activeAccount!.pubkey)}
                            >
                                <button class="flex flex-row justify-between items-center py-4 w-full no-underline">
                                    <div class="flex flex-row gap-3 items-center">
                                        <Logout size={24} class="shrink-0"/>
                                    <span>{$t("settings.signOut")}</span>
                                    </div>
                                </button>
                            </ConfirmSheet>
                        </li>
                    </ul>
                </div>
            </Accordion.Content>
        </Accordion.Item>
        <Accordion.Item value="privacy">
            <Accordion.Trigger>
                <h2 class="text-3xl font-normal text-primary leading-none">
                    {$t("settings.privacyAndSecurity")}
                </h2>
            </Accordion.Trigger>
            <Accordion.Content>
                <div class="overflow-hidden p-0 m-0">
                    <ul class="list-none p-0 m-0 overflow-hidden">
                        <li class="p-0 m-0 leading-none text-2xl text-muted-foreground">
                            <ConfirmSheet
                                bind:open={showDeleteAllConfirmSheet}
                                title={$t("settings.deleteAllDataTitle")}
                                description={$t("settings.deleteAllDataDescription")}
                                acceptText={$t("settings.deleteAllData")}
                                cancelText={$t("shared.cancel")}
                                acceptFn={deleteAll}
                            >
                                <button class="flex flex-row justify-between items-center py-4 w-full no-underline">
                                    <div class="flex flex-row gap-3 items-center">
                                        <TrashCan size={24} class="shrink-0"/>
                                        <span>{$t("settings.deleteAllData")}</span>
                                    </div>
                                </button>
                            </ConfirmSheet>
                        </li>
                    </ul>
                </div>
            </Accordion.Content>
        </Accordion.Item>
        <Accordion.Item value="developer">
            <Accordion.Trigger>
                <h2 class="text-3xl font-normal text-primary leading-none">
                    {$t("settings.developerSettings")}
                </h2>
            </Accordion.Trigger>
            <Accordion.Content>
                <div class="overflow-hidden p-0 m-0">
                    <ul class="list-none p-0 m-0 overflow-hidden">
                        <li class="p-0 m-0 leading-none text-2xl text-muted-foreground">
                            <ConfirmSheet
                                bind:open={showPublishKeyPackageConfirmSheet}
                                title={$t("settings.publishKeyPackage")}
                                description={$t("settings.publishKeyPackageDescription")}
                                acceptText={$t("settings.publishKeyPackage")}
                                cancelText={$t("shared.cancel")}
                                acceptFn={publishKeyPackage}
                            >
                                <button class="flex flex-row justify-between items-center py-4 w-full no-underline">
                                    <div class="flex flex-row gap-3 items-center">
                                        <Password size={24} class="shrink-0"/>
                                        <span>{$t("settings.publishAKeyPackage")}</span>
                                    </div>
                                </button>
                            </ConfirmSheet>
                        </li>
                        <li class="p-0 m-0 leading-none text-2xl text-muted-foreground">
                            <ConfirmSheet
                                bind:open={showDeleteAllKeyPackagesConfirmSheet}
                                title={$t("settings.deleteAllKeyPackages")}
                                description={$t("settings.deleteAllKeyPackagesDescription")}
                                acceptText={$t("settings.deleteAllKeyPackages")}
                                cancelText={$t("shared.cancel")}
                                acceptFn={deleteAllKeyPackages}
                            >
                                <button class="flex flex-row justify-between items-center py-4 w-full no-underline">
                                    <div class="flex flex-row gap-3 items-center">
                                        <TrashCan size={24} class="shrink-0"/>
                                        <span>{$t("settings.deleteAllKeyPackages")}</span>
                                    </div>
                                </button>
                            </ConfirmSheet>
                        </li>
                        <li class="p-0 m-0 leading-none text-2xl text-muted-foreground">
                            <button onclick={testNotification} class="flex flex-row justify-between items-center py-4 w-full no-underline">
                                <div class="flex flex-row gap-3 items-center">
                                    <Notification size={24} class="shrink-0"/>
                                    <span>{$t("settings.testNotifications")}</span>
                                </div>
                            </button>
                        </li>
                        <li class="p-0 m-0 leading-none text-2xl text-muted-foreground">
                            <button
                                onclick={() => toast.success($t("settings.toastSuccess"))}
                                class="flex flex-row justify-between items-center py-4 w-full no-underline"
                            >
                                <div class="flex flex-row gap-3 items-center">
                                    <Notification size={24} class="shrink-0"/>
                                    <span>{$t("settings.testToastSuccess")}</span>
                                </div>
                            </button>
                        </li>
                        <li class="p-0 m-0 leading-none text-2xl text-muted-foreground">
                            <button onclick={() => toast.error($t("settings.toastError"))} class="flex flex-row justify-between items-center py-4 w-full no-underline">
                                <div class="flex flex-row gap-3 items-center">
                                    <Notification size={24} class="shrink-0"/>
                                    <span>{$t("settings.testToastError")}</span>
                                </div>
                            </button>
                        </li>
                    </ul>
                </div>
            </Accordion.Content>
        </Accordion.Item>
    </Accordion.Root>
</main>
