export interface Token { text: string; start: number; end: number; kind: "word" | "name" | "other" }

// Scan from the document start so a cursor inside a multiline string or comment stays inert.
export function tokens(text: string): Token[] {
    const out: Token[] = [];
    const lex = /\s+|--[^\r\n]*|\/\*|'(?:''|[^'])*(?:'|$)|\[(?:\]\]|[^\]])*\]|"(?:[^"]|"")*"|[\p{L}_][\p{L}\p{N}_$#@]*|\d+(?:\.\d+)?|./gusy;
    let m: RegExpExecArray | null;
    while ((m = lex.exec(text))) {
        const raw = m[0];
        if (/^\s|^--/.test(raw)) continue;
        if (raw === "/*") {
            const markers = /\/\*|\*\//g;
            markers.lastIndex = lex.lastIndex;
            let depth = 1;
            while (depth) {
                const next = markers.exec(text);
                if (!next) return out;
                depth += next[0] === "/*" ? 1 : -1;
            }
            lex.lastIndex = markers.lastIndex;
            continue;
        }
        let value = raw;
        let kind: Token["kind"] = "other";
        if (raw.startsWith("[") && raw.endsWith("]")) {
            value = raw.slice(1, -1).replaceAll("]]", "]");
            kind = "name";
        } else if (/^[\p{L}_]/u.test(raw)) kind = "word";
        out.push({ text: value, start: m.index, end: lex.lastIndex, kind });
    }
    return out;
}

export const keyword = (t?: Token) => t?.kind === "word" ? t.text.toUpperCase() : "";
export const symbol = (t: Token | undefined, value: string) => t?.kind === "other" && t.text === value;
