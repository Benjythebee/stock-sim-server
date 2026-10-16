/**
 * Presentations: animations a power asks the UI to play (a prize wheel, ...). The server decides
 * every outcome and the UI only plays it back, so nothing a mod does runs in the browser. Each
 * `kind` is a component built into the UI; adding one means a UI component plus a type here, and
 * a bump of MOD_API_VERSION (src/version.ts). UIs that don't know a kind ignore the message, so
 * powers must still say what happened with a normal notification.
 */

/** One slice of a prize wheel. */
export interface WheelSegment {
    label: string;
    /** CSS color of the slice. The UI picks one when omitted. */
    color?: string;
    /** Relative size of the slice (default 1). Make it match the odds so the wheel is honest. */
    weight?: number;
}

/** A prize wheel that spins and lands on `segments[result]`. */
export interface WheelPresentation {
    kind: "wheel";
    segments: WheelSegment[];
    /** Index of the winning segment, decided by the server. */
    result: number;
    /** How long the spin lasts, in ms (1,000-10,000, default 4,000). */
    durationMs?: number;
}

export type Presentation = WheelPresentation;

export const PRESENTATION_KINDS = ["wheel"] as const;
export const MIN_WHEEL_SEGMENTS = 2;
export const MAX_WHEEL_SEGMENTS = 24;
export const DEFAULT_PRESENTATION_MS = 4000;

/** Check a presentation from a mod. Returns a list of problems (empty = valid). */
export function presentationProblems(p: Presentation): string[] {
    if (!p || typeof p !== "object") return ["presentation must be an object"];
    if (!(PRESENTATION_KINDS as readonly string[]).includes(p.kind)) return [`kind must be one of ${PRESENTATION_KINDS.join(", ")}`];
    const problems: string[] = [];
    if (p.durationMs !== undefined && !(Number.isFinite(p.durationMs) && p.durationMs >= 1000 && p.durationMs <= 10_000)) {
        problems.push("durationMs must be between 1000 and 10000");
    }
    const segments = p.segments;
    if (!Array.isArray(segments) || segments.length < MIN_WHEEL_SEGMENTS || segments.length > MAX_WHEEL_SEGMENTS) {
        problems.push(`a wheel needs ${MIN_WHEEL_SEGMENTS}-${MAX_WHEEL_SEGMENTS} segments`);
        return problems;
    }
    segments.forEach((s, i) => {
        if (typeof s?.label !== "string" || !s.label) problems.push(`segment ${i} needs a label`);
        if (s?.color !== undefined && typeof s.color !== "string") problems.push(`segment ${i} color must be a string`);
        if (s?.weight !== undefined && !(Number.isFinite(s.weight) && s.weight > 0)) problems.push(`segment ${i} weight must be > 0`);
    });
    if (!Number.isInteger(p.result) || p.result < 0 || p.result >= segments.length) problems.push("result must be the index of a segment");
    return problems;
}

/** The wire copy of a (valid) presentation: known fields only, defaults filled in. */
export function wirePresentation(p: Presentation): Presentation {
    return {
        kind: p.kind,
        segments: p.segments.map((s) => ({
            label: s.label,
            ...(s.color !== undefined ? { color: s.color } : {}),
            ...(s.weight !== undefined ? { weight: s.weight } : {}),
        })),
        result: p.result,
        durationMs: p.durationMs ?? DEFAULT_PRESENTATION_MS,
    };
}
