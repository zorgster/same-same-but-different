import { COLORS, styles } from "../styles/vcf-header-reader-styles.jsx";
import FieldTypeTag from "./FieldTypeTag.jsx";
import ProducerChips from "./ProducerChips.jsx";

export default function InfoTab({ parsed, groupedInfo }) {
  if (!parsed?.info?.length) {
    return <div style={{ color: COLORS.muted, fontSize: 13 }}>None</div>;
  }

  return (
    <div>
      {parsed.annotationColumns?.length ? (
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          {parsed.annotationColumns.map((entry, idx) => (
            <div key={`${entry.source}-${entry.id}-${idx}`} style={styles.historyGreyBox}>
              <div style={{ ...styles.historySectionLabel, marginBottom: 8 }}>
                {entry.source} {entry.scope || "INFO"}/{entry.id} columns ({entry.columns.length || 0})
              </div>
              <div style={{ ...styles.mono, fontSize: 11, lineHeight: 1.6 }}>
                {entry.columns.length ? entry.columns.join(" | ") : "Format fields not parsed from Description."}
                {entry.linksToInfoTag ? ` (links to INFO/${entry.linksToInfoTag})` : ""}
                {entry.inferredFromHistory ? " (inferred from csq command --custom-tag)" : ""}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>ID</th>
              <th style={styles.th}>Type</th>
              <th style={styles.th}>Number</th>
              <th style={styles.th}>Description</th>
              <th style={{ ...styles.th, textAlign: "right" }}>Producers</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const rows = [];

              groupedInfo.core.forEach((f, i) => {
                rows.push(
                  <tr key={`core-${i}`}>
                    <td style={{ ...styles.td, ...styles.mono }}>{f.ID || ""}</td>
                    <td style={styles.td}><FieldTypeTag value={f.Type} /></td>
                    <td style={{ ...styles.td, ...styles.mono }}>{f.Number || ""}</td>
                    <td style={styles.td}>{f.Description || ""}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}><ProducerChips producers={f.producers} /></td>
                  </tr>
                );
              });

              if (groupedInfo.population.length > 0) {
                rows.push(
                  <tr key="population-divider">
                    <td
                      colSpan={5}
                      style={{
                        ...styles.td,
                        borderBottom: `2px solid ${COLORS.border}`,
                        background: "#edf3fb",
                        color: COLORS.muted,
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      Population annotation fields
                    </td>
                  </tr>
                );

                groupedInfo.population.forEach((f, i) => {
                  rows.push(
                    <tr key={`population-${i}`}>
                      <td style={{ ...styles.td, ...styles.mono }}>{f.ID || ""}</td>
                      <td style={styles.td}><FieldTypeTag value={f.Type} /></td>
                      <td style={{ ...styles.td, ...styles.mono }}>{f.Number || ""}</td>
                      <td style={styles.td}>{f.Description || ""}</td>
                      <td style={{ ...styles.td, textAlign: "right" }}><ProducerChips producers={f.producers} /></td>
                    </tr>
                  );
                });
              }

              if ((groupedInfo.core.length > 0 || groupedInfo.population.length > 0) && groupedInfo.other.length > 0) {
                rows.push(
                  <tr key="core-divider">
                    <td
                      colSpan={5}
                      style={{
                        ...styles.td,
                        borderBottom: `2px solid ${COLORS.border}`,
                        background: "#edf3fb",
                        color: COLORS.muted,
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      Other INFO fields
                    </td>
                  </tr>
                );
              }

              groupedInfo.other.forEach((f, i) => {
                rows.push(
                  <tr key={`other-${i}`}>
                    <td style={{ ...styles.td, ...styles.mono }}>{f.ID || ""}</td>
                    <td style={styles.td}><FieldTypeTag value={f.Type} /></td>
                    <td style={{ ...styles.td, ...styles.mono }}>{f.Number || ""}</td>
                    <td style={styles.td}>{f.Description || ""}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}><ProducerChips producers={f.producers} /></td>
                  </tr>
                );
              });

              return rows;
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
