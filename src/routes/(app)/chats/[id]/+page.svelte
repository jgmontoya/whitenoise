<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { getToastState } from "$lib/stores/toast-state.svelte";
import GroupAvatar from "$lib/components/GroupAvatar.svelte";
import HeaderToolbar from "$lib/components/HeaderToolbar.svelte";
import MessageBar from "$lib/components/MessageBar.svelte";
import RepliedTo from "$lib/components/RepliedTo.svelte";
import {
    activeAccount,
    hasNostrWalletConnectUri,
    NostrWalletConnectError,
} from "$lib/stores/accounts";
import {
    type EnrichedContact,
    type NEvent,
    type NostrMlsGroup,
    NostrMlsGroupType,
    type NostrMlsGroupWithRelays,
} from "$lib/types/nostr";
import { hexMlsGroupId } from "$lib/utils/group";
import { nameFromMetadata } from "$lib/utils/nostr";
import { formatMessageTime } from "$lib/utils/time";
import { copyToClipboard } from "$lib/utils/clipboard";
import { messageHasDeletionTag } from "$lib/utils/message";
import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
    ArrowBendUpLeft,
    CaretLeft,
    CheckCircle,
    CircleDashed,
    CopySimple,
    DotsThree,
    TrashSimple,
} from "phosphor-svelte";
import { onDestroy, onMount, tick } from "svelte";
import { type PressCustomEvent, press } from "svelte-gestures";
import { toDataURL } from "qrcode";

let unlistenMlsMessageReceived: UnlistenFn;
let unlistenMlsMessageProcessed: UnlistenFn;

let group: NostrMlsGroup | undefined = $state(undefined);
let counterpartyPubkey: string | undefined = $state(undefined);
let enrichedCounterparty: EnrichedContact | undefined = $state(undefined);
let groupName = $state("");
let messages: NEvent[] = $state([]);
let showMessageMenu = $state(false);
let selectedMessageId: string | null | undefined = $state(undefined);
let isSelectedMessageBolt11: boolean | null | undefined = $state(false);
let messageMenuPosition = $state({ x: 0, y: 0 });
let messageMenuExtendedPosition = $state({ x: 0, y: 0 });
let replyToMessageEvent: NEvent | undefined = $state(undefined);
let toastState = getToastState();
let accountHasNostrWalletConnectUri: boolean | undefined = $state(undefined);

$effect(() => {
    if (
        group &&
        group.group_type === NostrMlsGroupType.DirectMessage &&
        counterpartyPubkey &&
        enrichedCounterparty
    ) {
        groupName = nameFromMetadata(enrichedCounterparty.metadata, counterpartyPubkey);
    } else if (group) {
        groupName = group.name;
    }
});

async function loadGroup() {
    invoke("get_group_and_messages", { groupId: page.params.id }).then(async (groupResponse) => {
        [group, messages] = groupResponse as [NostrMlsGroup, NEvent[]];
        if (!counterpartyPubkey) {
            counterpartyPubkey =
                group.group_type === NostrMlsGroupType.DirectMessage
                    ? group.admin_pubkeys.filter((pubkey) => pubkey !== $activeAccount?.pubkey)[0]
                    : undefined;
        }
        if (counterpartyPubkey) {
            invoke("query_enriched_contact", {
                pubkey: counterpartyPubkey,
                updateAccount: false,
            }).then((value) => {
                enrichedCounterparty = value as EnrichedContact;
            });
        }
        await scrollToBottom();
    });
}

async function scrollToBottom() {
    await tick();
    const messagesContainer = document.getElementById("messagesContainer");
    const screenHeight = window.innerHeight;
    if (messagesContainer && screenHeight < messagesContainer.scrollHeight) {
        const lastMessage = messagesContainer.lastElementChild;
        lastMessage?.scrollIntoView({ behavior: "instant" });
    }
    if (messagesContainer) {
        messagesContainer.style.opacity = "1";
    }
}

