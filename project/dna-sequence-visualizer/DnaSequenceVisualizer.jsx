import { useState, useRef, useCallback, useEffect } from "react";
import * as lookup from "./sequence-lookups";
import { findSpliceSites, SPLICE_COLORS } from "./splice-functions";
import CodonBox from "./widgets/CodonBox.jsx";
import styles from "./styles.jsx";
import fetchWithTimeout from "./helper-functions";
import MoreInfoWidget from "./widgets/MoreInfoWidget.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────
const cleanSeq = (raw) =>
  raw
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("")
    .toUpperCase()
    .replace(/[^ATGCN]/g, "");

const findFeatures = (seq) => {
  const feats = [];
  for (const e of lookup.RES_ENZYMES) {
    const re = new RegExp(e.seq, "g");
    let m;
    while ((m = re.exec(seq)) !== null) {
      feats.push({
        type: "res",
        name: e.name,
        start: m.index,
        end: m.index + e.seq.length - 1,
        color: e.color,
        seq: e.seq,
      });
      re.lastIndex = m.index + 1;
    }
  }
  const addPattern = (pattern, type, label) => {
    let i = seq.indexOf(pattern);
    while (i !== -1) {
      feats.push({
        type,
        name: label,
        start: i,
        end: i + 2,
        color: type === "start" ? "#22c55e" : "#ef4444",
        seq: pattern,
      });
      i = seq.indexOf(pattern, i + 1);
    }
  };
  addPattern("ATG", "start", "Start codon");
  for (const s of ["TAA", "TAG", "TGA"]) addPattern(s, "stop", `Stop (${s})`);

  feats.push(...findSpliceSites(seq));

  return feats;
};

// ── Cell width ────────────────────────────────────────────────────────────────
const CW = 18;

// ── Sub-components ────────────────────────────────────────────────────────────
const NtCell = ({ base, highlights }) => {
  const fg = lookup.BASE_FG[base] ?? "#9ca3af";
  let bg = "transparent",
    shadow = "none";

  // define offsets for each highlight type
  const highlightRows = {
    start: 2,
    stop: 2,
    res: 1,
    splice: 0,
  };

  return (
    <div
      style={{
        position: "relative",
        width: CW,
        height: 40,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 13,
        fontWeight: 600,
        color: fg,
        cursor: "default",
        transition: "filter .1s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.5)")}
      onMouseLeave={(e) => (e.currentTarget.style.filter = "brightness(1)")}
    >
      <span style={{ position: "relative", top: "-6px" }}>{base}</span>

      {/* Highlights */}
      {highlights.map((highlight, index) => {
        const offset = highlightRows[highlight.type] ?? 0;
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              bottom: offset * 6, // Adjust the offset for each row
              left: 0,
              width: "100%",
              height: 5, // Fixed height for each highlight row
              backgroundColor: highlight.color,
              opacity: 0.5,
            }}
            title={`${highlight.name ?? highlight.type} · ${base}`}
          />
        );
      })}
    </div>
  );
};

const fetchGeneSequence = async (geneName) => {
  const lookup = await fetchWithTimeout(
    `https://rest.ensembl.org/lookup/symbol/homo_sapiens/${encodeURIComponent(geneName)}?content-type=application/json`,
  );
  if (!lookup.ok) throw new Error(`Gene lookup failed for ${geneName}`);
  const lookupJson = await lookup.json();

  const seqRes = await fetchWithTimeout(
    `https://rest.ensembl.org/sequence/id/${lookupJson.id}?content-type=application/json&type=genomic`,
  );
  if (!seqRes.ok) throw new Error(`Sequence fetch failed for ${geneName}`);
  const seqJson = await seqRes.json();

  return { seq: seqJson.seq, lookupJson };
};

