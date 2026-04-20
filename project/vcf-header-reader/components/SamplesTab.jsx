import { COLORS } from "../styles/vcf-header-reader-styles.jsx";

function detectSampleNamingPattern(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;

  const names = samples.map((s) => String(s || "")).filter(Boolean);
  if (names.length < 10) return null;

  const prefixMatch = names[0].match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    const withPrefix = names.filter((n) => n.startsWith(prefix));
    if (withPrefix.length / names.length > 0.7) {
      return { type: "prefix", value: prefix };
    }
  }

  const suffixMatch = names[0].match(/([a-zA-Z0-9_]+)$/);
  if (suffixMatch) {
    const suffix = suffixMatch[1];
    const withSuffix = names.filter((n) => n.endsWith(suffix));
    if (withSuffix.length / names.length > 0.7) {
      return { type: "suffix", value: suffix };
    }
  }

  return null;
}

function summarizeSamples(samples) {
  if (samples.length <= 40) return { mode: "all", samples };

  const pattern = detectSampleNamingPattern(samples);
  const randomCount = Math.min(40, samples.length);
  const randomIndices = new Set();

  while (randomIndices.size < randomCount) {
    randomIndices.add(Math.floor(Math.random() * samples.length));
  }

  const randomSamples = Array.from(randomIndices)
    .sort((a, b) => a - b)
    .map((i) => samples[i]);

  return {
    mode: "summary",
    pattern,
    total: samples.length,
    shown: randomSamples,
  };
}

export default function SamplesTab({ samples }) {
  if (!samples?.length) {
    return <div style={{ color: COLORS.muted, fontSize: 13 }}>No samples in header</div>;
  }

  const summary = summarizeSamples(samples);

  return (
    <div>
      {summary.mode === "summary" ? (
        <div
          style={{
            marginBottom: 12,
            borderRadius: 8,
            background: "#eaf2ff",
            border: `1px solid ${COLORS.border}`,
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 6 }}>
            <b style={{ color: COLORS.text }}>Total samples: {summary.total.toLocaleString()}</b>
            {summary.pattern ? (
              <div style={{ marginTop: 4, fontSize: 11 }}>
                Showing {summary.shown.length} samples (random sample)
                {summary.pattern.type === "prefix" && ` • Common prefix: ${summary.pattern.value}`}
                {summary.pattern.type === "suffix" && ` • Common suffix: ${summary.pattern.value}`}
              </div>
            ) : (
              <div style={{ marginTop: 4, fontSize: 11 }}>
                Showing {summary.shown.length} of {summary.total.toLocaleString()} samples
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(summary.mode === "all" ? summary.samples : summary.shown).map((sample, index) => (
          <span
            key={`${sample}-${index}`}
            style={{
              background: "#f3f7ff",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              padding: "3px 8px",
              fontSize: 12,
              fontFamily: "'DM Mono', 'Courier New', monospace",
            }}
          >
            {sample}
          </span>
        ))}
      </div>
    </div>
  );
}