async function checkWalletStatus() {
    try {
        accountHasNostrWalletConnectUri = await hasNostrWalletConnectUri();
    } catch (e) {
        if (e instanceof NostrWalletConnectError) {
            console.error(e);
        }
    }
}

onMount(async () => {
    if (!unlistenMlsMessageProcessed) {
        unlistenMlsMessageProcessed = await listen<[NostrMlsGroup, NEvent]>(
            "mls_message_processed",
            ({ payload: [_updatedGroup, message] }) => {
                console.log("mls_message_processed event received", message.content);
                if (!messages.some((m) => m.id === message.id)) {
                    console.log("pushing message to transcript");
                    messages = [...messages, message].sort((a, b) => a.created_at - b.created_at);
                }
                scrollToBottom();
            }
        );
    }

    if (!unlistenMlsMessageReceived) {
        unlistenMlsMessageReceived = await listen<NEvent>(
            "mls_message_received",
            ({ payload: _message }) => {
                console.log("mls_message_received event received");
                loadGroup();
            }
        );
    }

    await checkWalletStatus();
    await loadGroup();
});

function handleNewMessage(message: NEvent, replaceTemp: boolean) {
    if (replaceTemp) {
        messages = messages.filter((event) => event.id !== "temp");
    }
    messages = [...messages, message].sort((a, b) => a.created_at - b.created_at);
    scrollToBottom();
}

function findQTagReplyTo(message: NEvent): string | undefined {
    return message.tags.find((t) => t[0] === "q")?.[1];
}

function doesMessageHaveQTag(message: NEvent): boolean {
    return findQTagReplyTo(message) !== undefined;
}

function findPreimageTagReplyTo(message: NEvent): string | undefined {
    return message.tags.find((t) => t[0] === "preimage")?.[1];
}

function doesMessageHavePreimageTag(message: NEvent): boolean {
    return findPreimageTagReplyTo(message) !== undefined;
}

function findBolt11Tag(message: NEvent): string | undefined {
    return message.tags.find((t) => t[0] === "bolt11")?.[1];
}

function doesMessageHaveBolt11Tag(message: NEvent): boolean {
    return findBolt11Tag(message) !== undefined;
}

function isMessageDeleted(message: NEvent): boolean {
    return messageHasDeletionTag(message.id, messages);
}

function handlePress(event: PressCustomEvent | MouseEvent) {
    const target = event.target as HTMLElement;
    const messageContainer = target.closest("[data-message-container]");
    const messageId = messageContainer?.getAttribute("data-message-id");
    const isCurrentUser = messageContainer?.getAttribute("data-is-current-user") === "true";
    selectedMessageId = messageId;
    const message = messages.find((m) => m.id === messageId);
    if (message) {
        isSelectedMessageBolt11 = doesMessageHaveBolt11Tag(message);
    }
    const messageBubble = messageContainer?.parentElement?.querySelector(
        "[data-message-container]:not(button)"
    );
    const rect = messageBubble?.getBoundingClientRect() || target.getBoundingClientRect();

    // Temporarily make menus visible but with measuring class
    const reactionMenu = document.getElementById("messageMenu");
    const extendedMenu = document.getElementById("messageMenuExtended");
    if (reactionMenu) reactionMenu.classList.replace("invisible", "visible");
    if (extendedMenu) extendedMenu.classList.replace("invisible", "visible");

    // Add measuring class
    if (reactionMenu) reactionMenu.classList.add("measuring");
    if (extendedMenu) extendedMenu.classList.add("measuring");

    // Use setTimeout to ensure the menus are rendered before measuring
    setTimeout(() => {
        const reactionMenuWidth = reactionMenu?.getBoundingClientRect().width || 0;
        const extendedMenuWidth = extendedMenu?.getBoundingClientRect().width || 0;

        // Remove measuring class
        if (reactionMenu) reactionMenu.classList.remove("measuring");
        if (extendedMenu) extendedMenu.classList.remove("measuring");

        // Calculate viewport-relative positions
        const viewportX = isCurrentUser ? rect.right - reactionMenuWidth : rect.left;
        const viewportY = rect.top - 60;

        messageMenuPosition = {
            x: viewportX,
            y: viewportY,
        };

        messageMenuExtendedPosition = {
            x: isCurrentUser ? rect.right - extendedMenuWidth : rect.left,
            y: rect.bottom + 10,
        };

        showMessageMenu = true;

        // Apply animation to the message bubble
        if (messageBubble instanceof HTMLElement) {
            messageBubble.style.transform = "scale(1.10)";
            messageBubble.style.transformOrigin = isCurrentUser ? "right" : "left";
            messageBubble.style.transition = "transform 0.10s ease-out";

            setTimeout(() => {
                messageBubble.style.transform = "scale(1)";
            }, 100);

            messageBubble.addEventListener(
                "pointerup",
                () => {
                    messageBubble.style.transform = "scale(1)";
                },
                { once: true }
            );
        }
    }, 0);
}

