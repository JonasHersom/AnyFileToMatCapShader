import { signal } from "@preact/signals";
import type { CategoryType } from "src/Formats";

export const SelectedCategories = signal<Set<CategoryType>>(new Set());

export function toggleCategory(id: CategoryType) {
  const current = new Set(SelectedCategories.value);
  if (current.has(id)) {
    current.delete(id);
  } else {
    current.add(id);
  }
  SelectedCategories.value = current;
}

export function clearCategories() {
  SelectedCategories.value = new Set();
}

export function hasActiveFilters(): boolean {
  return SelectedCategories.value.size > 0;
}
