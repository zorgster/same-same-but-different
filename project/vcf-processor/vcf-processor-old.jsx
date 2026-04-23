import React, { useState, useRef } from "react";
import {
  Upload,
  Play,
  Pause,
  RotateCcw,
  FileArchive,
  FileText,
  AlertTriangle,
} from "lucide-react";

const CHUNK_SIZE = 1024 * 1024;

export default function VCFProcessorApp() {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [decompressSupported] = useState(
    () => typeof DecompressionStream !== "undefined",
  );
  const [stats, setStats] = useState(null);

  const pausedRef = useRef(false);
  const abortRef = useRef(false);

  const isGzipped = file?.name?.endsWith(".gz") || file?.name?.endsWith(".bgz");

  const processPlain = async () => {
    const fileSize = file.size;
    let offset = 0;
    let leftover = "";
    const chromCounts = {};
    let totalLines = 0,
      headerLines = 0,
      dataLines = 0;
    const startTime = performance.now();

    while (offset < fileSize && !abortRef.current) {
      while (pausedRef.current && !abortRef.current)
        await new Promise((r) => setTimeout(r, 100));
      if (abortRef.current) break;

      const text = await file.slice(offset, offset + CHUNK_SIZE).text();
      const { lines, remainder } = splitLines(leftover + text);
      leftover = remainder;

      for (const line of lines) {
        totalLines++;
        if (line.startsWith("#")) {
          headerLines++;
          continue;
        }
        if (!line.trim()) continue;
        dataLines++;
        tallyChrom(line, chromCounts);
      }

      offset += CHUNK_SIZE;
      const pct = Math.min(100, (offset / fileSize) * 100);
      setProgress(pct);
      setStats({
        chromCounts: { ...chromCounts },
        totalLines,
        headerLines,
        dataLines,
        bytesProcessed: offset,
        elapsed: performance.now() - startTime,
        gz: false,
        done: false,
      });
      await new Promise((r) => setTimeout(r, 0));
    }

    if (leftover.trim() && !abortRef.current) {
      totalLines++;
      dataLines++;
      tallyChrom(leftover, chromCounts);
    }

    return {
      chromCounts,
      totalLines,
      headerLines,
      dataLines,
      bytesProcessed: file.size,
      startTime,
    };
  };

  const processGzip = async () => {
    const chromCounts = {};
    let totalLines = 0,
      headerLines = 0,
      dataLines = 0;
    let bytesDecompressed = 0;
    let leftover = "";
    const startTime = performance.now();
    const decoder = new TextDecoder();

    const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    let chunksSinceYield = 0;

    while (true) {
      while (pausedRef.current && !abortRef.current)
        await new Promise((r) => setTimeout(r, 100));
      if (abortRef.current) {
        reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      bytesDecompressed += value.byteLength;
      const text = decoder.decode(value, { stream: true });
      const { lines, remainder } = splitLines(leftover + text);
      leftover = remainder;

      for (const line of lines) {
        totalLines++;
        if (line.startsWith("#")) {
          headerLines++;
          continue;
        }
        if (!line.trim()) continue;
        dataLines++;
        tallyChrom(line, chromCounts);
      }

      chunksSinceYield++;
      if (chunksSinceYield >= 10) {
        setStats({
          chromCounts: { ...chromCounts },
          totalLines,
          headerLines,
          dataLines,
          bytesProcessed: bytesDecompressed,
          elapsed: performance.now() - startTime,
          gz: true,
          done: false,
        });
        await new Promise((r) => setTimeout(r, 0));
        chunksSinceYield = 0;
      }
    }

    const finalText = decoder.decode();
    if (finalText.trim()) {
      totalLines++;
      dataLines++;
      tallyChrom(finalText, chromCounts);
    }

    return {
      chromCounts,
      totalLines,
      headerLines,
      dataLines,
      bytesProcessed: bytesDecompressed,
      startTime,
    };
  };

  const run = async () => {
    if (!file) return;
    abortRef.current = false;
    pausedRef.current = false;
    setProcessing(true);
    setPaused(false);
    setProgress(0);
    setStats(null);

    try {
      const result = isGzipped ? await processGzip() : await processPlain();
      const elapsed = performance.now() - result.startTime;
      setStats({ ...result, done: true, elapsed });
      setProgress(100);
    } catch (err) {
      setStats({ error: err.message });
    }
    setProcessing(false);
  };

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

  const sortedChroms = stats?.chromCounts
    ? Object.keys(stats.chromCounts).sort((a, b) => {
        const n = (s) => parseInt(s.replace(/^chr/i, ""));
        const na = n(a),
          nb = n(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
      })
    : [];

  const totalVariants = sortedChroms.reduce(
    (s, c) => s + (stats?.chromCounts[c] || 0),
    0,
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d1117",
        color: "#c9d1d9",
        padding: "2rem",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
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
            Site counts per chromosome — client-side, no upload required
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
            marginBottom: "1rem",
            transition: "border-color 0.2s",
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
                {isGzipped &&
                  (decompressSupported ? (
                    <span style={{ color: "#3fb950", marginLeft: "0.75rem" }}>
                      ✓ DecompressionStream available
                    </span>
                  ) : (
                    <span style={{ color: "#f85149", marginLeft: "0.75rem" }}>
                      ✗ Browser not supported
                    </span>
                  ))}
              </div>
            )}
          </div>
        </label>

        {/* Unsupported browser warning */}
        {isGzipped && !decompressSupported && (
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              alignItems: "flex-start",
              padding: "1rem 1.25rem",
              background: "#2d1117",
              border: "1px solid #f8514933",
              borderRadius: "8px",
              color: "#f85149",
              marginBottom: "1rem",
              fontSize: "0.85rem",
            }}
          >
            <AlertTriangle
              size={18}
              style={{ flexShrink: 0, marginTop: "1px" }}
            />
            <div>
              Your browser doesn't support <code>DecompressionStream</code>. Try
              Chrome 80+, Firefox 113+, or Safari 16.4+. Alternatively,
              decompress to plain .vcf first (<code>bgzip -d file.vcf.gz</code>
              ).
            </div>
          </div>
        )}

        {/* Gz info */}
        {isGzipped && decompressSupported && (
          <div
            style={{
              padding: "0.75rem 1.25rem",
              background: "#1c2128",
              border: "1px solid #f0883e44",
              borderRadius: "8px",
              color: "#f0883e",
              marginBottom: "1rem",
              fontSize: "0.82rem",
              lineHeight: "1.7",
            }}
          >
            <strong>About .gz processing:</strong> Random slicing isn't possible
            on gzip — decompression must be sequential from byte 0. This tool
            pipes the file through the browser's native{" "}
            <code
              style={{
                background: "#0d1117",
                padding: "0.1rem 0.3rem",
                borderRadius: "3px",
              }}
            >
              DecompressionStream
            </code>
            , decompressing on the fly without loading the whole file into RAM.
            A 230 MB .vcf.gz typically expands to{" "}
            <strong style={{ color: "#e6a700" }}>1–2 GB</strong> uncompressed
            and will take roughly{" "}
            <strong style={{ color: "#e6a700" }}>30–90 seconds</strong> (vs 2–5
            s for plain .vcf). Progress shows decompressed MB, since the final
            uncompressed size is unknown until fully read.
          </div>
        )}

        {/* Controls */}
        {file && (!isGzipped || decompressSupported) && (
          <div
            style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}
          >
            <button
              onClick={run}
              disabled={processing && !paused}
              style={btn("#238636", processing && !paused ? 0.5 : 1)}
            >
              <Play size={16} /> {processing ? "Processing…" : "Run"}
            </button>
            {processing && (
              <>
                <button onClick={togglePause} style={btn("#9e6a03", 1)}>
                  <Pause size={16} /> {paused ? "Resume" : "Pause"}
                </button>
                <button onClick={reset} style={btn("#b62324", 1)}>
                  <RotateCcw size={16} /> Abort
                </button>
              </>
            )}
          </div>
        )}

        {/* Progress */}
        {processing && (
          <div style={{ marginBottom: "1.5rem" }}>
            {!isGzipped ? (
              <>
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
                      background: "linear-gradient(90deg, #388bfd, #58a6ff)",
                      height: "100%",
                      width: `${progress}%`,
                      transition: "width 0.3s ease",
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
                  <span>{progress.toFixed(1)}%</span>
                  {stats && (
                    <span>
                      {fmtBytes(stats.bytesProcessed)} / {fmtBytes(file.size)}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div
                style={{
                  color: "#8b949e",
                  fontSize: "0.85rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    animation: "spin 1s linear infinite",
                  }}
                >
                  ◌
                </span>
                Streaming &amp; decompressing…{" "}
                {stats && (
                  <strong style={{ color: "#f0883e" }}>
                    {fmtBytes(stats.bytesProcessed)} decompressed
                  </strong>
                )}
                {paused && <span style={{ color: "#e6a700" }}>(paused)</span>}
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        {stats && !stats.error && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                gap: "0.75rem",
                marginBottom: "1.5rem",
              }}
            >
              <StatCard
                label="Data Lines"
                value={(stats.dataLines || 0).toLocaleString()}
              />
              <StatCard
                label="Header Lines"
                value={(stats.headerLines || 0).toLocaleString()}
              />
              <StatCard label="Chroms Found" value={sortedChroms.length} />
              {stats.done ? (
                <>
                  <StatCard
                    label="Total Time"
                    value={fmtTime(stats.elapsed)}
                    accent="#3fb950"
                  />
                  <StatCard
                    label="Throughput"
                    value={`${(stats.bytesProcessed / 1024 / 1024 / (stats.elapsed / 1000)).toFixed(1)} MB/s`}
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
                  <span>Proportion</span>
                  <span style={{ textAlign: "right" }}>Sites</span>
                </div>
                <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                  {sortedChroms.map((chrom) => {
                    const count = stats.chromCounts[chrom];
                    const pct = totalVariants > 0 ? count / totalVariants : 0;
                    return (
                      <div
                        key={chrom}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "140px 1fr 110px",
                          padding: "0.55rem 1rem",
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
                              background: "#21262d",
                              borderRadius: "3px",
                              height: "8px",
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
            Error: {stats.error}
          </div>
        )}

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #161b22; } ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
        `}</style>
      </div>
    </div>
  );
}

function splitLines(text) {
  const lines = text.split("\n");
  const remainder = lines.pop() ?? "";
  return { lines, remainder };
}

function tallyChrom(line, counts) {
  const tab = line.indexOf("\t");
  if (tab > 0) {
    const ch = line.substring(0, tab);
    counts[ch] = (counts[ch] || 0) + 1;
  }
}

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
  if (s < 60) return `${s.toFixed(2)}s`;
  return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
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
    transition: "opacity 0.2s",
  };
}

function chromColor(chrom) {
  const c = chrom.replace(/^chr/i, "");
  const n = parseInt(c);
  if (!isNaN(n)) return `hsl(${(n * 15) % 360}, 60%, 50%)`;
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
