/** Text that is either static or computed from the game's ticker. */
export type DynamicText = string | ((info: { ticker: string }) => string);

export function resolveText(text: DynamicText, ticker: string): string {
    return typeof text === "function" ? text({ ticker }) : text;
}
