import { h } from "./core.js";
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const running = new WeakMap();
export function slide(element, show) {
  const old = element.getBoundingClientRect().height;
  running.get(element)?.cancel();
  element.style.display = "block";
  element.style.overflow = "hidden";
  element.inert = !show;
  const end = show ? element.scrollHeight : 0;
  const finish = () => {
    element.style.height = show ? "auto" : "0px";
    element.style.overflow = show ? "" : "hidden";
  };
  if (reduce()) {
    finish();
    return;
  }
  const animation = element.animate(
    [
      { height: `${old}px`, opacity: old ? 1 : 0 },
      { height: `${end}px`, opacity: show ? 1 : 0 },
    ],
    { duration: 240, easing: "cubic-bezier(.22,1,.36,1)" },
  );
  element.style.height = `${end}px`;
  running.set(element, animation);
  animation.onfinish = finish;
}
const rowKey = (n) =>
  n.dataset.file
    ? `${n.dataset.project}/${n.dataset.file}`
    : n.dataset.path || n.dataset.project;
export function replaceSliding(element, children) {
  const oldHeight = element.getBoundingClientRect().height,
    top = element.getBoundingClientRect().top;
  const old = new Map(
    [...element.querySelectorAll("[data-path],[data-project]")].map((n) => [
      rowKey(n),
      {
        top: n.getBoundingClientRect().top,
        height: n.getBoundingClientRect().height,
        node: n.cloneNode(true),
      },
    ]),
  );
  running.get(element)?.cancel();
  const existing = new Map([...element.children].map((n) => [rowKey(n), n]));
  const nextChildren = children.map((fresh) => {
    const previous = existing.get(rowKey(fresh));
    if (!previous || !rowKey(fresh)) return fresh;
    fresh.classList.toggle("active", previous.classList.contains("active"));
    const comparison = previous.cloneNode(true);
    comparison.title = fresh.title;
    if (!comparison.isEqualNode(fresh)) return fresh;
    if (previous.title !== fresh.title) previous.title = fresh.title;
    return previous;
  });
  const keep = new Set(nextChildren);
  for (const node of [...element.children]) if (!keep.has(node)) node.remove();
  nextChildren.forEach((node, index) => {
    if (element.children[index] !== node)
      element.insertBefore(node, element.children[index] || null);
  });
  if (reduce() || !oldHeight || !element.isConnected) return;
  const next = element.getBoundingClientRect().height,
    seen = new Set();
  element.style.position = "relative";
  for (const node of element.querySelectorAll("[data-path],[data-project]")) {
    const key = rowKey(node);
    seen.add(key);
    const before = old.get(key);
    const dy = before ? before.top - node.getBoundingClientRect().top : -8;
    if (Math.abs(dy) > 1 || !before)
      node.animate(
        [
          { transform: `translateY(${dy}px)`, opacity: before ? 1 : 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 240, easing: "cubic-bezier(.22,1,.36,1)" },
      );
  }
  const ghosts = [];
  if (next < oldHeight)
    for (const [key, before] of old)
      if (!seen.has(key)) {
        const ghost = before.node;
        ghost.setAttribute("aria-hidden", "true");
        ghost.inert = true;
        Object.assign(ghost.style, {
          position: "absolute",
          left: "0",
          right: "0",
          top: `${before.top - top}px`,
          height: `${before.height}px`,
          pointerEvents: "none",
          zIndex: "1",
        });
        element.append(ghost);
        ghosts.push(ghost);
        ghost.animate(
          [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: "translateY(-8px)" },
          ],
          { duration: 210, easing: "ease-out", fill: "forwards" },
        );
      }
  if (Math.abs(oldHeight - next) > 1) {
    element.style.overflow = "hidden";
    const a = element.animate(
      [{ height: `${oldHeight}px` }, { height: `${next}px` }],
      { duration: 240, easing: "cubic-bezier(.22,1,.36,1)" },
    );
    running.set(element, a);
    a.onfinish = () => {
      element.style.overflow = "";
      ghosts.forEach((n) => n.remove());
    };
  } else ghosts.forEach((n) => n.remove());
}

let menu,
  active,
  highlight = 0;
