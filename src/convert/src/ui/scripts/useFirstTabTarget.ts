import type { RefObject } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { popupOpen } from "src/ui/PopupStore";

// Choose the entry point on the first forward Tab, without moving focus on mount.
export default function useFirstTabTarget<T extends HTMLElement>(target: RefObject<T | null>) {
  useLayoutEffect(() => {
    const handleTab = (event: KeyboardEvent) => {
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.defaultPrevented ||
        popupOpen.peek()
      )
        return;
      if (document.activeElement === document.body) {
        // Target not rendered yet: keep listening for the next Tab.
        if (!target.current) return;
        event.preventDefault();
        target.current.focus();
      }
      // If the user already focused a control, preserve its normal Tab order.
      window.removeEventListener("keydown", handleTab);
    };
    window.addEventListener("keydown", handleTab);
    return () => window.removeEventListener("keydown", handleTab);
  }, [target]);
}
