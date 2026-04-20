import { COLORS, styles } from "../styles/vcf-header-reader-styles.jsx";
import ProducerChips from "./ProducerChips.jsx";

export default function FilterTab({ filters }) {
  if (!filters?.length) {
    return <div style={{ color: COLORS.muted, fontSize: 13 }}>None</div>;
  }

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>ID</th>
            <th style={styles.th}>Description</th>
            <th style={{ ...styles.th, textAlign: "right" }}>Producers</th>
          </tr>
        </thead>
        <tbody>
          {filters.map((f, i) => (
            <tr key={i}>
              <td style={{ ...styles.td, ...styles.mono }}>{f.ID || ""}</td>
              <td style={styles.td}>{f.Description || ""}</td>
              <td style={{ ...styles.td, textAlign: "right" }}><ProducerChips producers={f.producers} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
