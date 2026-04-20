import { useEffect, useState } from "react";
import { COLORS, TONES, styles } from "../styles/vcf-header-reader-styles.jsx";

function formatOptionHeader(option, fallbackIndex) {
  const key = String(option?.key || "").trim();
  if (!key) return `Argument ${fallbackIndex + 1}`;

  if (option?.source === "derived") {
    const cleaned = key.replace(/^-+/, "").replace(/-/g, " ").trim();
    return cleaned || `Argument ${fallbackIndex + 1}`;
  }

  return key;
}

function formatOptionValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "true";
  if (value === "") return '""';
  return String(value);
}

function isNullLikeOptionValue(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  return trimmed === "" || trimmed === "null" || trimmed === "[]";
}

function getHistoryTone(family) {
  const normalized = String(family || "other").toLowerCase();
  const map = {
    gatk: TONES.violet,
    bcftools: TONES.blue,
    freebayes: TONES.teal,
    picard: TONES.amber,
    samtools: TONES.green,
    snpeff: TONES.rose,
    other: TONES.blue,
  };

  return map[normalized] || TONES.blue;
}

export default function HistoryTab({ history }) {
  const [expandedHistoryCards, setExpandedHistoryCards] = useState(() => new Set());

  useEffect(() => {
    setExpandedHistoryCards(new Set());
  }, [history]);

  const toggleHistoryCard = (cardKey) => {
    setExpandedHistoryCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardKey)) next.delete(cardKey);
      else next.add(cardKey);
      return next;
    });
  };

  if (!history?.length) {
    return <div style={{ color: COLORS.muted, fontSize: 13 }}>No command history found in this header.</div>;
  }

  return (
    <div>
      {history.map((h, i) => (
        <div key={`${h.tool}-${i}`} style={styles.historyCard(getHistoryTone(h.family))}>
          {(() => {
            const cardKey = `${h.tool}-${i}`;
            const isExpanded = expandedHistoryCards.has(cardKey);
            const normalOptions = (h.options || []).filter(
              (option) => option.source === "derived" || !isNullLikeOptionValue(option.value)
            );
            const nullOptionKeys = (h.options || [])
              .filter((option) => option.source !== "derived" && isNullLikeOptionValue(option.value))
              .map((option) => option.key)
              .filter(Boolean);

            return (
              <>
                <button
                  type="button"
                  onClick={() => toggleHistoryCard(cardKey)}
                  style={styles.historyToggleButton}
                >
                  <div style={styles.historyHeaderRow}>
                    <div>
                      <div style={styles.historyTitle}>{h.tool}</div>
                      <div style={styles.historySubline}>
                        {h.id ? `ID: ${h.id}` : h.key ? `Header: ${h.key}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
                      {h.family ? <span style={styles.historyBadge(getHistoryTone(h.family))}>{h.family}</span> : null}
                      {h.version ? (
                        <span style={styles.historyBadge(TONES.amber)}>
                          {/^v/i.test(String(h.version)) ? h.version : `v${h.version}`}
                        </span>
                      ) : null}
                      {h.date ? <span style={styles.historyBadge(TONES.blue)}>{h.date}</span> : null}
                      {h.epoch ? <span style={styles.historyBadge(TONES.teal)}>Epoch: {h.epoch}</span> : null}
                      <span style={styles.historyBadge(TONES.blue)}>{isExpanded ? "Hide" : "Show"}</span>
                    </div>
                  </div>
                </button>

                {isExpanded && h.options.length ? (
                  <div style={styles.historySection}>
                    <div style={styles.historySectionLabel}>{String(h.key || "").toLowerCase() === "vep" ? "VEP metadata" : "Command options"}</div>
                    {normalOptions.length ? (
                      <div style={styles.historyOptionsGrid}>
                        {normalOptions.map((option, optionIndex) => (
                          <div key={`${option.key}-${optionIndex}`} style={styles.historyOption}>
                            <div style={styles.historyOptionKey}>{formatOptionHeader(option, optionIndex)}</div>
                            <div style={styles.historyOptionValue}>{formatOptionValue(option.value)}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {nullOptionKeys.length ? (
                      <div style={styles.nullOptionsBox}>
                        <div style={styles.nullOptionsTitle}>NULL OPTIONS</div>
                        <div style={styles.nullOptionsText}>{nullOptionKeys.join(", ")}</div>
                      </div>
                    ) : null}

                    {h.commandLineOptions ? (
                      <div style={styles.historySection}>
                        <div style={styles.historySectionLabel}>CommandLineOptions (raw text)</div>
                        <div style={styles.codeBlock}>{h.commandLineOptions}</div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {isExpanded && h.structuredExtras.length ? (
                  <div style={styles.historySection}>
                    <div style={styles.historySectionLabel}>Other fields</div>
                    <div style={styles.historyGreyBox}>
                      {h.structuredExtras.map((field, fieldIndex) => (
                        <div
                          key={`${field.field}-${fieldIndex}`}
                          style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            marginBottom: fieldIndex === h.structuredExtras.length - 1 ? 0 : 6,
                          }}
                        >
                          <span style={{ ...styles.mono, color: COLORS.muted, minWidth: 110 }}>{field.field}</span>
                          <span style={{ ...styles.mono, color: COLORS.text, wordBreak: "break-word" }}>{field.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {isExpanded && (h.commandLine || (h.command && !h.commandLineOptions)) ? (
                  <div style={styles.historySection}>
                    <div style={styles.historySectionLabel}>{h.commandLine ? "Command line" : "Command"}</div>
                    <div style={styles.codeBlock}>{h.commandLine || h.command}</div>
                  </div>
                ) : null}
              </>
            );
          })()}
        </div>
      ))}
    </div>
  );
}
