import { Category, type CategoryType } from "src/Formats";

const CATEGORY_TO_ICON: Record<CategoryType, string> = {
  [Category.IMAGE]: "image",
  [Category.VECTOR]: "svg",
  [Category.VIDEO]: "video",
  [Category.AUDIO]: "audio",
  [Category.TEXT]: "document",
  [Category.DATA]: "json",
  [Category.CODE]: "javascript",
  [Category.DOCUMENT]: "document",
  [Category.SPREADSHEET]: "table",
  [Category.PRESENTATION]: "powerpoint",
  [Category.ARCHIVE]: "zip",
  [Category.FONT]: "font",
  [Category.MODEL]: "3d",
  [Category.DATABASE]: "database",
};

export function normalizeCategory(
  category?: CategoryType | CategoryType[],
): CategoryType | undefined {
  if (category === undefined) return undefined;
  return Array.isArray(category) ? category[0] : category;
}

export function getDefaultIconForCategory(category?: CategoryType | CategoryType[]): string {
  const key = normalizeCategory(category);
  if (!key) return "file";
  return CATEGORY_TO_ICON[key];
}
