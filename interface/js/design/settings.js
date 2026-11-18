import { api, app, bus, h, icon, toast } from "../core.js";
let latest, loading;
export async function loadConnections(force = false) {
  if (force || !latest) {
    if (!loading)
      loading = api("/api/design")
        .then((info) => {
          latest = info;
          bus.emit("design-connections", info);
          return info;
        })
        .finally(() => (loading = null));
    return loading;
  }
  return latest;
}
export function designSettingsPane() {
  const root = h("div.design-settings");
  root.append(
    h(
      "div.design-settings-intro",
      h("span.design-mark", { html: icon("design", 25) }),
      h(
        "div",
        h("h3", "Opal Design"),
        h(
          "p",
          "Vos modèles et vos connexions, sur cet ordinateur. Les clés restent hors des coffres et des projets partagés.",
        ),
      ),
    ),
  );
  const search = h("input.text-input", {
    type: "search",
    placeholder: "Rechercher un fournisseur ou un modèle…",
    "aria-label": "Rechercher les connexions IA",
  });
  const list = h(
    "div.design-provider-list",
    h("p.setting-note", "Chargement des connexions…"),
  );
  root.append(search, list);
  let providers = [];
  const render = () => {
    const query = search.value.toLowerCase();
    list.replaceChildren(
      ...providers
        .filter((p) =>
          `${p.label} ${p.models.map((m) => m.label).join(" ")}`
            .toLowerCase()
            .includes(query),
        )
        .map((provider) => {
          const details = h("details.design-provider");
          const summary = h(
            "summary",
            h("span.design-provider-logo", provider.label.slice(0, 2)),
            h("span.design-provider-name", provider.label),
            h(
              `span.design-provider-status${provider.connected ? ".is-connected" : ""}`,
              provider.connected
                ? "Abonnement connecté"
                : provider.keySet
                  ? "Clé enregistrée"
                  : provider.keyless
                    ? "Serveur local"
                    : "À connecter",
            ),
            h("span.design-provider-chevron", {
              html: icon("chevron-down", 14),
            }),
          );
          const body = h("div.design-provider-body");
          details.append(summary, body);
          const status = h(
            "p.setting-note",
            { role: "status" },
            `${provider.models.length} modèles · ${provider.oauth ? "Connexion par compte, comme dans zaalis IDE." : provider.local ? "Exécution sur votre serveur local." : "Connexion directe au fournisseur."}`,
          );
          const fields = h("div.design-provider-fields");
          body.append(status, fields);
          const refresh = async () => {
            latest = null;
            const info = await loadConnections(true);
            providers = info.providers;
            render();
          };
          const message = (error) => {
            status.textContent = error.message || String(error);
            status.classList.add("is-error");
          };
          if (provider.oauth) {
            const connect = h(
              "button.btn.primary",
              { type: "button" },
              provider.connected ? "Reconnecter le compte" : "Se connecter",
            );
            connect.onclick = async () => {
              connect.disabled = true;
              try {
                const flow = await api("/api/design/auth/start", {
                  method: "POST",
                  body: { provider: provider.id },
                });
                const link = h(
                  "a.btn",
                  {
                    href: flow.verificationUrl,
                    target: "_blank",
                    rel: "noopener noreferrer",
                  },
                  "Ouvrir la connexion",
                );
                const code = h("code.design-device-code", flow.userCode);
                const cancel = h("button.btn", { type: "button" }, "Annuler");
                const instructions = h(
                  "div.design-auth-flow",
                  h(
                    "p",
                    flow.userCode
                      ? "Ouvrez la connexion, puis confirmez ce code auprès du fournisseur :"
                      : "Connectez votre compte dans le navigateur, comme dans zaalis IDE.",
                  ),
                  flow.userCode ? code : null,
                  h("div.inline", link, cancel),
                );
                fields.replaceChildren(instructions);
                let cancelled = false;
                cancel.onclick = () => {
                  cancelled = true;
                  api("/api/design/auth", {
                    method: "DELETE",
                    body: { flowId: flow.flowId },
                  }).catch(() => {});
                  refresh().catch(message);
                };
                const poll = async () => {
                  if (cancelled) return;
                  if (!root.isConnected) {
                    api("/api/design/auth", {
                      method: "DELETE",
                      body: { flowId: flow.flowId },
                    }).catch(() => {});
                    return;
                  }
                  if (Date.now() > flow.expiresAt) {
                    status.textContent = "Connexion expirée. Réessayez.";
                    return;
                  }
                  try {
                    const answer = await api("/api/design/auth/poll", {
                      method: "POST",
                      body: { provider: provider.id, flowId: flow.flowId },
                    });
                    if (answer.status === "connected") {
                      toast("Compte connecté à Opal Design.");
                      await refresh();
                      return;
                    }
                  } catch (error) {
                    message(error);
                    return;
                  }
                  setTimeout(poll, (flow.interval || 3) * 1000);
                };
                setTimeout(poll, (flow.interval || 3) * 1000);
              } catch (error) {
                message(error);
              } finally {
                connect.disabled = false;
              }
            };
            fields.append(connect);
          } else {
            const key = h("input.text-input", {
              type: "password",
              autocomplete: "off",
              placeholder: provider.keySet
                ? "Clé déjà enregistrée · laisser vide pour la conserver"
                : "Clé API",
              "aria-label": `Clé ${provider.label}`,
            });
            const base = h("input.text-input", {
              value: provider.baseUrl,
              "aria-label": `Adresse ${provider.label}`,
              spellcheck: false,
            });
            const names = h("textarea.text-input", {
              rows: 3,
              value: provider.customModels.join("\n"),
              placeholder:
                "Identifiants des modèles supplémentaires, un par ligne",
              "aria-label": `Modèles ${provider.label}`,
            });
            const imageNames = h("textarea.text-input", {
              rows: 2,
              value: provider.imageModels.join("\n"),
              placeholder: "Modèles supplémentaires qui produisent des images",
              "aria-label": `Modèles image ${provider.label}`,
            });
            if (!provider.keyless)
              fields.append(h("label.design-field", h("span", "Clé API"), key));
            if (provider.editableUrl)
              fields.append(
                h("label.design-field", h("span", "Adresse du serveur"), base),
              );
            fields.append(
              h(
                "details.design-advanced",
                h("summary", "Modèles personnalisés"),
                h(
                  "div.design-advanced-body",
                  h(
                    "label.design-field",
                    h("span", "Identifiants supplémentaires"),
                    names,
                  ),
                  h(
                    "label.design-field",
                    h("span", "Modèles image supplémentaires"),
                    imageNames,
                  ),
                ),
              ),
            );
            const save = h(
              "button.btn.primary",
              { type: "button" },
              "Enregistrer la connexion",
            );
            save.onclick = async () => {
              save.disabled = true;
              save.textContent = "Enregistrement…";
              try {
                await api("/api/design/connection", {
                  method: "PUT",
                  body: {
                    provider: provider.id,
                    key: key.value,
                    baseUrl: base.value,
                    models: names.value
                      .split(/[,\n]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                    imageModels: imageNames.value
                      .split(/[,\n]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                });
                key.value = "";
                toast("Connexion enregistrée sur cet ordinateur.");
                await refresh();
              } catch (error) {
                message(error);
              } finally {
                save.disabled = false;
                save.textContent = "Enregistrer la connexion";
              }
            };
            fields.append(save);
          }
          const actions = h("div.design-provider-actions");
          if (provider.configured) {
            const discover = h(
              "button.btn",
              { type: "button" },
              "Actualiser les modèles",
            );
            discover.onclick = async () => {
              discover.disabled = true;
              try {
                await api("/api/design/models", {
                  method: "POST",
                  body: { provider: provider.id },
                });
                await refresh();
              } catch (error) {
                message(error);
              } finally {
                discover.disabled = false;
              }
            };
            actions.append(discover);
          }
          if (provider.connected || provider.keySet) {
            const remove = h("button.btn", { type: "button" }, "Déconnecter");
            remove.onclick = async () => {
              try {
                await api("/api/design/connection", {
                  method: "DELETE",
                  body: { provider: provider.id },
                });
                await refresh();
              } catch (error) {
                message(error);
              }
            };
            actions.append(remove);
          }
          body.append(
            actions,
            h(
              "p.design-model-list",
              provider.models.map((m) => m.label).join(" · "),
            ),
          );
          return details;
        }),
    );
    if (!list.children.length)
      list.append(h("p.setting-note", "Aucun fournisseur correspondant."));
  };
  search.oninput = render;
  loadConnections(true)
    .then((info) => {
      providers = info.providers;
      render();
    })
    .catch((error) => list.replaceChildren(h("p.field-error", error.message)));
  return root;
}