function handleOutsideClick() {
    showMessageMenu = false;
    selectedMessageId = undefined;
    isSelectedMessageBolt11 = undefined;
}

async function sendReaction(reaction: string, messageId: string | null | undefined) {
    if (!group) {
        console.error("no group found");
        return;
    }
    if (!messageId) {
        console.error("no message selected");
        return;
    }
    const message = messages.find((m) => m.id === messageId);
    if (!message) {
        console.error("message not found");
        return;
    }

    // Filter out tags that are not "e" or "p" (or invalid)
    let tags = message.tags.filter((t) => t.length >= 2 && (t[0] === "e" || t[0] === "p"));
    // Now add our own tags for the reaction
    tags = [...tags, ["e", messageId], ["p", message.pubkey], ["k", message.kind.toString()]];

    console.log("Sending reaction", reaction);
    invoke("send_mls_message", {
        group,
        message: reaction,
        kind: 7,
        tags: tags,
    })
        .then((reactionEvent) => {
            console.log("reaction sent", reactionEvent);
            handleNewMessage(reactionEvent as NEvent, false);
        })
        .finally(() => {
            showMessageMenu = false;
        });
}

async function copyMessage() {
    const message = messages.find((m) => m.id === selectedMessageId);
    if (message) {
        await writeText(message.content);
        const button = document.querySelector("[data-copy-button]");
        button?.classList.add("copy-success");
        setTimeout(() => {
            button?.classList.remove("copy-success");
            showMessageMenu = false;
        }, 1000);
    }
}

async function payInvoice(message: NEvent) {
    if (!group) {
        console.error("no group found");
        return;
    }

    if (!doesMessageHaveBolt11Tag(message)) {
        console.error("message is not a bolt11 invoice");
        return;
    }

    if (!accountHasNostrWalletConnectUri) {
        console.error("Nostr Wallet Connect URI not found");
        return;
    }
    let groupWithRelays: NostrMlsGroupWithRelays = await invoke("get_group", {
        groupId: hexMlsGroupId(group.mls_group_id),
    });
    const invoice = findBolt11Tag(message);
    let tags = [["q", message.id, groupWithRelays.relays[0], message.pubkey]];
    console.log("Sending payment", tags);
    invoke("pay_invoice", {
        group,
        tags: tags,
        bolt11: invoice,
    })
        .then(
            (reactionEvent) => {
                console.log("reaction sent", reactionEvent);
                toastState.add(
                    "Payment success",
                    "Successfully sent payment to invoice",
                    "success"
                );
                handleNewMessage(reactionEvent as NEvent, false);
            },
            (e) => {
                toastState.add(
                    "Error sending payment",
                    `Failed to send payment: ${e.message}`,
                    "error"
                );
                console.error("Error sending payment", e);
            }
        )
        .finally(() => {
            showMessageMenu = false;
        });
}

