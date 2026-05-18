import * as Styles from "../styles/fastq-gene-finder-styles.jsx";
import { COLORS } from "../../styles/light-theme.js";

/* ============================================================
   COMPONENT: ProcessControls
============================================================ */
function fmtBytes(n) {
  if (n == null || isNaN(Number(n))) return "?";
  const v = Number(n);
  if (v >= 1e9) return (v / 1e9).toFixed(2) + " GB";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + " MB";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + " KB";
  return v + " B";
}

function fmtElapsed(ms) {
  if (!ms || ms < 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function ProcessControls({
  status,
  canProcess,
  onProcess,
  onPauseResume,
  onAbort,
  progress,
  keptCount,
  totalReads,
  elapsedMs,
  readsPerSec,
  workerCount,
  onWorkerCountChange,
  workerStates,
}) {
  const isAborted = status === "aborted";
  const isActive = status === "processing" || status === "paused";

  const fmtNumber = (n) => {
    if (n == null) return "?";
    const v = Number(n);
    return isNaN(v) ? "?" : v.toLocaleString();
  };

  return (
    <div style={{ ...Styles.panel, marginTop: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <button
          onClick={onProcess}
          disabled={!canProcess || status === "processing" || status === "paused"}
        >
          Process
        </button>

        {!isActive && (
          <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "0.25rem" }}>
            Workers:
            <input
              type="number"
              min={1}
              max={navigator.hardwareConcurrency || 16}
              value={workerCount}
              onChange={(e) =>
                onWorkerCountChange(
                  Math.max(1, Math.min(navigator.hardwareConcurrency || 16, Number(e.target.value) || 1)),
                )
              }
              style={{ width: "2.5rem" }}
              title="Parallel worker threads (1–8)"
            />
          </label>
        )}

        <button
          onClick={onPauseResume}
          disabled={!isActive}
        >
          {status === "paused" ? "Resume" : "Pause"}
        </button>
        <button onClick={onAbort} disabled={!isActive}>
          Abort
        </button>
        <span style={{ fontSize: "12px", color: COLORS.muted }}>Status: {status}</span>
      </div>

      {workerStates && workerStates.length > 0 && (
        <div style={{ display: "flex", gap: "6px", marginTop: "0.5rem", flexWrap: "wrap" }}>
          {workerStates.map((w) => (
            <div
              key={w.id}
              title={`Worker ${w.id + 1}: ${w.batchesDone} batches, ${w.matchesFound} matches`}
              style={{
                width: 46,
                padding: "4px 2px",
                borderRadius: 6,
                textAlign: "center",
                fontSize: 10,
                border: `1px solid ${COLORS.border}`,
                lineHeight: 1.3,
                background:
                  w.status === "processing"
                    ? COLORS.accent
                    : w.status === "done"
                      ? COLORS.success
                      : w.status === "error"
                        ? COLORS.error
                        : COLORS.surface,
                color:
                  w.status === "processing" || w.status === "done" || w.status === "error"
                    ? "#fff"
                    : COLORS.text,
              }}
            >
              <div style={{ fontWeight: 600 }}>W{w.id + 1}</div>
              <div>
                {w.status === "processing"
                  ? "▶"
                  : w.status === "done"
                    ? "✓"
                    : w.status === "error"
                      ? "!"
                      : "–"}
              </div>
              {w.matchesFound > 0 && (
                <div style={{ fontSize: 9, opacity: 0.85 }}>{w.matchesFound}m</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: "0.75rem",
          paddingTop: "0.5rem",
          borderTop: "1px solid #d7d7d7",
          fontSize: "12px",
          lineHeight: 1.6,
        }}
      >
        <div>
          <strong>File progress:</strong>{" "}
          {fmtBytes(progress?.done)} / {fmtBytes(progress?.total)}
          {progress?.total > 0 && progress?.done > 0 && (
            <span style={{ color: COLORS.muted, marginLeft: "0.5rem" }}>
              ({Math.min(100, Math.round((progress.done / progress.total) * 100))}%)
            </span>
          )}
        </div>
        <div>
          <strong>Reads:</strong> {fmtNumber(totalReads || 0)} processed |{" "}
          <strong>Kept:</strong> {fmtNumber(keptCount)}
          {totalReads > 0 && keptCount >= 0 && (
            <span style={{ color: COLORS.muted, marginLeft: "0.4rem" }}>
              ({Math.round((keptCount / totalReads) * 100)}%)
            </span>
          )}
        </div>
        {(elapsedMs > 0 || status === "done" || isAborted) && (
          <div>
            <strong>Elapsed:</strong>{" "}
            {fmtElapsed(elapsedMs)}
            {readsPerSec != null && (
              <span style={{ color: COLORS.muted, marginLeft: "0.75rem" }}>
                {fmtNumber(readsPerSec)} reads/s
              </span>
            )}
          </div>
        )}
        {isAborted && (
          <div style={{ color: COLORS.error }}>
            <strong>Processing aborted.</strong>
          </div>
        )}
      </div>
    </div>
  );
}
