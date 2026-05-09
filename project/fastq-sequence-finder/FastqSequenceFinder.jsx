import S from "./styles.jsx";

// ══════════════════════════════════════════════════════════════════════════════
//  READER WORKER  — one instance, reads + optionally decompresses, batches records
// ══════════════════════════════════════════════════════════════════════════════
const READER_SRC = `
let paused = false, resumeResolve = null;

self.onmessage = function(e) {
  const msg = e.data;
  if (msg.type === 'start')  run(msg).catch(err => self.postMessage({ type:'error', message:String(err) }));
  if (msg.type === 'pause')  { paused = true; }
  if (msg.type === 'resume') { paused = false; if (resumeResolve) { resumeResolve(); resumeResolve = null; } }
};

function waitResume() { return new Promise(r => { resumeResolve = r; }); }

async function run({ file, batchSize, isGz }) {
  const CHUNK = 16 * 1024 * 1024;
  let lineBuf = '', recLines = [], batch = [], recNum = 0;

  async function onLine(line) {
    recLines.push(line);
    if (recLines.length === 4) {
      batch.push({ header: recLines[0].slice(1), sequence: recLines[1], recNum: recNum++ });
      recLines = [];
      if (batch.length >= batchSize) {
        if (paused) await waitResume();
        self.postMessage({ type:'batch', records:batch });
        batch = [];
      }
    }
  }

  async function ingest(text) {
    lineBuf += text;
    let i;
    while ((i = lineBuf.indexOf('\\n')) !== -1) {
      await onLine(lineBuf.slice(0, i));
      lineBuf = lineBuf.slice(i + 1);
    }
  }

  if (isGz) {
    let ds;
    try { ds = new DecompressionStream('gzip'); }
    catch { self.postMessage({ type:'error', message:'DecompressionStream not supported in this browser.' }); return; }

    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const dec = new TextDecoder('utf-8', { fatal:false });

    // Feed compressed data concurrently; native stream backpressure throttles
    // the feeder whenever the consumer (below) is paused.
    const feed = (async () => {
      try {
        for (let off = 0; off < file.size; off += CHUNK) {
          const end = Math.min(off + CHUNK, file.size);
          await writer.write(new Uint8Array(await file.slice(off, end).arrayBuffer()));
          self.postMessage({ type:'progress', bytesRead:end, totalBytes:file.size });
        }
      } finally { await writer.close().catch(() => {}); }
    })();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await ingest(dec.decode(value, { stream:true }));
      }
    } finally { await feed; }
  } else {
    for (let off = 0; off < file.size; off += CHUNK) {
      const end = Math.min(off + CHUNK, file.size);
      await ingest(await file.slice(off, end).text());
      self.postMessage({ type:'progress', bytesRead:end, totalBytes:file.size });
    }
  }

  if (lineBuf.trim()) await onLine(lineBuf.trim());
  if (batch.length > 0) self.postMessage({ type:'batch', records:batch });
  self.postMessage({ type:'done', totalRecords:recNum });
}
`;

// ══════════════════════════════════════════════════════════════════════════════
//  SEARCH WORKER  — pool member, stays alive, handles one batch per message
// ══════════════════════════════════════════════════════════════════════════════
const SEARCH_SRC = `
self.onmessage = function(e) {
  const { workerId, batch, sequences } = e.data;
  const matches = [];
  for (const rec of batch) {
    const seq = rec.sequence;
    for (const t of sequences) {
      const idx = seq.indexOf(t);
      if (idx !== -1) { matches.push({ header:rec.header, sequence:seq, matchedSeq:t, offset:idx, recNum:rec.recNum }); break; }
    }
  }
  self.postMessage({ type:'result', workerId, matches, recordCount:batch.length });
};
`;

if (process.env.NODE_ENV === "development") {
  async function computeHash(script) {
    const encoder = new TextEncoder();
    const data = encoder.encode(script);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    console.debug(`SHA-256 hash for script: ${hashHex}`);
  }

  computeHash(READER_SRC);
  computeHash(SEARCH_SRC);
}

// ══════════════════════════════════════════════════════════════════════════════
//  Constants & helpers
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useRef, useEffect } from "react";

