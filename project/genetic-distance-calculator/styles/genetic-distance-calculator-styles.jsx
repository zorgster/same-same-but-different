export const styles = {
  card: {
    maxWidth: 1200,
    margin: "20px auto",
    padding: 20,
    border: "1px solid #dbe3ea",
    borderRadius: 14,
    background: "#ffffff",
  },

  grid: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    alignItems: "end",
  },

  pageGrid: {
    display: "grid",
    gap: 16,
    gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1fr)",
    alignItems: "start",
  },

  infoPanel: {
    border: "1px solid #dbe3ea",
    borderRadius: 12,
    background: "#f8fafc",
    padding: 14,
  },

  calculateButton: {
    appearance: "none",
    border: "1px solid #15803d",
    borderRadius: 10,
    background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
    color: "#ffffff",
    fontSize: 14,
    fontWeight: 800,
    padding: "10px 16px",
    boxShadow: "0 2px 0 rgba(15, 118, 110, 0.18)",
    cursor: "pointer",
  },

  dropZone: {
    border: "1px dashed #9fb6cf",
    borderRadius: 10,
    background: "#f7fbff",
    padding: "10px 12px",
    marginBottom: 14,
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },

  tableContainer: {
    marginTop: 16,
    border: "1px solid #dae4ee",
    borderRadius: 10,
    overflow: "auto",
    background: "#ffffff",
  },

  tablePager: {
    marginTop: 10,
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },

  tablePagerButton: {
    border: "1px solid #15803d",
    borderRadius: 10,
    background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 800,
    padding: "7px 12px",
    boxShadow: "0 2px 0 rgba(15, 118, 110, 0.18)",
    cursor: "pointer",
  },
};
