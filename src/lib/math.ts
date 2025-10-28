

export function decimal(num: number, places: number): number {
    const factor = Math.pow(10, places);
    return Math.floor(num * factor) / factor;
}