async function copyInvoice(messageId: string) {
    const invoice = invoiceDataMap.get(messageId)?.invoice;
    if (invoice) await copyToClipboard(invoice, "bolt11 invoice");
}

function replyToMessage() {
    replyToMessageEvent = messages.find((m) => m.id === selectedMessageId);
    document.getElementById("newMessageInput")?.focus();
    showMessageMenu = false;
}

function editMessage() {
    console.log("editing message");
}

function deleteMessage() {
    const message = messages.find((m) => m.id === selectedMessageId);
    if (!message) {
        console.error("message not found");
        toastState.add("Error", "Message not found", "error");
        return;
    }

    if (message.pubkey !== $activeAccount?.pubkey) {
        console.error("message is not owned by the current user");
        toastState.add("Error", "You can only delete your own messages", "error");
        return;
    }

    invoke<NEvent>("delete_message", {
        group,
        messageId: message.id,
    })
        .then((deletionEvent) => {
            console.log("message deleted", deletionEvent);
            // Add the deletion event to the messages array to trigger re-rendering
            if (deletionEvent) {
                handleNewMessage(deletionEvent as NEvent, false);
            }
            showMessageMenu = false;
        })
        .catch((e) => {
            console.error("error deleting message", e);
            toastState.add("Error Deleting Message", `Failed to delete message: ${e}`, "error");
        });
}

function isSingleEmoji(str: string) {
    const trimmed = str.trim();
    // This regex matches a single emoji (including compound emojis like 👨‍👩‍👧‍👦 or 👨🏻‍💻)
    const emojiRegex =
        /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\p{Emoji_Modifier}*(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\p{Emoji_Modifier}*)*$/u;
    return emojiRegex.test(trimmed);
}

function reactionsForMessage(message: NEvent): { content: string; count: number }[] {
    const reactions = messages.filter(
        (m) => m.kind === 7 && m.tags.some((t) => t[0] === "e" && t[1] === message.id)
    );
    return reactions.reduce(
        (acc, reaction) => {
            const existingReaction = acc.find((r) => r.content === reaction.content);
            if (existingReaction) {
                existingReaction.count++;
            } else {
                acc.push({ content: reaction.content, count: 1 });
            }
            return acc;
        },
        [] as { content: string; count: number }[]
    );
}

function isBolt11Paid(message: NEvent): boolean {
    const replies = messages.filter(
        (m) =>
            m.kind === 9 &&
            m.tags.some((t) => t[0] === "q" && t[1] === message.id) &&
            m.tags.some((t) => t[0] === "preimage")
    );
    return replies.length > 0;
}

type InvoiceData = { invoice: string; amount: number; description?: string; qrCodeUrl?: string };
let invoiceDataMap = $state(new Map<string, InvoiceData>());

$effect(() => {
    computeInvoices();
});

async function computeInvoices() {
    const newMap = new Map<string, InvoiceData>();

    await Promise.all(
        messages.map(async (message) => {
            const bolt11Tag = message.tags.find((t) => t[0] === "bolt11");
            if (bolt11Tag) {
                const invoice = bolt11Tag[1];
                const amount = Number(bolt11Tag[2] || 0) / 1000;
                let invoiceData: InvoiceData = { invoice, amount };
                if (bolt11Tag[3]) {
                    invoiceData.description = bolt11Tag[3];
                }
                try {
                    const qrCodeUrl = await toDataURL(`lightning:${bolt11Tag[1]}`);
                    invoiceData.qrCodeUrl = qrCodeUrl;
                } catch (error) {
                    console.error("Error generating QR code:", error);
                }

                newMap.set(message.id, invoiceData);
            }
        })
    );

    invoiceDataMap = newMap;
}

function contentToShow(message: NEvent) {
    const bolt11_tag = findBolt11Tag(message);
    if (!bolt11_tag) {
        return message.content;
    }

    const invoice = bolt11_tag;
    const firstPart = invoice.substring(0, 15);
    const lastPart = invoice.substring(invoice.length - 15);
    return message.content.replace(invoice, `${firstPart}...${lastPart}`);
}

