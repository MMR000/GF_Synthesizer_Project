export type TagCategory = "emotion" | "prosody" | "style" | "sfx";

export interface TagDef {
  category: TagCategory;
  tag: string; // canonical tag, e.g. <|emotion:elation|>
  label: string; // human label
  insert: string; // text actually inserted (sfx appends onomatopoeia)
  tooltip: string;
  onomatopoeia?: string;
}

const DELIVERY_HINT =
  "Delivery tag — usually place near the beginning, and repeat before paragraphs in long text.";
const SFX_HINT = "SFX should be followed by sound text like Haha, Hehe, Achoo.";

export const CATEGORY_META: Record<
  TagCategory,
  { name: string; accent: string; chip: string; ring: string; glow: string; dot: string }
> = {
  emotion: {
    name: "Emotion",
    accent: "from-fuchsia-500 to-purple-500",
    chip: "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-400/30 hover:bg-fuchsia-500/25",
    ring: "focus:ring-fuchsia-400/50",
    glow: "shadow-[0_0_18px_-6px_rgba(217,70,239,0.8)]",
    dot: "bg-fuchsia-400",
  },
  prosody: {
    name: "Prosody",
    accent: "from-cyan-400 to-blue-500",
    chip: "bg-cyan-500/15 text-cyan-100 border-cyan-400/30 hover:bg-cyan-500/25",
    ring: "focus:ring-cyan-400/50",
    glow: "shadow-[0_0_18px_-6px_rgba(34,211,238,0.8)]",
    dot: "bg-cyan-400",
  },
  style: {
    name: "Style",
    accent: "from-amber-400 to-orange-500",
    chip: "bg-amber-500/15 text-amber-100 border-amber-400/30 hover:bg-amber-500/25",
    ring: "focus:ring-amber-400/50",
    glow: "shadow-[0_0_18px_-6px_rgba(251,191,36,0.8)]",
    dot: "bg-amber-400",
  },
  sfx: {
    name: "Sound FX",
    accent: "from-lime-400 to-green-500",
    chip: "bg-lime-500/15 text-lime-100 border-lime-400/30 hover:bg-lime-500/25",
    ring: "focus:ring-lime-400/50",
    glow: "shadow-[0_0_18px_-6px_rgba(132,204,22,0.8)]",
    dot: "bg-lime-400",
  },
};

function emotion(value: string, label: string): TagDef {
  const tag = `<|emotion:${value}|>`;
  return { category: "emotion", tag, label, insert: tag, tooltip: `${label}. ${DELIVERY_HINT}` };
}
function prosody(value: string, label: string): TagDef {
  const tag = `<|prosody:${value}|>`;
  return { category: "prosody", tag, label, insert: tag, tooltip: `${label}. ${DELIVERY_HINT}` };
}
function style(value: string, label: string): TagDef {
  const tag = `<|style:${value}|>`;
  return { category: "style", tag, label, insert: tag, tooltip: `${label}. ${DELIVERY_HINT}` };
}
function sfx(value: string, label: string, ono: string): TagDef {
  const tag = `<|sfx:${value}|>`;
  return {
    category: "sfx",
    tag,
    label,
    insert: `${tag}${ono}`,
    onomatopoeia: ono,
    tooltip: `${label} → inserts "${tag}${ono}". ${SFX_HINT}`,
  };
}

export const TAGS: TagDef[] = [
  emotion("elation", "Joy / elation"),
  emotion("amusement", "Funny / playful / laughter mood"),
  emotion("enthusiasm", "Excited / energetic"),
  emotion("determination", "Firm / determined"),
  emotion("pride", "Proud / confident"),
  emotion("contentment", "Calm satisfaction"),
  emotion("affection", "Warm / affectionate"),
  emotion("relief", "Relieved"),
  emotion("contemplation", "Thoughtful"),
  emotion("confusion", "Confused"),
  emotion("surprise", "Surprised"),
  emotion("awe", "Wonder / awe"),
  emotion("longing", "Longing"),
  emotion("arousal", "Heightened desire"),
  emotion("anger", "Angry"),
  emotion("fear", "Fearful"),
  emotion("disgust", "Disgusted"),
  emotion("bitterness", "Bitter"),
  emotion("sadness", "Sad"),
  emotion("shame", "Shame"),
  emotion("helplessness", "Helpless"),

  style("singing", "Singing"),
  style("shouting", "Shouting"),
  style("whispering", "Whispering"),

  prosody("speed_very_slow", "Very slow"),
  prosody("speed_slow", "Slow"),
  prosody("speed_fast", "Fast"),
  prosody("speed_very_fast", "Very fast"),
  prosody("pitch_low", "Low pitch"),
  prosody("pitch_high", "High pitch"),
  prosody("pause", "Short pause"),
  prosody("long_pause", "Long pause"),
  prosody("expressive_high", "More expressive"),
  prosody("expressive_low", "Flatter / less expressive"),

  sfx("cough", "Cough", "Ahem"),
  sfx("laughter", "Laughter", "Haha"),
  sfx("crying", "Crying", "Boohoo"),
  sfx("screaming", "Screaming", "Ahh"),
  sfx("burping", "Burping", "Burp"),
  sfx("humming", "Humming", "Hmm"),
  sfx("sigh", "Sigh", "Ahh"),
  sfx("sniff", "Sniff", "Sff"),
  sfx("sneeze", "Sneeze", "Achoo"),
];

export const CATEGORY_ORDER: TagCategory[] = ["emotion", "prosody", "style", "sfx"];