const BATCH_SIZE = 500,
  MAX_QUEUE = 20,
  MIN_QUEUE = 5;

function mkW(src) {
  const url = URL.createObjectURL(
    new Blob([src], { type: "application/javascript" }),
  );
  const w = new Worker(url);
  w._url = url;
  return w;
}
function killW(w) {
  w.terminate();
  URL.revokeObjectURL(w._url);
}

const fmtB = (b) =>
  b < 1024
    ? b + "B"
    : b < 1 << 20
      ? (b >> 10) + "KB"
      : b < 1 << 30
        ? (b / 1048576).toFixed(1) + "MB"
        : (b / 1073741824).toFixed(2) + "GB";
const fmt = (n) => (n ?? 0).toLocaleString();
const pct = (a, b) => (b ? Math.min(100, (a / b) * 100).toFixed(1) : "0.0");

// ══════════════════════════════════════════════════════════════════════════════
//  Component
// ══════════════════════════════════════════════════════════════════════════════
export default function FASTQSearcher() {
  // Allow up to 16, but honour the real core count if it's higher.
  // Floored at 16 so the control is always usable in sandboxed environments.
  const maxThreads = Math.max(16, navigator.hardwareConcurrency || 4);

  const [file, setFile] = useState(null);
  const [sequences, setSequences] = useState("ATCGATCG\nGCTAGCTA");
  const [threads, setThreads] = useState(2);
  const [drag, setDrag] = useState(false);

  const [running, setRunning] = useState(false);
  const [rdProg, setRdProg] = useState(null);
  const [qDepth, setQDepth] = useState(0);
  const [wStats, setWStats] = useState([]);
  const [topMatches, setTopMatches] = useState([]);
  const [totMatch, setTotMatch] = useState(0);
  const [totRec, setTotRec] = useState(0);
  const [elapsed, setElapsed] = useState(null);
  const [live, setLive] = useState("0.0");

  const readerRef = useRef(null);
  const swRef = useRef([]);
  const qRef = useRef([]);
  const idleRef = useRef(new Set());
  const rdDoneRef = useRef(false);
  const pausedRef = useRef(false);
  const seqsRef = useRef([]);
  const nwRef = useRef(0);
  const recRef = useRef(0);
  const matchRef = useRef([]);
  const t0Ref = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => () => teardown(), []);

  function teardown() {
    if (readerRef.current) {
      killW(readerRef.current);
      readerRef.current = null;
    }
    swRef.current.forEach(killW);
    swRef.current = [];
    clearInterval(timerRef.current);
    qRef.current = [];
    idleRef.current.clear();
    rdDoneRef.current = false;
    pausedRef.current = false;
    recRef.current = 0;
    matchRef.current = [];
  }

  function dispatch() {
    while (idleRef.current.size > 0 && qRef.current.length > 0) {
      const wid = [...idleRef.current][0];
      idleRef.current.delete(wid);
      const batch = qRef.current.shift();
      swRef.current[wid].postMessage({
        workerId: wid,
        batch,
        sequences: seqsRef.current,
      });
      setWStats((p) =>
        p.map((w, i) => (i === wid ? { ...w, active: true } : w)),
      );
    }
    const d = qRef.current.length;
    setQDepth(d);
    if (!pausedRef.current && d > MAX_QUEUE && readerRef.current) {
      readerRef.current.postMessage({ type: "pause" });
      pausedRef.current = true;
      setRdProg((p) => (p ? { ...p, paused: true } : p));
    } else if (pausedRef.current && d <= MIN_QUEUE && readerRef.current) {
      readerRef.current.postMessage({ type: "resume" });
      pausedRef.current = false;
      setRdProg((p) => (p ? { ...p, paused: false } : p));
    }
  }

  function checkDone() {
    if (
      rdDoneRef.current &&
      qRef.current.length === 0 &&
      idleRef.current.size === nwRef.current
    ) {
      clearInterval(timerRef.current);
      setElapsed(((performance.now() - t0Ref.current) / 1000).toFixed(2));
      setTotRec(recRef.current);
      setTotMatch(matchRef.current.length);
      setTopMatches(matchRef.current.slice(0, 200));
      setRunning(false);
    }
  }

  function startSearch() {
    if (!file || running) return;
    const seqs = sequences
      .split(/[\n,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!seqs.length) return;
    teardown();
    setRunning(true);
    setElapsed(null);
    setTopMatches([]);
    setTotMatch(0);
    setTotRec(0);
    setQDepth(0);
    setLive("0.0");
    setRdProg({ bytesRead: 0, total: file.size, done: false, paused: false });

    const n = threads;
    nwRef.current = n;
    seqsRef.current = seqs;
    setWStats(
      Array.from({ length: n }, (_, i) => ({
        id: i,
        active: false,
        records: 0,
        matches: 0,
      })),
    );
    Array.from({ length: n }, (_, i) => idleRef.current.add(i));

    swRef.current = Array.from({ length: n }, (_, wid) => {
      const w = mkW(SEARCH_SRC);
      w.onmessage = ({ data: { workerId, matches, recordCount } }) => {
        recRef.current += recordCount;
        matchRef.current.push(...matches);
        idleRef.current.add(workerId);
        setWStats((p) =>
          p.map((ws, i) =>
            i === workerId
              ? {
                  ...ws,
                  active: false,
                  records: ws.records + recordCount,
                  matches: ws.matches + matches.length,
                }
              : ws,
          ),
        );
        setTotRec(recRef.current);
        if (matches.length > 0) {
          setTotMatch(matchRef.current.length);
          setTopMatches(matchRef.current.slice(0, 200));
        }
        dispatch();
        checkDone();
      };
      return w;
    });

    const reader = mkW(READER_SRC);
    reader.onmessage = ({ data: msg }) => {
      if (msg.type === "batch") {
        qRef.current.push(msg.records);
        dispatch();
      }
      if (msg.type === "progress") {
        setRdProg((p) => ({
          ...p,
          bytesRead: msg.bytesRead,
          total: msg.totalBytes,
        }));
      }
      if (msg.type === "done") {
        rdDoneRef.current = true;
        setRdProg((p) => ({ ...p, done: true, paused: false }));
        checkDone();
      }
      if (msg.type === "error") {
        console.error("Reader:", msg.message);
        setRunning(false);
      }
    };
    readerRef.current = reader;

    t0Ref.current = performance.now();
    timerRef.current = setInterval(
      () => setLive(((performance.now() - t0Ref.current) / 1000).toFixed(1)),
      250,
    );
    reader.postMessage({
      type: "start",
      file,
      batchSize: BATCH_SIZE,
      isGz: file.name.endsWith(".gz"),
    });
  }

  const isGz = file?.name?.endsWith(".gz");

  return (
    <div style={S.root}>
      <header style={S.hdr}>
        <span style={S.logo}>
          <span style={S.lm}>FASTQ</span>
          <span style={S.la}>//SCAN</span>
        </span>
        <span style={S.sub}>
          1 reader · shared queue · {threads}-worker search pool
        </span>
      </header>

      <div style={S.body}>
        {/* ── Left panel ── */}
        <aside style={S.aside}>
          <Card label="INPUT FILE">
            <div
              style={{
                ...S.drop,
                ...(drag ? S.dropOn : {}),
                ...(file ? S.dropFull : {}),
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files[0];
                if (f) setFile(f);
              }}
            >
              {file ? (
                <div style={S.fileRow}>
                  <span style={S.fIco}>◈</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.fn}>{file.name}</div>
                    <div style={S.fm}>
                      {fmtB(file.size)} · {isGz ? "gzip" : "plaintext"}
                    </div>
                  </div>
                  <button
                    style={S.xBtn}
                    onClick={() => {
                      if (!running) setFile(null);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div style={S.dropHint}>
                  <div style={S.dIco}>⬇</div>
                  <div style={S.dTxt}>.fastq or .fastq.gz</div>
                  <label style={S.browse}>
                    browse
                    <input
                      type="file"
                      accept=".fastq,.gz,.fq"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files[0];
                        if (f) setFile(f);
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          </Card>

          <Card label="TARGET SEQUENCES">
            <textarea
              style={S.ta}
              value={sequences}
              onChange={(e) => setSequences(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={"ATCGATCG\nGCTAGCTA"}
            />
          </Card>

          {/* ── Thread control ── note: isGz does NOT restrict this anymore.
               The reader is always single-threaded; search workers parallelise
               regardless of whether the input is gz or plain FASTQ.            */}
          <Card label="SEARCH THREADS">
            <div style={S.tRow}>
              <Btn
                onClick={() => setThreads((c) => Math.max(1, c - 1))}
                disabled={running || threads <= 1}
              >
                −
              </Btn>
              <div style={S.tDisplay}>
                <span style={S.tNum}>{threads}</span>
                <span style={S.tSub}>of {maxThreads} available</span>
              </div>
              <Btn
                onClick={() => setThreads((c) => Math.min(maxThreads, c + 1))}
                disabled={running || threads >= maxThreads}
              >
                +
              </Btn>
            </div>
            <div style={S.coreBar}>
              {Array.from({ length: Math.min(maxThreads, 24) }, (_, i) => (
                <div
                  key={i}
                  style={{
                    ...S.core,
                    background:
                      i < threads ? "#00ff9d" : "rgba(255,255,255,0.06)",
                  }}
                />
              ))}
            </div>
            <div style={S.tnotes}>
              <span style={S.tn}>
                <span style={S.tnd} />1 reader{isGz ? " + decompress" : ""}
              </span>
              <span style={S.tn}>
                <span style={{ ...S.tnd, background: "#00ff9d" }} />
                {threads} search worker{threads !== 1 ? "s" : ""}
              </span>
              {isGz && (
                <span style={{ ...S.tn, color: "rgb(188, 191, 10)" }}>
                  ⚠ gz: reader is sequential;
                  <br />
                  searchers still parallelise
                </span>
              )}
            </div>
          </Card>

          <div>
            {running ? (
              <button
                style={S.cancelBtn}
                onClick={() => {
                  teardown();
                  setRunning(false);
                }}
              >
                ■ CANCEL
              </button>
            ) : (
              <button
                style={{
                  ...S.runBtn,
                  opacity: file ? 1 : 0.35,
                  cursor: file ? "pointer" : "not-allowed",
                }}
                onClick={startSearch}
                disabled={!file}
              >
                ▶ START SEARCH
              </button>
            )}
          </div>
        </aside>

        {/* ── Right panel ── */}
        <main style={S.main}>
          {(running || rdProg) && (
            <Card label="PIPELINE">
              <div style={S.pipe}>
                <PipeStage label={isGz ? "READER + DECOMP" : "READER"}>
                  <div style={S.barT}>
                    <div
                      style={{
                        ...S.barF,
                        width: rdProg
                          ? `${pct(rdProg.bytesRead, rdProg.total)}%`
                          : "0%",
                        background: rdProg?.done
                          ? "#00ff9d"
                          : rdProg?.paused
                            ? "#f5a623"
                            : "#00c97a",
                      }}
                    />
                  </div>
                  <div style={S.stInfo}>
                    {rdProg
                      ? `${fmtB(rdProg.bytesRead)} / ${fmtB(rdProg.total)}`
                      : "—"}
                    {rdProg?.done && " ✓"}
                    {rdProg?.paused && " ⏸ throttled"}
                    {isGz && (
                      <span
                        style={{
                          color: "rgba(180,200,192,0.3)",
                          marginLeft: 4,
                        }}
                      >
                        (compressed bytes)
                      </span>
                    )}
                  </div>
                </PipeStage>

                <div style={S.arrow}>→</div>

                <PipeStage label={`QUEUE  ${qDepth}/${MAX_QUEUE}`}>
                  <div style={S.qGrid}>
                    {Array.from({ length: MAX_QUEUE }, (_, i) => (
                      <div
                        key={i}
                        style={{
                          ...S.qCell,
                          background:
                            i < qDepth
                              ? qDepth >= MAX_QUEUE - 2
                                ? "#ff6060"
                                : "#f5a623"
                              : "rgba(255,255,255,0.05)",
                        }}
                      />
                    ))}
                  </div>
                  <div style={S.stInfo}>{BATCH_SIZE} reads/batch</div>
                </PipeStage>

                <div style={S.arrow}>→</div>

                <PipeStage label="SEARCH WORKERS">
                  <div style={S.wGrid}>
                    {wStats.map((ws) => (
                      <div
                        key={ws.id}
                        style={{
                          ...S.wCard,
                          borderColor: ws.active
                            ? "rgba(0,255,157,0.45)"
                            : "rgba(255,255,255,0.1)",
                          background: ws.active
                            ? "rgba(0,255,157,0.07)"
                            : "rgba(255,255,255,0.02)",
                        }}
                      >
                        <div style={S.wTop}>
                          <span style={S.wId}>W{ws.id}</span>
                          <div
                            style={{
                              ...S.wDot,
                              background: ws.active
                                ? "#00ff9d"
                                : "rgba(255,255,255,0.18)",
                            }}
                          />
                        </div>
                        <div style={S.wRec}>{fmt(ws.records)}</div>
                        <div style={S.wHit}>
                          {ws.matches > 0 ? (
                            `▲${fmt(ws.matches)}`
                          ) : (
                            <span style={{ opacity: 0.22 }}>—</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </PipeStage>
              </div>

              <div style={S.ctrs}>
                <Ctr v={`${elapsed ?? live}s`} l="elapsed" />
                <Ctr v={fmt(totRec)} l="reads processed" />
                <Ctr v={fmt(totMatch)} l="matches" />
              </div>
            </Card>
          )}

          {(topMatches.length > 0 || (!running && elapsed !== null)) && (
            <Card label="RESULTS">
              <div style={S.sumRow}>
                <Stat n={fmt(totMatch)} l="matches" />
                <div style={S.sdiv} />
                <Stat n={fmt(totRec)} l="reads scanned" />
                <div style={S.sdiv} />
                <Stat n={`${elapsed}s`} l="total time" />
              </div>
              {topMatches.length > 0 ? (
                <div style={S.mList}>
                  {topMatches.map((m, i) => (
                    <div key={i} style={S.mCard}>
                      <div style={S.mHdr}>
                        @{m.header} · read {fmt(m.recNum)}
                      </div>
                      <div style={S.mSeq}>
                        {hlMatch(m.sequence, m.matchedSeq)}
                      </div>
                      <div style={S.mTag}>
                        hit: <b style={{ color: "#00ff9d" }}>{m.matchedSeq}</b>{" "}
                        · offset {m.offset}
                      </div>
                    </div>
                  ))}
                  {totMatch > 200 && (
                    <div style={S.trunc}>
                      … {fmt(totMatch - 200)} more matches not shown
                    </div>
                  )}
                </div>
              ) : (
                <div style={S.noMatch}>
                  No sequences matched in {fmt(totRec)} reads.
                </div>
              )}
            </Card>
          )}

          {!running && !rdProg && (
            <div style={S.empty}>
              <div style={S.eIco}>⬡</div>
              <div style={S.eTxt}>
                Drop a FASTQ file, enter target sequences, set thread count, hit
                start.
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Card({ label, children }) {
  return (
    <section style={S.card}>
      <div style={S.cLbl}>{label}</div>
      {children}
    </section>
  );
}
function Btn({ onClick, disabled, children }) {
  return (
    <button
      style={{
        ...S.tBtn,
        opacity: disabled ? 0.3 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function PipeStage({ label, children }) {
  return (
    <div style={S.stage}>
      <div style={S.stLbl}>{label}</div>
      {children}
    </div>
  );
}
function Ctr({ v, l }) {
  return (
    <div style={S.ctr}>
      <span style={S.ctrV}>{v}</span>
      <span style={S.ctrL}>{l}</span>
    </div>
  );
}
function Stat({ n, l }) {
  return (
    <div style={S.stat}>
      <div style={S.sN}>{n}</div>
      <div style={S.sL}>{l}</div>
    </div>
  );
}
function hlMatch(seq, target) {
  const i = seq.indexOf(target);
  if (i === -1) return <span style={S.seqT}>{seq}</span>;
  return (
    <span style={S.seqT}>
      {seq.slice(0, i)}
      <mark style={S.seqH}>{seq.slice(i, i + target.length)}</mark>
      {seq.slice(i + target.length)}
    </span>
  );
}
