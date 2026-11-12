import type { RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { popupOpen } from "src/ui/PopupStore";
import { hasModifier } from "src/ui/scripts/keyboard";

interface TypeToSearchOptions {
  /** Keys are only handled when focus is on the page body or inside one of these elements. */
  scopeRefs: RefObject<HTMLElement | null>[];
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  /** Called with the new search value when a printable key is redirected to the input. */
  onType: (value: string) => void;
  onEscape: () => void;
}

const EDITABLE =
  "dialog, [contenteditable]:not([contenteditable='false']), textarea, select, [role='textbox']";

/** Sends printable keys to the search input, and Escape to `onEscape`. */
export default function useTypeToSearch(options: TypeToSearchOptions) {
  // Read by the window key handler so it can stay registered across renders.
  const latest = useRef(options);
  latest.current = options;

  useLayoutEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      // Popup handles (and prevents) its own Escape before this runs.
      if (event.defaultPrevented || hasModifier(event) || popupOpen.peek()) return;
      const { scopeRefs, inputRef, value, onType, onEscape } = latest.current;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest(EDITABLE)) return;
      const inScope = scopeRefs.some((ref) => target && ref.current?.contains(target));
      if (target !== document.body && !inScope) return;

      const input = inputRef.current;
      if (event.key === "Escape") {
        if (target?.matches("input") && target !== input) return;
        event.preventDefault();
        onEscape();
      } else if (event.key.length === 1 && event.key !== " " && !target?.closest("input")) {
        event.preventDefault();
        input?.focus();
        onType(value + event.key);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
}
