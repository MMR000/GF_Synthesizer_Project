import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TAGS, CATEGORY_META, CATEGORY_ORDER, type TagCategory, type TagDef } from "../data/tags";

interface Props {
  onInsert: (insert: string) => void;
  favorites: string[];
  onToggleFavorite: (tag: string) => void;
  onCopy: (text: string) => void;
}

type Filter = "all" | "favorites" | TagCategory;

export default function TagLibrary({ onInsert, favorites, onToggleFavorite, onCopy }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TAGS.filter((t) => {
      if (filter === "favorites" && !favorites.includes(t.tag)) return false;
      if (filter !== "all" && filter !== "favorites" && t.category !== filter) return false;
      if (!q) return true;
      return (
        t.tag.toLowerCase().includes(q) ||
        t.label.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    });
  }, [query, filter, favorites]);

  const grouped = useMemo(() => {
    const map = new Map<TagCategory, TagDef[]>();
    for (const c of CATEGORY_ORDER) map.set(c, []);
    for (const t of filtered) map.get(t.category)!.push(t);
    return map;
  }, [filtered]);

  const handleDragStart = (e: React.DragEvent, t: TagDef) => {
    e.dataTransfer.setData("text/plain", t.insert);
    e.dataTransfer.setData("application/x-tts-tag", t.insert);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <section className="glass flex h-full flex-col p-4">
      <div className="panel-title mb-3">
        <span className="h-2 w-2 rounded-full bg-gradient-to-r from-fuchsia-400 to-cyan-400" />
        Tag Library
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tags by name, category…"
        className="input-dark mb-3"
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["all", "favorites", ...CATEGORY_ORDER] as Filter[]).map((f) => {
          const active = filter === f;
          const label =
            f === "all" ? "All" : f === "favorites" ? "★ Favorites" : CATEGORY_META[f].name;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`pill transition ${
                active
                  ? "border-white/30 bg-white/15 text-white"
                  : "border-white/10 bg-white/5 text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="scroll-thin -mr-2 flex-1 space-y-4 overflow-y-auto pr-2">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat)!;
          if (items.length === 0) return null;
          const meta = CATEGORY_META[cat];
          return (
            <div key={cat}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {meta.name}
                </h3>
                <span className="text-[10px] text-slate-500">{items.length}</span>
              </div>

              {cat === "sfx" && (
                <p className="mb-2 rounded-lg border border-lime-400/20 bg-lime-500/10 px-2 py-1 text-[11px] text-lime-200/90">
                  ⚠ SFX should be followed by sound text like Haha, Hehe, Achoo.
                </p>
              )}
              {cat !== "sfx" && (
                <p className="mb-2 text-[11px] text-slate-500">
                  Tip: place near the beginning, and repeat before paragraphs in long text.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <AnimatePresence initial={false}>
                  {items.map((t) => {
                    const fav = favorites.includes(t.tag);
                    return (
                      <motion.div
                        key={t.tag}
                        layout
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="group relative"
                      >
                        <div
                          draggable
                          onDragStart={(e) => handleDragStart(e, t)}
                          onClick={() => onInsert(t.insert)}
                          title={t.tooltip}
                          className={`flex cursor-grab items-center gap-1 rounded-lg border px-2 py-1 text-xs transition active:cursor-grabbing ${meta.chip}`}
                        >
                          <span className="font-medium">{t.label}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFavorite(t.tag);
                            }}
                            title={fav ? "Unfavorite" : "Favorite"}
                            className={`ml-0.5 text-[11px] ${fav ? "text-amber-300" : "text-slate-500 hover:text-amber-300"}`}
                          >
                            {fav ? "★" : "☆"}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onCopy(t.insert);
                            }}
                            title="Copy tag"
                            className="text-[11px] text-slate-500 hover:text-white"
                          >
                            ⧉
                          </button>
                        </div>

                        <div className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-56 rounded-lg border border-white/10 bg-ink-700/95 p-2 text-[11px] text-slate-300 shadow-xl backdrop-blur group-hover:block">
                          <code className="mb-1 block break-all text-cyan-300">{t.insert}</code>
                          {t.tooltip}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">No tags match your search.</p>
        )}
      </div>
    </section>
  );
}
