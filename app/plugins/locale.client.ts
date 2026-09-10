import {
  applyLocaleIfNeeded,
  getClientLocaleStorage,
  resolveInitialLocale,
} from "~/utils/locale";

export default defineNuxtPlugin({
  name: "site-locale",
  dependsOn: ["i18n:plugin:route-locale-detect"],
  setup(nuxtApp) {
    const locale = nuxtApp.$i18n.locale;
    const targetLocale = resolveInitialLocale({
      path: nuxtApp.$router.currentRoute.value.path,
      storage: getClientLocaleStorage(),
      navigator: window.navigator,
    });

    // Messages are bundled eagerly, so setting the runtime locale here avoids
    // an automatic route redirect and finishes before the SPA is mounted.
    applyLocaleIfNeeded(locale.value, targetLocale, (nextLocale) => {
      locale.value = nextLocale;
    });
  },
});
