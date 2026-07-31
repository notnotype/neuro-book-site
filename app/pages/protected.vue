<script setup lang="ts">
definePageMeta({
    middleware: "auth",
});

const notification = useNotification();
const {t} = useI18n();
const {resolve} = useLocalizedApiError();
const protectedResult = ref("");

onMounted(async () => {
    try {
        const result = await $fetch<{ok: true; username: string}>("/api/protected");
        protectedResult.value = t("protectedPage.verified", {username: result.username});
    } catch (error) {
        notification.error(resolve(error, "protectedPage.verifyFailed"));
        await navigateTo("/login");
    }
});
</script>

<template>
    <main class="min-h-screen bg-[var(--bg-main)] p-6 text-[var(--text-main)]">
        <section class="mx-auto max-w-3xl space-y-4">
            <Button variant="ghost" @click="navigateTo('/')">{{ t("errorPage.home") }}</Button>
            <Panel>
                <h1 class="text-xl font-semibold">{{ t("protectedPage.title") }}</h1>
                <p class="mt-2 text-sm text-[var(--text-secondary)]">{{ t("protectedPage.description") }}</p>
                <p class="mt-4 text-sm text-[var(--accent-text)]">{{ protectedResult || t("protectedPage.verifying") }}</p>
            </Panel>
        </section>
    </main>
</template>
