import { i18n } from "@/i18n";

export const runSplitAction = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    console.error("[Timeline] Failed to split clip", error);
    window.alert(i18n.global.t("menus.splitFailed"));
  }
};
