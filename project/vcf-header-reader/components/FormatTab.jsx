import { COLORS, styles } from "../styles/vcf-header-reader-styles.jsx";
import FieldTypeTag from "./FieldTypeTag.jsx";
import ProducerChips from "./ProducerChips.jsx";

export default function FormatTab({ parsed, groupedFormat }) {
  if (!parsed?.format?.length) {
    return <div style={{ color: COLORS.muted, fontSize: 13 }}>None</div>;
  }

  return (
    <div>
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

              groupedFormat.core.forEach((f, i) => {
                rows.push(
                  <tr key={`core-format-${i}`}>
                    <td style={{ ...styles.td, ...styles.mono }}>{f.ID || ""}</td>
                    <td style={styles.td}><FieldTypeTag value={f.Type} /></td>
                    <td style={{ ...styles.td, ...styles.mono }}>{f.Number || ""}</td>
                    <td style={styles.td}>{f.Description || ""}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}><ProducerChips producers={f.producers} /></td>
                  </tr>
                );
              });

              if (groupedFormat.core.length > 0 && groupedFormat.other.length > 0) {
                rows.push(
                  <tr key="core-format-divider">
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
                      Other FORMAT fields
                    </td>
                  </tr>
                );
              }

              groupedFormat.other.forEach((f, i) => {
                rows.push(
                  <tr key={`other-format-${i}`}>
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
