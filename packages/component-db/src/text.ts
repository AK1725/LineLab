/** Lower-case words: "ESP32-S3 DevKitC-1" → ["esp32", "s3", "devkitc", "1"]. "×" counts as a separator. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[×]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Separator-free form used for exact and prefix matching: "QTR-8A" → "qtr8a", "N20 1000:1" → "n2010001". */
export function compact(text: string): string {
  return tokens(text).join("");
}
