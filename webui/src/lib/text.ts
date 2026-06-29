import type { ValidationWarning } from "../api/client";
import { TAGS } from "../data/tags";

const ANY_TAG = /<\|[^>]*\|>/g;
const VALID_TAG = /^<\|[a-z]+:[a-z_]+\|>$/;
// Delivery tags = emotion / style / speed / pitch / expressive (NOT pause/sfx).
const DELIVERY_TAG = /<\|emotion:[a-z_]+\|>|<\|style:[a-z_]+\|>|<\|prosody:(?:speed_[a-z_]+|pitch_[a-z]+|expressive_[a-z]+)\|>/g;

const VALID_TAG_SET = new Set(TAGS.map((t) => t.tag));

export function stripTags(text: string): string {
  return text.replace(ANY_TAG, "").replace(/\s+/g, " ").trim();
}

export function normalizeSpaces(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ +([.!?,;:])/g, "$1")
    .trim();
}

export function removeAllTags(text: string): string {
  return text.replace(ANY_TAG, "").replace(/[ \t]{2,}/g, " ");
}

/** Leading delivery tags of the whole passage (the "current delivery"). */
export function leadingDeliveryTags(text: string): string {
  const m = text.match(/^\s*((?:<\|[a-z]+:[a-z_]+\|>)+)/);
  if (!m) return "";
  const tags = m[1].match(DELIVERY_TAG);
  return tags ? tags.join("") : "";
}

/** Insert the passage's leading delivery tags before each paragraph that lacks them. */
export function repeatDeliveryTags(text: string): string {
  const lead = leadingDeliveryTags(text);
  if (!lead) return text;
  const paragraphs = text.split(/\n{2,}/);
  const out = paragraphs.map((p, idx) => {
    const trimmed = p.replace(/^\s+/, "");
    if (idx === 0) return p;
    // Skip if paragraph already starts with a delivery tag.
    if (/^(?:<\|[a-z]+:[a-z_]+\|>)*\s*<\|(?:emotion|style):/.test(trimmed) ||
        /^(?:<\|[a-z]+:[a-z_]+\|>)+/.test(trimmed)) {
      return p;
    }
    const leadingWs = p.match(/^\s*/)?.[0] ?? "";
    return `${leadingWs}${lead}${trimmed}`;
  });
  return out.join("\n\n");
}

export function makeMoreEmotional(text: string): string {
  const boost = "<|emotion:amusement|><|prosody:expressive_high|>";
  const paragraphs = text.split(/\n{2,}/);
  const out = paragraphs.map((p) => {
    const leadingWs = p.match(/^\s*/)?.[0] ?? "";
    const body = p.replace(/^\s+/, "");
    if (body.startsWith(boost)) return p;
    return `${leadingWs}${boost}${body}`;
  });
  return out.join("\n\n");
}

export function approxTokens(text: string): number {
  // Rough heuristic: tags count as ~1 token, words ~1.3 tokens.
  const clean = stripTags(text);
  const words = clean ? clean.split(/\s+/).length : 0;
  const tags = (text.match(ANY_TAG) || []).length;
  return Math.round(words * 1.3 + tags);
}

export function oneClickFixBracketLaughter(text: string): string {
  return text.replace(/\[laughter\]/gi, "<|sfx:laughter|>Haha");
}

/** Client-side validation mirroring the backend, for instant feedback. */
export function validateClient(text: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const add = (level: ValidationWarning["level"], code: string, message: string) =>
    warnings.push({ level, code, message });

  const stripped = text.trim();
  if (!stripped) {
    add("error", "empty", "Text is empty.");
    return warnings;
  }

  for (const m of text.matchAll(ANY_TAG)) {
    const tag = m[0];
    if (!VALID_TAG.test(tag)) add("error", "bad_syntax", `Malformed tag: ${tag}`);
    else if (!VALID_TAG_SET.has(tag)) add("warn", "unknown_tag", `Unknown tag value: ${tag}`);
  }

  if (/\[[a-zA-Z]+\]/.test(text) && !/\[laughter\]/i.test(text)) {
    add("warn", "wrong_bracket", "Use <|category:value|> syntax, not [square brackets].");
  }
  if (/【|】|〈|〉|《|》/.test(text)) {
    add("warn", "wrong_bracket", "Full-width / Chinese brackets detected. Use <| |> ASCII tags.");
  }
  if (/\[laughter\]/i.test(text)) {
    add("fix", "bracket_laughter", "Found [laughter]; replace with <|sfx:laughter|>Haha.");
  }

  for (const m of text.matchAll(/<\|sfx:[a-z_]+\|>/g)) {
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 8).trimStart();
    if (!after || !/[A-Za-zА-Яа-яЁё]/.test(after[0] ?? "")) {
      add("warn", "sfx_no_sound", `SFX ${m[0]} should be followed by sound text like Haha, Hehe, Achoo.`);
    }
  }

  const emotions = text.match(/<\|emotion:[a-z_]+\|>/g) || [];
  if (emotions.length === 0) {
    add("warn", "no_emotion", "No emotion tags used. Add one near the beginning for expressive output.");
  }
  if (stripped.length > 400 && emotions.length <= 1) {
    add(
      "warn",
      "long_single_emotion",
      "Long text has only one emotion tag. Repeat emotion/prosody tags before each paragraph to reduce drift.",
    );
  }
  if (!/[.!?。！？]/.test(stripped)) {
    add("warn", "no_punctuation", "No sentence punctuation found. Punctuation helps pacing and intonation.");
  }
  if ((text.match(/\n/g) || []).length > 12) {
    add("warn", "many_breaks", "Many line breaks detected. Excess blank lines can cause odd pauses.");
  }
  return warnings;
}
