import { COLORS, styles } from "../styles/vcf-header-reader-styles.jsx";
import ProducerChips from "./ProducerChips.jsx";

export default function OtherTab({ otherEntries }) {
  if (!otherEntries?.length) {
    return <div style={{ color: COLORS.muted, fontSize: 13 }}>None</div>;
  }

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Key</th>
            <th style={styles.th}>Value</th>
            <th style={{ ...styles.th, textAlign: "right" }}>Producers</th>
          </tr>
        </thead>
        <tbody>
          {otherEntries.map((entry, index) => {
            const raw = String(entry?.raw || "");
            const equalsIndex = raw.indexOf("=");
            const key = equalsIndex === -1 ? "(raw)" : raw.slice(0, equalsIndex);
            const value = equalsIndex === -1 ? raw : raw.slice(equalsIndex + 1);

            return (
              <tr key={index}>
                <td style={{ ...styles.td, ...styles.mono, color: COLORS.muted }}>{key}</td>
                <td style={{ ...styles.td, ...styles.mono }}>{value}</td>
                <td style={{ ...styles.td, textAlign: "right" }}><ProducerChips producers={entry.producers} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}