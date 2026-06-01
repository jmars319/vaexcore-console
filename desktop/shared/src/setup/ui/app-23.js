function setDisabled(id, disabled, title) {
  const node = field(id);
  if (!node) return;
  node.disabled = Boolean(disabled) || [...state.busy].length > 0;
  node.title = disabled ? title : "";
}

function summarizeMetadata(raw) {
  try {
    return Object.entries(JSON.parse(raw))
      .slice(0, 4)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(", ");
  } catch {
    return raw || "";
  }
}

function noteUserInteraction() {
  lastUserInteractionAt = Date.now();
}

function isEditingFormField() {
  return ["INPUT", "SELECT", "TEXTAREA"].includes(
    document.activeElement?.tagName,
  );
}

function hasActiveTextSelection() {
  const selection = window.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && String(selection));
}

function isUserInteracting() {
  return (
    isEditingFormField() ||
    hasActiveTextSelection() ||
    Date.now() - lastUserInteractionAt < interactionQuietMs
  );
}

function renderWhenIdle() {
  if (!isUserInteracting()) {
    render();
    return;
  }

  if (deferredRenderTimer) {
    clearTimeout(deferredRenderTimer);
  }
  deferredRenderTimer = setTimeout(renderWhenIdle, renderIdleDelayMs);
}

for (const eventName of [
  "input",
  "keydown",
  "pointerdown",
  "touchstart",
  "wheel",
]) {
  document.addEventListener(eventName, noteUserInteraction, {
    capture: true,
    passive: true,
  });
}
document.addEventListener("scroll", noteUserInteraction, {
  capture: true,
  passive: true,
});
document.addEventListener(
  "focusout",
  () => {
    if (deferredRenderTimer) {
      renderWhenIdle();
    }
  },
  { capture: true },
);

refreshAll();
setInterval(() => {
  if (state.busy.size === 0) {
    void refreshAll({ background: true });
  }
}, backgroundRefreshMs);
