/**
 * VCF / VCF.GZ chromosome site counter
 *
 * Requires:  npm install fflate
 *
 * Plain .vcf  → File.slice() chunks, direct text decode
 * .vcf.gz     → File.slice() chunks of COMPRESSED bytes fed into fflate's
 *               Decompress, which handles BGZF (concatenated gzip blocks)
 *               that the browser's native DecompressionStream chokes on.
 */

import React, { useState, useRef } from "react";
import { Decompress } from "fflate";
import {
  Upload,
  Play,
  Pause,
  RotateCcw,
  FileArchive,
  FileText,
} from "lucide-react";

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB slices of the compressed file
const POS_BIN_SIZE = 1_000_000; // for position-based stats

export default function VCFProcessorApp() {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState(null);

  const pausedRef = useRef(false);
  const abortRef = useRef(false);

  const isGzipped = file?.name?.endsWith(".gz") || file?.name?.endsWith(".bgz");

  // ── helpers ────────────────────────────────────────────────────────────────

  function tallyChrom(line, counts) {
    const tab = line.indexOf("\t");
    if (tab > 0) {
      const ch = line.substring(0, tab);
      counts[ch] = (counts[ch] || 0) + 1;
    }
  }

  function processLines(
    text,
    leftover,
    chromCounts,
    counters,
    chromBins,
    chromMaxPos,
  ) {
    const raw = (leftover + text).split("\n");
    const remainder = raw.pop() ?? "";
    let foundSampleCount = 0;

    for (const line of raw) {
      counters.total++;
      if (line.startsWith("#")) {
        counters.header++;

        if (line.toUpperCase().startsWith("#CHROM")) {
          const fields = line.replace(/^#/, "").trim().split(/\t/);
          const fmtIdx = fields.indexOf("FORMAT");
          let sampleNames = [];
          if (fmtIdx >= 0) {
            sampleNames = fields.slice(fmtIdx + 1);
          } else if (fields.length > 8) {
            sampleNames = fields.slice(8);
          }
          foundSampleCount = sampleNames.length;
        }

        continue;
      }
      if (!line.trim()) continue;
      counters.data++;

      // parse chrom and pos without full split to keep fast
      const t1 = line.indexOf("\t");
      if (t1 < 0) continue;
      const chrom = line.substring(0, t1);
      const t2 = line.indexOf("\t", t1 + 1);
      const posStr =
        t2 >= 0 ? line.substring(t1 + 1, t2) : line.substring(t1 + 1);
      const pos = parseInt(posStr, 10);

      // tally variants per chrom
      chromCounts[chrom] = (chromCounts[chrom] || 0) + 1;

      // update max POS seen for chrom
      if (!isNaN(pos) && pos > 0) {
        chromMaxPos[chrom] = Math.max(chromMaxPos[chrom] || 0, pos);

        // update bin counter
        const binIdx = Math.floor((pos - 1) / POS_BIN_SIZE);
        const bins = chromBins[chrom] || (chromBins[chrom] = {});
        bins[binIdx] = (bins[binIdx] || 0) + 1;
      }
    }
    return { remainder, sampleCount: foundSampleCount };
  }

  // ── plain .vcf: slice → text ────────────────────────────────────────────────

  const processPlain = async () => {
    const fileSize = file.size;
    let offset = 0;
    let leftover = "";
    const chromCounts = {};
    const chromBins = {};
    const chromMaxPos = {};
    const counters = { total: 0, header: 0, data: 0 };
    const startTime = performance.now();
    let sampleCount = 0;

    while (offset < fileSize && !abortRef.current) {
      while (pausedRef.current && !abortRef.current)
        await new Promise((r) => setTimeout(r, 100));
      if (abortRef.current) break;

      const text = await file.slice(offset, offset + CHUNK_SIZE).text();
      const res = processLines(
        text,
        leftover,
        chromCounts,
        counters,
        chromBins,
        chromMaxPos,
      );
      leftover = res.remainder;
      if (res.sampleCount) sampleCount = res.sampleCount;
      offset += CHUNK_SIZE;

      const pct = Math.min(100, (offset / fileSize) * 100);
      setProgress(pct);
      liveStats(
        chromCounts,
        counters,
        offset,
        startTime,
        false,
        sampleCount,
        chromBins,
        chromMaxPos,
      );
      await tick();
    }

    // flush trailing line
    if (leftover.trim() && !abortRef.current) {
      const res = processLines(
        leftover + "\n",
        "",
        chromCounts,
        counters,
        chromBins,
        chromMaxPos,
      );
      // no-op: res.remainder ignored; capture sampleCount if needed
      if (res.sampleCount) sampleCount = res.sampleCount;
    }

    return {
      chromCounts,
      chromBins,
      chromMaxPos,
      counters,
      bytesProcessed: file.size,
      startTime,
      sampleCount,
    };
  };

  // ── .vcf.gz: slice COMPRESSED bytes → fflate Decompress ─────────────────────
  // fflate handles BGZF (concatenated gzip members) correctly; the browser's
  // native DecompressionStream only reads the first member then errors.

  const processGzip = async () => {
    const fileSize = file.size;
    let offset = 0;
    let leftover = "";
    let bytesDecompressed = 0;
    const chromCounts = {};
    const chromBins = {};
    const chromMaxPos = {};
    const counters = { total: 0, header: 0, data: 0 };
    const startTime = performance.now();
    const decoder = new TextDecoder();
    let sampleCount = 0;

    // fflate's Decompress callback fires synchronously inside push()
    let decompError = null;
    const decomp = new Decompress((chunk, final) => {
      bytesDecompressed += chunk.byteLength;
      const text = decoder.decode(chunk, { stream: !final });
      const res = processLines(
        text,
        leftover,
        chromCounts,
        counters,
        chromBins,
        chromMaxPos,
      );
      leftover = res.remainder;
      if (res.sampleCount) sampleCount = res.sampleCount;
    });

    while (offset < fileSize && !abortRef.current && !decompError) {
      while (pausedRef.current && !abortRef.current)
        await new Promise((r) => setTimeout(r, 100));
      if (abortRef.current) break;

      const buf = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      const isLast = offset + buf.byteLength >= fileSize;

      try {
        decomp.push(new Uint8Array(buf), isLast);
      } catch (e) {
        decompError = e;
        break;
      }

      offset += buf.byteLength;

      const pct = Math.min(100, (offset / fileSize) * 100);
      setProgress(pct);
      liveStats(
        chromCounts,
        counters,
        bytesDecompressed,
        startTime,
        true,
        sampleCount,
        chromBins,
        chromMaxPos,
      );
      await tick();
    }

    if (decompError) throw decompError;

    // flush any trailing text
    if (leftover.trim() && !abortRef.current) {
      const res = processLines(
        leftover + "\n",
        "",
        chromCounts,
        counters,
        chromBins,
        chromMaxPos,
      );
      // no-op: res.remainder ignored; capture sampleCount if needed
      if (res.sampleCount) sampleCount = res.sampleCount;
    }

    return {
      chromCounts,
      chromBins,
      chromMaxPos,
      counters,
      bytesProcessed: bytesDecompressed,
      startTime,
      sampleCount,
    };
  };

  // ── run ─────────────────────────────────────────────────────────────────────

  const run = async () => {
    if (!file) return;
    abortRef.current = false;
    pausedRef.current = false;
    setProcessing(true);
    setPaused(false);
    setProgress(0);
    setStats(null);

    try {
      const result = await (isGzipped ? processGzip() : processPlain());
      const elapsed = performance.now() - result.startTime;

      const longestMaxPos = Math.max(
        0,
        ...Object.values(result.chromMaxPos || {}),
      );
      let maxBinCount = 0;
      for (const bins of Object.values(result.chromBins || {})) {
        for (const v of Object.values(bins)) {
          if (v > maxBinCount) maxBinCount = v;
        }
      }

      setStats({
        ...result,
        elapsed,
        done: true,
        longestMaxPos,
        maxBinCount,
        binSize: POS_BIN_SIZE,
      });
      console.log(
        "bins:",
        result.chromBins && Object.keys(result.chromBins).length,
        "maxPos:",
        result.chromMaxPos,
      );
      setProgress(100);
    } catch (err) {
      setStats({ error: err.message });
    }
    setProcessing(false);
  };

  const liveStats = (
    chromCounts,
    counters,
    bytesProcessed,
    startTime,
    gz,
    sampleCount = 0,
    chromBins = {},
    chromMaxPos = {},
  ) => {
    // compute streaming derived stats
    const longestMaxPos = Math.max(0, ...Object.values(chromMaxPos || {}));

    let maxBinCount = 0;
    for (const bins of Object.values(chromBins || {})) {
      for (const v of Object.values(bins)) {
        if (v > maxBinCount) maxBinCount = v;
      }
    }
    setStats({
      chromCounts: { ...chromCounts },
      counters: { ...counters },
      bytesProcessed,
      elapsed: performance.now() - startTime,
      gz,
      done: false,
      sampleCount,
      chromBins,
      chromMaxPos,
      longestMaxPos,
      maxBinCount,
      binSize: POS_BIN_SIZE,
    });
  };

  const tick = () => new Promise((r) => setTimeout(r, 0));

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };
  const reset = () => {
    abortRef.current = true;
    setProcessing(false);
    setPaused(false);
    setProgress(0);
    setStats(null);
  };

  // ── chromosome sort ─────────────────────────────────────────────────────────
  const chromCounts = stats?.chromCounts || {};
  const sortedChroms = Object.keys(chromCounts).sort((a, b) => {
    const ca = chromCounts[a] || 0;
    const cb = chromCounts[b] || 0;
    if (cb !== ca) return cb - ca; // sort by count desc
    const n = (s) => parseInt(s.replace(/^chr/i, ""));
    const na = n(a),
      nb = n(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  const maxCount = sortedChroms.length
    ? Math.max(...sortedChroms.map((c) => chromCounts[c] || 0))
    : 0;

  const totalVariants = sortedChroms.reduce(
    (s, c) => s + (chromCounts[c] || 0),
    0,
  );

  // if (stats) {
  //   console.log(
  //     "VCF DBG stats:",
  //     "longestMaxPos=",
  //     stats.longestMaxPos,
  //     "chroms=",
  //     Object.keys(stats.chromBins || {}).length,
  //     "exampleChroms=",
  //     Object.keys(stats.chromBins || {}).slice(0, 5),
  //     "exampleBinsForFirst=",
  //     stats.chromBins?.[Object.keys(stats.chromBins || {})[0]] || {},
  //   );
  // }

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d1117",
        color: "#c9d1d9",
        padding: "2rem",
        fontFamily: "'JetBrains Mono','Fira Code',monospace",
        fontSize: "0.92rem",
      }}
    >
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <div
          style={{
            marginBottom: "2.5rem",
            borderBottom: "1px solid #21262d",
            paddingBottom: "1.5rem",
          }}
        >
          <h1
            style={{
              fontSize: "1.8rem",
              fontWeight: 700,
              color: "#58a6ff",
              letterSpacing: "-0.02em",
              margin: 0,
              marginBottom: "0.4rem",
            }}
          >
            VCF / VCF.GZ Processor
          </h1>
          <p style={{ color: "#8b949e", margin: 0, fontSize: "0.85rem" }}>
            Chromosome site counts · client-side · BGZF-aware via fflate
          </p>
        </div>

        {/* File picker */}
        <input
          type="file"
          accept=".vcf,.vcf.gz,.bgz"
          onChange={(e) => {
            setFile(e.target.files[0]);
            reset();
          }}
          style={{ display: "none" }}
          id="vcf-file"
        />
        <label
          htmlFor="vcf-file"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            padding: "1.25rem 1.5rem",
            background: "#161b22",
            border: "1px solid #30363d",
            borderRadius: "8px",
            cursor: "pointer",
            marginBottom: "1.5rem",
          }}
          onMouseOver={(e) => (e.currentTarget.style.borderColor = "#58a6ff")}
          onMouseOut={(e) => (e.currentTarget.style.borderColor = "#30363d")}
        >
          {file ? (
            isGzipped ? (
              <FileArchive size={20} color="#f0883e" />
            ) : (
              <FileText size={20} color="#58a6ff" />
            )
          ) : (
            <Upload size={20} color="#8b949e" />
          )}
          <div>
            <div style={{ color: file ? "#c9d1d9" : "#8b949e" }}>
              {file ? file.name : "Choose .vcf or .vcf.gz"}
            </div>
            {file && (
              <div
                style={{
                  color: "#8b949e",
                  fontSize: "0.8rem",
                  marginTop: "0.2rem",
                }}
              >
                {fmtBytes(file.size)}
                {isGzipped && (
                  <span style={{ color: "#f0883e", marginLeft: "0.75rem" }}>
                    BGZF · fflate decompression
                  </span>
                )}
              </div>
            )}
          </div>
        </label>

        {/* gz note */}
        {isGzipped && (
          <div
            style={{
              padding: "0.75rem 1.25rem",
              background: "#1c2128",
              border: "1px solid #f0883e44",
              borderRadius: "8px",
              color: "#8b949e",
              marginBottom: "1.25rem",
              fontSize: "0.82rem",
              lineHeight: "1.7",
            }}
          >
            <span style={{ color: "#f0883e", fontWeight: 600 }}>
              BGZF format detected.
            </span>{" "}
            A compressed VCF is read in 2 MB slices. The Progress bar tracks
            compressed bytes read, so you get a real % rather than an unknown
            spinner. A 230 MB .vcf.gz typically expands to ~1–2 GB; expect{" "}
            <span style={{ color: "#e6a700" }}>30–90 s</span> depending on CPU
            speed.
          </div>
        )}

        {/* Controls */}
        {file && (
          <div
            style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}
          >
            <button
              onClick={run}
              disabled={processing && !paused}
              style={btn("#238636", processing && !paused ? 0.45 : 1)}
            >
              <Play size={16} />
              {processing ? "Processing…" : "Run"}
            </button>
            {processing && (
              <>
                <button onClick={togglePause} style={btn("#9e6a03")}>
                  <Pause size={16} />
                  {paused ? "Resume" : "Pause"}
                </button>
                <button onClick={reset} style={btn("#b62324")}>
                  <RotateCcw size={16} />
                  Abort
                </button>
              </>
            )}
          </div>
        )}

        {/* Progress bar — always shows real %, even for gz */}
        {(processing || progress === 100) && (
          <div style={{ marginBottom: "1.5rem" }}>
            <div
              style={{
                background: "#21262d",
                borderRadius: "4px",
                height: "6px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: isGzipped
                    ? "linear-gradient(90deg,#f0883e,#e6a700)"
                    : "linear-gradient(90deg,#388bfd,#58a6ff)",
                  height: "100%",
                  width: `${progress}%`,
                  transition: "width 0.25s ease",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: "0.4rem",
                color: "#8b949e",
                fontSize: "0.8rem",
              }}
            >
              <span>
                {progress.toFixed(1)}% {paused ? "· paused" : ""}
              </span>
              {file && (
                <span>
                  {fmtBytes((progress / 100) * file.size)} /{" "}
                  {fmtBytes(file.size)} compressed
                </span>
              )}
            </div>
          </div>
        )}

        {/* Live stats */}
        {stats && !stats.error && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))",
                gap: "0.75rem",
                marginBottom: "1.5rem",
              }}
            >
              <StatCard
                label="Sample Count"
                value={(stats.sampleCount || 0).toLocaleString()}
              />
              <StatCard
                label="Data Lines"
                value={(stats.counters?.data || 0).toLocaleString()}
              />
              <StatCard
                label="Header Lines"
                value={(stats.counters?.header || 0).toLocaleString()}
              />
              <StatCard label="Chroms Found" value={sortedChroms.length} />
              {stats.gz && (
                <StatCard
                  label="Decompressed"
                  value={fmtBytes(stats.bytesProcessed)}
                  accent="#f0883e"
                />
              )}
              {stats.done ? (
                <>
                  <StatCard
                    label="Total Time"
                    value={fmtTime(stats.elapsed)}
                    accent="#3fb950"
                  />
                  <StatCard
                    label="Throughput"
                    value={`${(file.size / 1024 / 1024 / (stats.elapsed / 1000)).toFixed(1)} MB/s`}
                    accent="#3fb950"
                  />
                </>
              ) : (
                <StatCard
                  label="Elapsed"
                  value={fmtTime(stats.elapsed)}
                  accent="#f0883e"
                />
              )}
            </div>

            {/* Chromosome table */}
            {sortedChroms.length > 0 && (
              <div
                style={{
                  background: "#161b22",
                  border: "1px solid #30363d",
                  borderRadius: "8px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px 1fr 110px",
                    padding: "0.6rem 1rem",
                    background: "#21262d",
                    color: "#8b949e",
                    fontSize: "0.78rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  <span>Chromosome</span>
                  <span>Site Count and Histogram</span>
                  <span style={{ textAlign: "right" }}>Sites</span>
                </div>
                <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                  {sortedChroms.map((chrom) => {
                    const count = chromCounts[chrom] || 0;
                    const pct = maxCount > 0 ? count / maxCount : 0;
                    const denom = Math.max(1, stats?.longestMaxPos || 1);
                    const chromMax = stats?.chromMaxPos?.[chrom] || 0;
                    const rawBinCount = Math.max(
                      1,
                      Math.ceil(chromMax / (stats?.binSize || POS_BIN_SIZE)),
                    );
                    const binCount = Math.min(400, rawBinCount);
                    const bins = Array.from(
                      { length: binCount },
                      (_, i) => stats?.chromBins?.[chrom]?.[i] || 0,
                    );
                    const maxBin = Math.max(1, stats?.maxBinCount || 1);
                    const widthPct = (chromMax / denom) * 100;
                    const visibleWidthPct = Math.max(6, widthPct);
                    console.log(
                      "DBG plot",
                      chrom,
                      "widthPct=",
                      widthPct.toFixed(2),
                      "binCount=",
                      binCount,
                      "binsSample=",
                      bins.slice(0, 6),
                    );
                    return (
                      <div
                        key={chrom}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "140px 1fr 110px",
                          padding: "0.5rem 1rem",
                          alignItems: "center",
                          borderTop: "1px solid #21262d",
                        }}
                      >
                        <span style={{ color: "#79c0ff", fontWeight: 600 }}>
                          {chrom}
                        </span>
                        <div style={{ paddingRight: "1rem" }}>
                          <div
                            style={{
                              marginBottom: "6px",
                              height: "20px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${visibleWidthPct}%`,
                                display: "flex",
                                gap: "1px",
                                alignItems: "flex-end",
                                background: "transparent",
                              }}
                            >
                              {bins.map((b, i) => {
                                const barPx = Math.max(
                                  2,
                                  Math.round((b / maxBin) * 20),
                                );
                                return (
                                  <div
                                    key={i}
                                    style={{
                                      flex: 1,
                                      alignSelf: "flex-end",
                                      minWidth: "1px",
                                      height: `${barPx}px`,
                                      background: chromColor(chrom),
                                      borderRadius: "1px",
                                      opacity: 1,
                                    }}
                                  />
                                );
                              })}
                            </div>
                          </div>

                          <div
                            style={{
                              background: "#21262d",
                              borderRadius: "3px",
                              height: "7px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                background: chromColor(chrom),
                                height: "100%",
                                width: `${(pct * 100).toFixed(2)}%`,
                                transition: "width 0.4s ease",
                              }}
                            />
                          </div>
                        </div>
                        <span style={{ textAlign: "right" }}>
                          {count.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div
                  style={{
                    padding: "0.6rem 1rem",
                    background: "#21262d",
                    borderTop: "1px solid #30363d",
                    color: "#8b949e",
                    fontSize: "0.82rem",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>Total</span>
                  <span style={{ color: "#c9d1d9", fontWeight: 600 }}>
                    {totalVariants.toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {stats?.error && (
          <div
            style={{
              padding: "1rem 1.25rem",
              background: "#2d1117",
              border: "1px solid #f85149",
              borderRadius: "8px",
              color: "#f85149",
            }}
          >
            <strong>Error:</strong> {stats.error}
          </div>
        )}

        <style>{`::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#161b22}::-webkit-scrollbar-thumb{background:#30363d;border-radius:3px}`}</style>
      </div>
    </div>
  );
}

// ── tiny helpers ─────────────────────────────────────────────────────────────

function fmtBytes(b) {
  if (!b) return "0 B";
  const k = 1024,
    s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(2)} ${s[i]}`;
}

function fmtTime(ms) {
  if (!ms) return "—";
  const s = ms / 1000;
  return s < 60
    ? `${s.toFixed(2)}s`
    : `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
}

function btn(bg, opacity = 1) {
  return {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.6rem 1.2rem",
    background: bg,
    border: "none",
    borderRadius: "6px",
    color: "#fff",
    fontFamily: "inherit",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: opacity < 1 ? "not-allowed" : "pointer",
    opacity,
  };
}

function chromColor(chrom) {
  const c = chrom.replace(/^chr/i, "");
  const n = parseInt(c);
  if (!isNaN(n)) return `hsl(${(n * 15) % 360},60%,50%)`;
  if (c === "X") return "#f0883e";
  if (c === "Y") return "#79c0ff";
  return "#8b949e";
}

function StatCard({ label, value, accent = "#58a6ff" }) {
  return (
    <div
      style={{
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: "8px",
        padding: "1rem",
      }}
    >
      <div
        style={{
          color: "#8b949e",
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "0.5rem",
        }}
      >
        {label}
      </div>
      <div style={{ color: accent, fontSize: "1.4rem", fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}
