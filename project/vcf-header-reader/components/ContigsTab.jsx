import { COLORS, styles } from "../styles/vcf-header-reader-styles.jsx";

export default function ContigsTab({ contigs }) {
  if (!contigs?.length) {
    return <div style={{ color: COLORS.muted, fontSize: 13 }}>None</div>;
  }

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Contig ID</th>
            <th style={styles.th}>Length (bp)</th>
            <th style={styles.th}>Other attributes</th>
          </tr>
        </thead>
        <tbody>
          {contigs.map((contig, index) => (
            <tr key={index}>
              <td style={{ ...styles.td, ...styles.mono }}>{contig.ID || ""}</td>
              <td style={{ ...styles.td, ...styles.mono }}>
                {contig.length ? Number(contig.length).toLocaleString() : ""}
              </td>
              <td style={styles.td}>
                {Object.entries(contig)
                  .filter(([key]) => key !== "ID" && key !== "length")
                  .map(([key, value]) => `${key}=${value}`)
                  .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}