// ── Main component ────────────────────────────────────────────────────────────
export default function DnaSequenceVisualizerApp() {
  const [input, setInput] = useState(lookup.EXAMPLE);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [currentStart, setCurrentStart] = useState(0);
  const [geneName, setGeneName] = useState("");
  const frameSize = 70;
  const fileRef = useRef();

  const analyze = useCallback(
    (raw = input) => {
      const seq = cleanSeq(raw);
      if (seq.length < 3) return;

      const feats = findFeatures(seq);
      const spliceAt = {};

      // position maps
      const resAt = {};
      const startAt = new Set();
      const stopAt = new Set();
      for (const f of feats) {
        for (let j = f.start; j <= f.end; j++) {
          if (f.type === "res" && !resAt[j]) resAt[j] = f;
          if (f.type === "start") startAt.add(j);
          if (f.type === "stop") stopAt.add(j);
          if (f.type === "splice" && !spliceAt[j]) spliceAt[j] = f;
        }
      }

      // Stats
      const counts = { A: 0, T: 0, G: 0, C: 0, N: 0 };
      for (const c of seq) counts[c] = (counts[c] ?? 0) + 1;
      const gc = (((counts.G + counts.C) / seq.length) * 100).toFixed(1);

      setResult({ seq, feats, resAt, startAt, stopAt, spliceAt, counts, gc });
    },
    [input],
  );

  // Auto-analyze with debounce
  useEffect(() => {
    const t = setTimeout(() => {
      if (input.trim().length >= 3) analyze(input);
    }, 400);
    return () => clearTimeout(t);
  }, [input, analyze]);

  // Run example on mount
  useEffect(() => {
    analyze(lookup.EXAMPLE);
  }, []); // eslint-disable-line

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => {
      setInput(ev.target.result);
      analyze(ev.target.result);
    };
    r.readAsText(file);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => {
      setInput(ev.target.result);
      analyze(ev.target.result);
    };
    r.readAsText(file);
  };

  const handleFetch = async () => {
    try {
      const { seq } = await fetchGeneSequence(geneName);
      setInput(seq);
      analyze(seq);
    } catch (e) {
      console.error("Error fetching gene sequence:", e.message);
    }
  };

  // ── Navigation handlers ───────────────────────────────────
  const toStart = () => setCurrentStart(0);

  const prevWindow = () => setCurrentStart((prev) => Math.max(0, prev - 30));

  const nextWindow = () =>
    setCurrentStart((prev) => Math.min(seq.length - frameSize, prev + 30));

  const toEnd = () => setCurrentStart(Math.max(0, seq.length - frameSize));

  // ── Ruler ticks ───────────────────────────────────────────
  const renderRuler = (start, len) => {
    const ticks = [];
    const firstTick = Math.ceil((start + 1) / 10) * 10;
    const offset = firstTick - (start + 1);

    ticks.push(
      <span
        key={start + 1}
        style={{
          position: "absolute",
          left: offset * CW,
          bottom: 3,
          fontFamily: "JetBrains Mono,monospace",
          fontSize: 11,
          color: "#4eafe0",
        }}
      >
        {firstTick}
      </span>,
    );
    for (let pos = firstTick + 10; pos <= start + len; pos += 10) {
      ticks.push(
        <span
          key={pos}
          style={{
            position: "absolute",
            left: (pos - start - 1) * CW,
            bottom: 3,
            transform: "translateX(-50%)",
            fontFamily: "JetBrains Mono,monospace",
            fontSize: 11,
            color: "#4eafe0",
          }}
        >
          {pos}
        </span>,
      );
    }
    return ticks;
  };

  const { seq, feats, resAt, startAt, stopAt, spliceAt, counts, gc } =
    result ?? {};

  return (
    <div style={styles.page}>
      {/* Google Fonts */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Syne:wght@500;700;800&display=swap');`}</style>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <h1 style={styles.h1}>DNA Sequence Visualizer</h1>
          <span style={styles.badge}>v0.1.0</span>
        </div>
        <p style={styles.sub}>
          Visualise reading frames, amino acid translations, restriction enzyme
          recognition sites, coding features and splice sites prediction
        </p>
        <MoreInfoWidget />
      </div>

      {/* Input row */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
          padding: "2px 0",
          width: "100vw",
        }}
      >
        <input
          value={geneName}
          onChange={(e) => setGeneName(e.target.value)}
          placeholder="Gene symbol (e.g. RAB5B)"
        />
        <button
          style={{ ...styles.btnPrimary }}
          onClick={handleFetch}
          disabled={!geneName}
        >
          Lookup
        </button>
        <button
          style={styles.btnSecond}
          onClick={() => {
            setInput(lookup.EXAMPLE);
            analyze(lookup.EXAMPLE);
          }}
        >
          Load example
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 16,
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            flex: "1 1 0%",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <textarea
            style={{ ...styles.textarea, minWidth: 0, width: "auto" }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a DNA sequence here (ATGC…) — FASTA format accepted, whitespace ignored"
          />
          <div
            style={{
              ...styles.dropzone,
              border: `2px dashed ${dragOver ? "#4f8ef7" : "#1e2d48"}`,
              color: dragOver ? "#4f8ef7" : "#4e5fa0",
              background: dragOver ? "#0f1a32" : "#0e1422",
            }}
            onClick={() => fileRef.current.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M12 16V9m0 0-3 3m3-3 3 3M4.5 19.5A4.5 4.5 0 0 1 3 11.25a5.25 5.25 0 0 1 9.9-2.25A5.75 5.75 0 0 1 21 14.75" />
            </svg>
            Drop .fasta / .txt / .seq file — or click to browse
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".fasta,.fa,.txt,.seq"
            style={{ display: "none" }}
            onChange={handleFile}
          />
        </div>
      </div>

      {/* Stats bar */}
      {result && (
        <div style={styles.statsBar}>
          <Stat label="Length" val={`${seq.length.toLocaleString()} bp`} />
          <div style={styles.sep} />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#4e5f80" }}>GC%</span>
            <span
              style={{
                fontFamily: "JetBrains Mono,monospace",
                fontWeight: 600,
              }}
            >
              {gc}%
            </span>
            <div
              style={{
                width: 80,
                height: 5,
                background: "#131a2e",
                borderRadius: 99,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${gc}%`,
                  height: "100%",
                  background: "linear-gradient(90deg,#4f8ef7,#4ade80)",
                  borderRadius: 99,
                }}
              />
            </div>
          </div>
          <div style={styles.sep} />
          {["A", "T", "G", "C"].map((b) => (
            <Stat
              key={b}
              label={b}
              val={counts[b]}
              valColor={lookup.BASE_FG[b]}
            />
          ))}
          <div style={styles.sep} />
          <Stat
            label="Starts"
            val={feats.filter((f) => f.type === "start").length}
            valColor="#22c55e"
          />
          <Stat
            label="Stops"
            val={feats.filter((f) => f.type === "stop").length}
            valColor="#ef4444"
          />
          <Stat
            label="RES"
            val={feats.filter((f) => f.type === "res").length}
            valColor="#f59e0b"
          />
        </div>
      )}

      {/* Legend */}
      {result && (
        <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
          <div
            style={{
              display: "flex",
              gap: 14,
              marginBottom: 14,
              flexWrap: "wrap",
              fontSize: 11,
              alignItems: "center",
              border: "1px solid #22655e",
              padding: "4px 10px",
              borderRadius: 6,
              background: "#231a2e",
            }}
          >
            <span style={{ color: "#4eafe0" }}>Highlighted Features:</span>
            <LegDot bg="#22c55e99" bd="#22c55e" label="Start (ATG)" />
            <LegDot bg="#ef444499" bd="#ef4444" label="Stop codon" />
            <LegDot bg="#f59e0b99" bd="#f59e0b" label="Restriction site" />
            <LegDot
              bg={SPLICE_COLORS.donor + "99"}
              bd={SPLICE_COLORS.donor}
              fg={SPLICE_COLORS.donor}
              label="5′ Donor (GT)"
            />
            <LegDot
              bg={SPLICE_COLORS.acceptor + "99"}
              bd={SPLICE_COLORS.acceptor}
              fg={SPLICE_COLORS.acceptor}
              label="3′ Acceptor (AG)"
            />
            <LegDot
              bg={SPLICE_COLORS.branchpoint + "99"}
              bd={SPLICE_COLORS.branchpoint}
              fg={SPLICE_COLORS.branchpoint}
              label="Branch point"
            />
            <LegDot
              bg={SPLICE_COLORS.u12donor + "99"}
              bd={SPLICE_COLORS.u12donor}
              fg={SPLICE_COLORS.u12donor}
              label="U12 site"
            />
          </div>
          {/* Navigation buttons */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <button style={styles.navButton} onClick={toStart}>
              {"<<"}
            </button>
            <button style={styles.navButton} onClick={prevWindow}>
              {"<"}
            </button>
            <button style={styles.navButton} onClick={nextWindow}>
              {">"}
            </button>
            <button style={styles.navButton} onClick={toEnd}>
              {">>"}
            </button>
          </div>
        </div>
      )}

      {/* Sequence viewer */}
      {result && (
        <div style={styles.viewer}>
          {/* Labels column */}
          <div style={styles.labCol}>
            {[
              { label: "pos", h: 24 },
              { label: "seq", h: 42 },
              { label: "0", h: 26 },
              { label: "+1", h: 26 },
              { label: "+2", h: 26 },
            ].map(({ label, h }, i) => (
              <div
                key={label}
                style={{
                  ...styles.labCell,
                  height: h,
                  ...(i === 0 ? { borderTop: "none" } : {}),
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Scrollable sequence area */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                width: frameSize * CW,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* Ruler */}
              <div
                style={{
                  position: "relative",
                  height: 24,
                  width: frameSize * CW,
                }}
              >
                {renderRuler(currentStart, frameSize)}
              </div>

              {/* Nucleotide row */}
              <div
                style={{
                  display: "flex",
                  height: 42,
                  borderTop: "1px solid #1e2d48",
                }}
              >
                {[...seq.slice(currentStart, currentStart + frameSize)].map(
                  (base, i) => {
                    const globalIndex = currentStart + i;
                    const highlights = [];

                    // let hl = null;
                    if (resAt[globalIndex]) highlights.push(resAt[globalIndex]);
                    if (startAt.has(globalIndex))
                      highlights.push({
                        type: "start",
                        name: "Start codon",
                        color: "#22c55e",
                      });
                    if (stopAt.has(globalIndex))
                      highlights.push({
                        type: "stop",
                        name: "Stop codon",
                        color: "#ef4444",
                      });
                    if (spliceAt[globalIndex])
                      highlights.push(spliceAt[globalIndex]);
                    return (
                      <NtCell
                        key={globalIndex}
                        base={base}
                        highlights={highlights}
                      />
                    );
                  },
                )}
              </div>

              {/* Reading frames */}
              {[0, 1, 2].map((rf) => (
                <div
                  key={rf}
                  style={{
                    display: "flex",
                    height: 26,
                    borderTop: "1px solid #1e2d48",
                    alignItems: "center",
                  }}
                >
                  {rf > 0 && <div style={{ width: rf * CW, flexShrink: 0 }} />}
                  {Array.from(
                    { length: Math.floor((frameSize - rf) / 3) },
                    (_, c) => {
                      const idx = currentStart + rf + c * 3;
                      if (idx + 3 > seq.length) return null;
                      const codon = seq.slice(idx, idx + 3);
                      return (
                        <CodonBox
                          key={idx}
                          codon={codon}
                          index={idx}
                          rfOffset={rf}
                          CW={CW}
                        />
                      );
                    },
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 14,
          marginBottom: 14,
          flexWrap: "wrap",
          fontSize: 11,
          alignItems: "center",
          border: "1px solid #22655e",
          padding: "4px 10px",
          borderRadius: 6,
          background: "#231a2e",
          width: "fit-content",
        }}
      >
        <span style={{ color: "#4eafe0" }}>Amino Acids:</span>
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "4px 10px",
            background: "#131a2e",
            borderRadius: 6,
            flexWrap: "wrap",
          }}
        >
          <LegDot
            bg="#6b480e99"
            bd="#6b480e"
            fg="#f59e0b"
            label="Hydrophobic"
          />
          <LegDot bg="#0f513299" bd="#0f5132" fg="#34d399" label="Polar" />
          <LegDot bg="#1e3a8a99" bd="#1e3a8a" fg="#60a5fa" label="+ Charged" />
          <LegDot bg="#6b1a2599" bd="#6b1a25" fg="#f87171" label="− Charged" />
          <LegDot
            bg="#4c1d9599"
            bd="#4c1d95"
            fg="#a78bfa"
            label="Special (C/G/P)"
          />
          <LegDot bg="#6b151599" bd="#6b1515" fg="#ff6b6b" label="Stop (*)" />
        </div>
      </div>

      {/* Features list */}
      {result && feats.length > 0 && (
        <div style={styles.featPanel}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#dce8ff",
              marginBottom: 10,
            }}
          >
            Detected Features
          </div>
          <div
            style={{
              maxHeight: 220,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            {[...feats]
              .sort((a, b) => a.start - b.start)
              .map((f, i) => (
                <div
                  key={i}
                  style={styles.featItem}
                  data-start={f.start}
                  onClick={() =>
                    setCurrentStart(
                      Math.max(0, f.start - Math.floor(frameSize / 2)),
                    )
                  }
                >
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: 3,
                      fontSize: 10,
                      fontWeight: 700,
                      flexShrink: 0,
                      border: `1px solid ${f.color}55`,
                      background: `${f.color}22`,
                      color: f.color,
                    }}
                  >
                    {f.type === "res"
                      ? "RES"
                      : f.type === "start"
                        ? "START"
                        : f.type == "stop"
                          ? "STOP"
                          : f.subtype === "donor"
                            ? "5'SS"
                            : f.subtype === "acceptor"
                              ? "3'SS"
                              : f.subtype === "branchpoint"
                                ? "BPS"
                                : f.subtype === "u12donor"
                                  ? "U12-D"
                                  : f.subtype === "u12branch"
                                    ? "U12-B"
                                    : "SS"}{" "}
                    {/* Show PWM score where available */}
                    {f.score !== null && f.score !== undefined && (
                      <span style={{ color: "#4e5f80" }}>score {f.score}</span>
                    )}
                  </span>
                  <span style={{ color: "#4e5f80" }}>
                    {f.start + 1}–{f.end + 1}
                  </span>
                  <span style={{ fontWeight: 600, color: f.color }}>
                    {f.name}
                  </span>
                  <span
                    style={{
                      color: "#4e5f80",
                      letterSpacing: "1.5px",
                      fontSize: 10,
                    }}
                  >
                    {f.seq}
                  </span>
                  {f.type !== "res" && (
                    <span style={{ color: "#4e5f80" }}>RF+{f.start % 3}</span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && (
        <div
          style={{
            textAlign: "center",
            padding: "48px 20px",
            color: "#4e5f80",
            fontSize: 13,
          }}
        >
          <svg
            width="48"
            height="48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            viewBox="0 0 24 24"
            style={{ opacity: 0.15, display: "block", margin: "0 auto 12px" }}
          >
            <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" />
          </svg>
          Paste or drop a sequence to get started
        </div>
      )}
    </div>
  );
}

// ── Tiny helper components ────────────────────────────────────────────────────
const Stat = ({ label, val, valColor }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <span style={{ color: "#4e5f80" }}>{label}</span>
    <span
      style={{
        fontFamily: "JetBrains Mono,monospace",
        fontWeight: 600,
        color: valColor,
      }}
    >
      {val}
    </span>
  </div>
);

const LegDot = ({ bg, bd, fg, label }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
    <div
      style={{
        width: 12,
        height: 10,
        borderRadius: 2,
        border: `1.5px solid ${bd}`,
        background: bg,
        flexShrink: 0,
      }}
    />
    <span style={{ color: fg ?? "#c8d4f0" }}>{label}</span>
  </div>
);
