import { COLORS, styles } from "../styles/vcf-header-reader-styles.jsx";

export default function ColumnsTab({ columns, altEntries }) {
  const displayedColumns = Array.isArray(columns) ? columns : [];
  const displayedAltEntries = Array.isArray(altEntries) ? altEntries : [];

  if (!displayedColumns.length) {
    return <div style={{ color: COLORS.muted, fontSize: 13 }}>No column header line found</div>;
  }

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Position</th>
            <th style={styles.th}>Column</th>
            <th style={styles.th}>Role</th>
          </tr>
        </thead>
        <tbody>
          {displayedColumns.map((column, index) => (
            <tr key={`${column}-${index}`}>
              <td style={{ ...styles.td, ...styles.mono }}>{index + 1}</td>
              <td style={{ ...styles.td, ...styles.mono }}>{column}</td>
              <td style={styles.td}>Core VCF column</td>
            </tr>
          ))}
          {displayedAltEntries.length ? (
            <tr key="alt-divider">
              <td
                colSpan={3}
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
                ALT Entries
              </td>
            </tr>
          ) : null}
          {displayedAltEntries.map((entry, i) => (
            <tr key={`alt-${i}`}>
              <td style={{ ...styles.td, ...styles.mono }}>-</td>
              <td style={{ ...styles.td, ...styles.mono }}>{entry.ID || "-"}</td>
              <td style={styles.td}>{entry.Description || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}