<script setup lang="ts">
import {onMounted, ref} from "vue";

definePageMeta({middleware: "auth"});
const {t} = useI18n();
const {resolve} = useLocalizedApiError();
const notification = useNotification();
useHead({title: computed(() => t("oauthAuthorize.title"))});

type AuthorizationDetails = {
    clientId: string;
    scope: string;
    user: {username: string; displayName: string};
};

const details = ref<AuthorizationDetails | null>(null);
const queryString = ref("");
const loading = ref(true);
const acting = ref(false);
const errorMsg = ref("");

async function loadDetails(): Promise<void> {
    loading.value = true;
    errorMsg.value = "";
    try {
        const response = await fetch(`/api/v1/oauth/authorize${queryString.value}`, {
            credentials: "same-origin",
            headers: {Accept: "application/json"},
        });
        if (!response.ok) {
            throw await response.json();
        }
        details.value = await response.json() as AuthorizationDetails;
    } catch (error) {
        errorMsg.value = resolve(error, "oauthAuthorize.loadFailed");
    } finally {
        loading.value = false;
    }
}

async function decide(allowed: boolean): Promise<void> {
    acting.value = true;
    errorMsg.value = "";
    try {
        const response = await fetch(`/api/v1/oauth/authorize${queryString.value}`, {
            method: "POST",
            credentials: "same-origin",
            headers: {Accept: "application/json", "Content-Type": "application/json"},
            body: JSON.stringify({allowed}),
            redirect: "manual",
        });
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
            window.location.assign(location);
            return;
        }
        if (!response.ok) {
            throw await response.json();
        }
        throw new Error("OAuth authorization did not redirect");
    } catch (error) {
        notification.error(resolve(error, "oauthAuthorize.actionFailed"));
    } finally {
        acting.value = false;
    }
}

onMounted(() => {
    queryString.value = window.location.search;
    void loadDetails();
});
</script>

<template>
    <section class="mx-auto flex w-full max-w-xl flex-col gap-5">
        <div class="flex flex-col gap-1">
            <h1 class="text-xl font-semibold text-[var(--text-main)]">{{ t("oauthAuthorize.title") }}</h1>
            <p class="text-sm text-[var(--text-muted)]">{{ t("oauthAuthorize.description") }}</p>
        </div>
        <Panel v-if="loading" class="text-sm text-[var(--text-muted)]">{{ t("oauthAuthorize.loading") }}</Panel>
        <Panel v-else-if="details" class="flex flex-col gap-4">
            <div class="flex items-center gap-3 rounded-lg border border-[var(--border-color)] p-3">
                <span class="i-lucide-shield-check h-6 w-6 text-[var(--accent-main)]"></span>
                <div>
                    <p class="font-medium text-[var(--text-main)]">{{ details.clientId }}</p>
                    <p class="text-sm text-[var(--text-muted)]">{{ t("oauthAuthorize.profileScope") }}</p>
                </div>
            </div>
            <p class="text-sm text-[var(--text-muted)]">
                {{ t("oauthAuthorize.account", {username: details.user.username, displayName: details.user.displayName}) }}
            </p>
            <p v-if="errorMsg" role="alert" class="text-sm text-[var(--status-danger)]">{{ errorMsg }}</p>
            <div class="flex items-center justify-end gap-2">
                <Button variant="subtle" :disabled="acting" @click="decide(false)">{{ t("oauthAuthorize.deny") }}</Button>
                <Button :loading="acting" @click="decide(true)">{{ t("oauthAuthorize.approve") }}</Button>
            </div>
        </Panel>
        <Panel v-else class="text-sm text-[var(--status-danger)]" role="alert">{{ errorMsg }}</Panel>
    </section>
</template>
