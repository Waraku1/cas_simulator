import { useEffect, useRef, useState } from "react";

const HEART_POINT_MIN = 0;
const HEART_POINT_MAX = 100;

function enhanceAuthenticationTabs(root: ParentNode) {
  for (const control of root.querySelectorAll<HTMLElement>(".segmented-control")) {
    control.setAttribute("role", "tablist");
    if (!control.hasAttribute("aria-label")) control.setAttribute("aria-label", "Authentication mode");

    const tabs = Array.from(control.querySelectorAll<HTMLButtonElement>("button"));
    for (const tab of tabs) {
      const selected = tab.classList.contains("is-active");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;

      if (tab.dataset.c5aKeyboardBound === "1") continue;
      tab.dataset.c5aKeyboardBound = "1";
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const currentTabs = Array.from(control.querySelectorAll<HTMLButtonElement>("button"));
        const currentIndex = currentTabs.indexOf(tab);
        if (currentIndex < 0 || currentTabs.length === 0) return;

        event.preventDefault();
        let nextIndex = currentIndex;
        if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + currentTabs.length) % currentTabs.length;
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % currentTabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = currentTabs.length - 1;

        const next = currentTabs[nextIndex];
        next.focus();
        next.click();
      });
    }
  }
}

function enhanceHeartPointState(root: ParentNode) {
  for (const block of root.querySelectorAll<HTMLElement>(".hp-block")) {
    const rawValue = Number(block.querySelector("strong")?.textContent?.trim());
    if (!Number.isFinite(rawValue)) continue;
    const value = Math.min(HEART_POINT_MAX, Math.max(HEART_POINT_MIN, rawValue));
    const label = block.classList.contains("hp-block--local") ? "Your Heart Points" : "Opponent Heart Points";

    block.setAttribute("role", "progressbar");
    block.setAttribute("aria-label", label);
    block.setAttribute("aria-valuemin", String(HEART_POINT_MIN));
    block.setAttribute("aria-valuemax", String(HEART_POINT_MAX));
    block.setAttribute("aria-valuenow", String(value));
    block.setAttribute("aria-valuetext", `${value} Heart Points`);
    block.querySelector<HTMLElement>(":scope > div")?.setAttribute("aria-hidden", "true");
  }
}

function enhanceLeaderboard(root: ParentNode) {
  const leaderboard = root.querySelector<HTMLElement>(".leaderboard-card");
  if (!leaderboard) return;
  leaderboard.setAttribute("aria-label", "Leaderboard rankings");

  for (const row of leaderboard.querySelectorAll<HTMLElement>(".leaderboard-row")) {
    const cells = Array.from(row.children).map((cell) => cell.textContent?.trim() ?? "");
    if (cells.length >= 4) {
      row.setAttribute("role", "group");
      row.setAttribute(
        "aria-label",
        `Rank ${cells[0]}, pilot ${cells[1]}, rating ${cells[2]}, record ${cells[3]}`,
      );
    }
  }
}

function enhanceLiveStatusSurfaces(root: ParentNode) {
  for (const heading of root.querySelectorAll<HTMLElement>(".queue-card h1, .assignment-card h1")) {
    heading.setAttribute("aria-live", "polite");
    heading.setAttribute("aria-atomic", "true");
  }

  for (const error of root.querySelectorAll<HTMLElement>(".product-screen--matchmaking .preview-note")) {
    error.setAttribute("role", "alert");
    error.setAttribute("aria-live", "assertive");
    error.setAttribute("aria-atomic", "true");
  }

  for (const feedback of root.querySelectorAll<HTMLElement>(".match-action-state small")) {
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    feedback.setAttribute("aria-atomic", "true");
  }

  for (const phase of root.querySelectorAll<HTMLElement>(".match-clock > span")) {
    phase.setAttribute("aria-live", "polite");
    phase.setAttribute("aria-atomic", "true");
  }
}

function enhanceBusyState(root: ParentNode) {
  for (const card of root.querySelectorAll<HTMLElement>(".auth-card")) {
    const submitting = Boolean(card.querySelector<HTMLButtonElement>(".product-primary:disabled"));
    card.setAttribute("aria-busy", String(submitting));
  }
}

function applyDomHardening(root: ParentNode) {
  enhanceAuthenticationTabs(root);
  enhanceHeartPointState(root);
  enhanceLeaderboard(root);
  enhanceLiveStatusSurfaces(root);
  enhanceBusyState(root);
}

function currentPoliteAnnouncement() {
  const matchShell = document.querySelector<HTMLElement>(".product-match-shell");
  if (matchShell) {
    const phase = matchShell.querySelector<HTMLElement>(".match-clock > span")?.textContent?.trim();
    const action = matchShell.querySelector<HTMLElement>(".match-action-state small")?.textContent?.trim();
    return [phase, action].filter(Boolean).join(". ");
  }

  const screen = document.querySelector<HTMLElement>(".product-screen");
  if (!screen) return "";
  const eyebrow = screen.querySelector<HTMLElement>(".product-eyebrow")?.textContent?.trim();
  const heading = screen.querySelector<HTMLElement>("h1")?.textContent?.trim();
  return [eyebrow, heading].filter(Boolean).join(". ");
}

function currentAlertAnnouncement() {
  return document
    .querySelector<HTMLElement>(".product-screen--matchmaking .preview-note")
    ?.textContent?.trim() ?? "";
}

export function AccessibilityHardening() {
  const [politeMessage, setPoliteMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const lastPoliteRef = useRef("");
  const lastAlertRef = useRef("");

  useEffect(() => {
    const root = document.getElementById("root") ?? document.body;
    let scheduled = false;

    const apply = () => {
      scheduled = false;
      applyDomHardening(root);

      const nextPolite = currentPoliteAnnouncement();
      if (nextPolite && nextPolite !== lastPoliteRef.current) {
        lastPoliteRef.current = nextPolite;
        setPoliteMessage(nextPolite);
      }

      const nextAlert = currentAlertAnnouncement();
      if (nextAlert && nextAlert !== lastAlertRef.current) {
        lastAlertRef.current = nextAlert;
        setAlertMessage(nextAlert);
      }
    };

    const scheduleApply = () => {
      if (scheduled) return;
      scheduled = true;
      window.queueMicrotask(apply);
    };

    apply();
    const observer = new MutationObserver(scheduleApply);
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className="c5a-live-region" role="status" aria-live="polite" aria-atomic="true">
        {politeMessage}
      </div>
      <div className="c5a-live-region" role="alert" aria-live="assertive" aria-atomic="true">
        {alertMessage}
      </div>
    </>
  );
}