function isMyMessage(message: NEvent) {
    return message.pubkey === $activeAccount?.pubkey;
}

function isSelectedMessageDeletable(): boolean {
    const selectedMessage = messages.find((m) => m.id === selectedMessageId);
    if (!selectedMessage) {
        return false;
    }

    if (doesMessageHavePreimageTag(selectedMessage)) {
        return false;
    }

    if (isMessageDeleted(selectedMessage)) {
        return false;
    }

    return isMyMessage(selectedMessage);
}

function isSelectedMessageCopyable(): boolean {
    const selectedMessage = messages.find((m) => m.id === selectedMessageId);
    if (!selectedMessage) {
        return false;
    }

    return !isMessageDeleted(selectedMessage);
}

onDestroy(() => {
    unlistenMlsMessageProcessed();
    unlistenMlsMessageReceived();
    toastState.cleanup();
});
</script>

{#if group}
    <HeaderToolbar alwaysShowCenter={true}>
        {#snippet center()}
            <a href={`/chats/${hexMlsGroupId(group!.mls_group_id)}/info`} class="flex flex-row items-center gap-2">
                <GroupAvatar
                    groupType={group!.group_type}
                    {groupName}
                    {counterpartyPubkey}
                    {enrichedCounterparty}
                    pxSize={30}
                />
                {groupName}
            </a>
        {/snippet}
        {#snippet left()}
            <button onclick={() => goto(`/chats`)} class="p-2 -mr-2">
                <CaretLeft size={30} />
            </button>
        {/snippet}
    </HeaderToolbar>

    <main id="mainContainer" class="flex flex-col relative min-h-dvh">
        <div
            id="messagesContainer"
            class="flex-1 px-8 flex flex-col gap-2 pt-10 pb-40 overflow-y-auto opacity-100 transition-opacity ease-in-out duration-50"
        >
            {#each messages as message (message.id)}
                {#if message.kind === 9}
                    <div
                        class={`flex justify-end ${isMyMessage(message) ? "" : "flex-row-reverse"} items-center gap-4 group ${reactionsForMessage(message).length > 0 ? "mb-6" : ""}`}
                    >
                        <button
                            onclick={handlePress}
                            data-message-container
                            data-message-id={message.id}
                            data-is-current-user={isMyMessage(message)}
                            class="p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                        >
                            <DotsThree size="24" weight="bold" />
                        </button>
                        <div
                            use:press={()=>({ triggerBeforeFinished: true, timeframe: 300 })}
                            onpress={handlePress}
                            data-message-container
                            data-message-id={message.id}
                            data-is-current-user={isMyMessage(message)}
                            class={`relative max-w-[70%] ${doesMessageHavePreimageTag(message) ? "bg-opacity-10" : ""} ${!isSingleEmoji(message.content) ? `rounded-lg ${isMyMessage(message) ? `bg-chat-bg-me text-gray-50 rounded-br` : `bg-chat-bg-other text-gray-50 rounded-bl`} p-3` : ''} ${showMessageMenu && message.id === selectedMessageId ? 'relative z-20' : ''}`}
                        >
                            {#if doesMessageHaveQTag(message)}
                                <RepliedTo messageId={findQTagReplyTo(message)} messages={messages} />
                            {/if}
                            <div class="flex {message.content.trim().length < 50 && !isSingleEmoji(message.content) ? "flex-row gap-6" : "flex-col gap-2"} w-full {doesMessageHavePreimageTag(message) ? "items-center justify-center" : "items-end"}  {isSingleEmoji(message.content) ? 'mb-4 my-6' : ''}">
                                <div class="break-words-smart w-full {doesMessageHavePreimageTag(message) ? 'flex justify-center' : ''} {isSingleEmoji(message.content) ? 'text-7xl leading-none' : ''}">
                                    {#if isMessageDeleted(message)}
                                        <div class="inline-flex flex-row items-center gap-2 bg-gray-200 rounded-full px-3 py-1 w-fit text-black">
                                            <TrashSimple size={20} /><span class="italic opacity-60">Message deleted</span>
                                        </div>
                                    {:else if message.content.trim().length > 0}
                                        {contentToShow(message)}
                                    {:else if doesMessageHavePreimageTag(message)}
                                        <div class="inline-flex flex-row items-center gap-2 bg-orange-400 rounded-full px-2 py-0 w-fit">
                                            <span>⚡️</span><span class="italic font-bold">Invoice paid</span><span>⚡️</span>
                                        </div>
                                    {:else}
                                        <span class="italic opacity-60">No message content</span>
                                    {/if}
                                    {#if invoiceDataMap.has(message.id)}
                                        <div class="flex flex-col items-start mt-4 gap-4">
                                            <div class="relative bg-slate-200 p-1 rounded-lg">
                                                <img
                                                    src={invoiceDataMap.get(message.id)?.qrCodeUrl}
                                                    alt="QR Code"
                                                    class="w-64 h-64 rounded-lg shadow-lg {isBolt11Paid(message) ? 'blur-sm' : ''}"
                                                />
                                                {#if invoiceDataMap.get(message.id)?.description}
                                                    <span class="text-sm text-blue-900 mx-1">{invoiceDataMap.get(message.id)?.description}</span>
                                                {/if}
                                                {#if isBolt11Paid(message)}
                                                    <CheckCircle
                                                        size={48}
                                                        weight="fill"
                                                        class="text-green-500 bg-white rounded-full opacity-80 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" 
                                                    />
                                                {/if}
                                            </div>
                                            <div class="flex flex-col gap-4">
                                                <button
                                                    onclick={() => copyInvoice(message.id)}
                                                    class={`transition-all hover:shadow-xl duration-300 rounded-md px-6 py-2 flex flex-row gap-4 items-center justify-center font-semibold grow ${isMyMessage(message) ? "bg-gray-200 hover:bg-gray-300 text-blue-600" : "bg-blue-500 hover:bg-blue-600"}`}
                                                >
                                                   Copy invoice  <CopySimple size={20} />
                                                </button>
                                                {#if accountHasNostrWalletConnectUri && !isBolt11Paid(message)}
                                                    <button
                                                        onclick={() => payInvoice(message)}
                                                        class="transition-all bg-gradient-to-bl from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-500  hover:shadow-xl duration-300 rounded-md px-6 py-2 flex flex-row gap-4 items-center justify-center font-semibold grow"
                                                    >
                                                    Pay {invoiceDataMap.get(message.id)?.amount} sats
                                                    </button>
                                                {/if}
                                            </div>
                                        </div>
                                    {/if}
                                </div>
                                <div class="flex flex-row gap-2 items-center ml-auto {isMyMessage(message) ? "text-gray-300" : "text-gray-400"}">
                                    {#if message.id !== "temp"}
                                        <span><CheckCircle size={18} weight="light" /></span>
                                    {:else}
                                        <span><CircleDashed size={18} weight="light" class="animate-spin-slow"/></span>
                                    {/if}
                                    <span class="text-sm opacity-60 whitespace-nowrap">
                                        {formatMessageTime(message.created_at)}
                                    </span>
                                </div>
                            </div>
                            <div class="reactions flex flex-row gap-2 absolute -bottom-6 right-0">
                                {#each reactionsForMessage(message) as reaction}
                                    <button onclick={() => sendReaction(reaction.content, message.id)} class="py-1 px-2 bg-gray-900 rounded-full flex flex-row gap-1 items-center">
                                        {reaction.content}
                                        {#if reaction.count > 1}
                                            <span class="text-sm opacity-60">{reaction.count}</span>
                                        {/if}
                                    </button>
                                {/each}
                            </div>
                        </div>
                    </div>
                {/if}
            {/each}
        </div>
        <MessageBar {group} bind:replyToMessageEvent={replyToMessageEvent} {handleNewMessage} {messages} />
    </main>
{/if}

{#if showMessageMenu}
    <button
        type="button"
        class="fixed inset-0 backdrop-blur-sm z-10"
        onclick={handleOutsideClick}
        onkeydown={(e) => e.key === 'Escape' && handleOutsideClick()}
        aria-label="Close message menu"
    ></button>
{/if}

<div
    id="messageMenu"
    class="{showMessageMenu ? 'visible' : 'invisible'} fixed bg-gray-900/90 backdrop-blur-sm drop-shadow-md drop-shadow-black py-1 px-2 rounded-full ring-1 ring-gray-700 z-30 translate-x-0"
    style="left: {messageMenuPosition.x}px; top: {messageMenuPosition.y}px;"
    role="menu"
>
    <div class="flex flex-row gap-3 text-xl">
        <button onclick={() => sendReaction("❤️", selectedMessageId)} class="p-3">❤️</button>
        <button onclick={() => sendReaction("👍", selectedMessageId)} class="p-3">👍</button>
        <button onclick={() => sendReaction("👎", selectedMessageId)} class="p-3">👎</button>
        <button onclick={() => sendReaction("😂", selectedMessageId)} class="p-3">😂</button>
        <button onclick={() => sendReaction("🤔", selectedMessageId)} class="p-3">🤔</button>
        <button onclick={() => sendReaction("🤙", selectedMessageId)} class="p-3">🤙</button>
        <button onclick={() => sendReaction("😥", selectedMessageId)} class="p-3">😥</button>
    </div>
</div>

<div
    id="messageMenuExtended"
    class="{showMessageMenu ? 'opacity-100 visible' : 'opacity-0 invisible'} fixed bg-gray-900/90 backdrop-blur-sm drop-shadow-md drop-shadow-black rounded-md ring-1 ring-gray-700 z-30 translate-x-0 transition-opacity duration-200"
    style="left: {messageMenuExtendedPosition.x}px; top: {messageMenuExtendedPosition.y}px;"
    role="menu"
>
    <div class="flex flex-col justify-start items-between divide-y divide-gray-800">
        {#if isSelectedMessageCopyable()}
            <button data-copy-button onclick={copyMessage} class="px-4 py-2 flex flex-row gap-20 items-center justify-between hover:bg-gray-700">Copy <CopySimple size={20} /></button>
        {/if}
        <button onclick={replyToMessage} class="px-4 py-2 flex flex-row gap-20 items-center justify-between hover:bg-gray-700">Reply <ArrowBendUpLeft size={20} /></button>
        <!-- <button onclick={editMessage} class="px-4 py-2 flex flex-row gap-20 items-center justify-between">Edit <PencilSimple size={20} /></button> -->
        {#if isSelectedMessageDeletable()}
            <button onclick={deleteMessage} class="text-red-500 px-4 py-2 flex flex-row gap-20 items-center justify-between hover:bg-red-200">Delete <TrashSimple size={20} /></button>
        {/if}
    </div>
</div>

<style>
    .measuring {
        position: fixed !important;
        visibility: hidden !important;
        top: -9999px !important;
        left: -9999px !important;
    }

    .copy-success {
        color: rgb(34 197 94); /* text-green-500 */
        transition: color 0.2s ease-in-out;
    }

    .glow-button {
        position: relative;
        color: #fff;
        transition: all 0.3s ease;
        background: rgba(173, 0, 255, 0.1);
    }

    .glow-button::before {
        content: '';
        position: absolute;
        inset: -1px;
        background: linear-gradient(90deg, #f97316 0%, #ea580c 100%);
        z-index: -1;
        opacity: 0.15;
        filter: blur(8px);
        border-radius: 0.375rem;
    }

    .glow-button:hover {
        background: rgba(21, 132, 79, 0.2);
    }

    /* Ensure immediate visibility state change */
    .invisible {
        display: none;
    }
</style>
