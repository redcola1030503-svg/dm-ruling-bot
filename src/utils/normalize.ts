export function normalizeCardName(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\s・「」『』]+/g, "")
    .toLowerCase();
}
