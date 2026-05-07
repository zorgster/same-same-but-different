import * as Styles from "../styles/fastq-gene-finder-styles.jsx";

/* ============================================================
   COMPONENT: ProcessControls
============================================================ */
export default function ProcessControls({
  status,
  canProcess,
  onProcess,
  onPauseResume,
  onAbort,
  progress,
  keptCount,
  discardedCount,
}) {
  const isAborted = status === "aborted";

  const fmtNumber = (n) =>
    n === null || n === undefined ? "?" : Number(n).toLocaleString();

  return (
    <div style={{ ...Styles.panel, marginTop: "1rem" }}>
      <button
        onClick={onProcess}
        disabled={!canProcess || status === "processing" || status === "paused"}
      >
        Process
      </button>
      <button onClick={onPauseResume} disabled={status === "idle"}>
        {status === "paused" ? "Resume" : "Pause"}
      </button>
      <button onClick={onAbort} disabled={status === "idle"}>
        Abort
      </button>
      <span style={{ marginLeft: "1rem" }}>Status: {status}</span>

      <div
        style={{
          marginTop: "0.75rem",
          paddingTop: "0.5rem",
          borderTop: "1px solid #d7d7d7",
          fontSize: "12px",
          lineHeight: 1.4,
        }}
      >
        <div>
          <strong>Progress (bytes):</strong> {fmtNumber(progress?.done || 0)} /{" "}
          {fmtNumber(progress?.total || "?")}
        </div>
        <div>
          <strong>Kept:</strong> {fmtNumber(keptCount)} |{" "}
          <strong>Discarded:</strong> {fmtNumber(discardedCount)}
        </div>
        {isAborted && (
          <div>
            <strong>Processing aborted.</strong>
          </div>
        )}
      </div>
    </div>
  );
}
