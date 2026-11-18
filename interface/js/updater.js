import { tellShell } from './platform.js';
import { api, app, h, iconButton, toast } from "./core.js";
export function installUpdater(ribbon) {
  let state = {},
    stopped = false,
    timer;
  const button = iconButton(
    "download",
    "Vérifier les mises à jour Opale",
    async () => {
      try {
        if (state.phase === "ready") {
          if (app.workspace.tabs.some((tab) => tab.view.design?.busy))
            throw Error(
              "Attendez la fin des traitements avant de mettre Opale à jour.",
            );
          button.disabled = true;
          await app.workspace.flushAll();
          app.workspace.persist.flush();
          for (const tab of app.workspace.tabs)
            if (tab.view.dirty || tab.view.conflict)
              throw Error(
                "Enregistrez les documents en attente avant la mise à jour.",
              );
          await api("/api/update/apply", { method: "POST", body: {} });
          tellShell({ close: true });
          window.close();
          return;
        }
        if (!["checking", "downloading"].includes(state.phase)) {
          await api("/api/update/check", { method: "POST", body: {} });
          await poll();
          if (state.phase === "current")
            toast(state.note || "Opale est à jour.");
          if (state.phase === "error") toast(state.error, { kind: "error" });
        }
      } catch (error) {
        button.disabled = false;
        toast(error.message, { kind: "error" });
      }
    },
    ".ribbon-update",
  );
  const ring = h("span.update-ring", {
    html: '<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="update-track" cx="18" cy="18" r="16"/><circle class="update-arc" cx="18" cy="18" r="16" pathLength="100"/></svg>',
  });
  button.hidden = true;
  button.append(ring);
  ribbon.insertBefore(button, ribbon.querySelector(".ribbon-agent"));
  const poll = async () => {
    if (stopped) return;
    try {
      state = await api("/api/update");
      button.hidden =
        !state.supported || ["idle", "checking", "current"].includes(state.phase);
      button.dataset.phase = state.phase;
      button.style.setProperty("--update-progress", state.percent || 0);
      button.title =
        state.phase === "ready"
          ? "Mise à jour prête · cliquer pour installer et redémarrer"
          : state.phase === "downloading"
            ? `Téléchargement · ${state.percent} %`
            : state.phase === "checking"
              ? "Recherche de mise à jour…"
              : state.phase === "error"
                ? `Mise à jour · ${state.error}`
                : "Vérifier les mises à jour Opale";
      button.setAttribute("aria-label", button.title);
    } catch {}
  };
  poll();
  timer = setInterval(poll, 800);
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      clearInterval(timer);
    },
    { once: true },
  );
}