function closeSelect(focus = false) {
  if (menu) {
    menu.remove();
    menu = null;
  }
  if (active) {
    active.setAttribute("aria-expanded", "false");
    if (focus && active.isConnected) active.focus();
  }
  active = null;
}
function openSelect(select) {
  if (select.disabled || select.multiple || select.size > 1) return;
  if (active === select && menu) {
    closeSelect();
    return;
  }
  closeSelect();
  active = select;
  select.focus({ preventScroll: true });
  select.setAttribute("aria-expanded", "true");
  const rect = select.getBoundingClientRect(),
    options = [...select.options];
  menu = h("div.opal-select-menu", {
    role: "listbox",
    "aria-label": select.getAttribute("aria-label") || "Choisir une option",
    id: "opal-select-options",
  });
  select.setAttribute("aria-controls", menu.id);
  highlight = Math.max(0, select.selectedIndex);
  const choose = (index) => {
    if (options[index].disabled) return;
    select.value = options[index].value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    closeSelect(true);
  };
  options.forEach((option, i) => {
    const row = h(
      "button.opal-select-option",
      {
        type: "button",
        role: "option",
        "aria-selected": String(option.selected),
        disabled: option.disabled,
        tabIndex: -1,
        onClick: () => choose(i),
      },
      h("span", option.text),
      option.selected
        ? h("span.opal-option-check", { "aria-hidden": "true" }, "✓")
        : null,
    );
    row.dataset.index = i;
    menu.append(row);
  });
  const max = Math.min(320, Math.max(100, innerHeight - rect.bottom - 16));
  menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - Math.max(rect.width, 180) - 8))}px`;
  menu.style.width = `${Math.max(rect.width, 180)}px`;
  menu.style.maxHeight = `${max}px`;
  document.body.append(menu);
  const height = menu.getBoundingClientRect().height;
  menu.style.top = `${rect.bottom + height + 8 > innerHeight ? Math.max(8, rect.top - height - 6) : rect.bottom + 6}px`;
  const mark = () => {
    for (const row of menu.children)
      row.classList.toggle(
        "is-highlight",
        Number(row.dataset.index) === highlight,
      );
    menu.children[highlight]?.scrollIntoView({ block: "nearest" });
  };
  mark();
  if (!reduce())
    menu.animate(
      [
        { opacity: 0, transform: "translateY(-6px) scale(.985)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 170, easing: "cubic-bezier(.22,1,.36,1)" },
    );
  menu.addEventListener("pointerdown", (event) => event.preventDefault());
  select._opalChoose = choose;
  select._opalMark = mark;
}
export function installMotion() {
  document.addEventListener(
    "pointerdown",
    (event) => {
      const select = event.target.closest("select");
      if (select && !select.multiple && select.size <= 1 && !select.disabled) {
        event.preventDefault();
        openSelect(select);
        return;
      }
      if (menu && !menu.contains(event.target)) closeSelect();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      const select = event.target.closest?.("select");
      if (!select || select.multiple || select.size > 1) return;
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        if (!menu || active !== select) {
          openSelect(select);
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          select._opalChoose(highlight);
          return;
        }
        const direction = event.key === "ArrowDown" ? 1 : -1;
        for (let i = 0; i < select.options.length; i++) {
          highlight =
            (highlight + direction + select.options.length) %
            select.options.length;
          if (!select.options[highlight].disabled) break;
        }
        select._opalMark();
      } else if (event.key === "Escape" && menu) {
        event.preventDefault();
        event.stopPropagation();
        closeSelect(true);
      } else if (event.key === "Tab") closeSelect();
    },
    true,
  );
  document.addEventListener("click", (event) => {
    const summary = event.target.closest("summary");
    if (
      !summary ||
      summary.parentElement.tagName !== "DETAILS" ||
      event.target.closest("button,a,input")
    )
      return;
    const details = summary.parentElement;
    event.preventDefault();
    const show =
      details._opalDesired === undefined
        ? !details.open
        : !details._opalDesired;
    details._opalDesired = show;
    const start = details.getBoundingClientRect().height;
    running.get(details)?.cancel();
    details.open = true;
    details.style.height = "auto";
    const end = show
      ? details.scrollHeight
      : summary.getBoundingClientRect().height;
    const finish = () => {
      details.open = show;
      details.style.height = "";
      details.style.overflow = "";
      details._opalDesired = undefined;
    };
    if (reduce()) {
      finish();
      return;
    }
    details.style.overflow = "hidden";
    details.style.height = `${end}px`;
    const a = details.animate(
      [{ height: `${start}px` }, { height: `${end}px` }],
      { duration: 240, easing: "cubic-bezier(.22,1,.36,1)" },
    );
    running.set(details, a);
    a.onfinish = finish;
  });
  window.addEventListener("resize", () => closeSelect());
  document.addEventListener(
    "scroll",
    (event) => {
      if (menu && !menu.contains(event.target)) closeSelect();
    },
    true,
  );
}
