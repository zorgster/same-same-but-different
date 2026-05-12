import React, { useState } from "react";

const Styles = {
  infoButton: {
    padding: "0.5rem 0.75rem",
    border: "1px solid #444",
    borderRadius: "8px",
    backgroundColor: "#f3f3f3",
    cursor: "pointer",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10, 12, 18, 0.72)",
    backdropFilter: "blur(4px)",
    zIndex: 1000,
    padding: "1rem",
  },
  modalCard: {
    position: "relative",
    width: "min(900px, 100%)",
    maxHeight: "80vh",
    overflowY: "auto",
    backgroundColor: "#fffdf7",
    color: "#1f1f1f",
    border: "2px solid #222",
    borderRadius: "14px",
    boxShadow: "0 18px 60px rgba(0, 0, 0, 0.35)",
    padding: "1.25rem 1.25rem 1rem",
    fontFamily: "monospace",
    lineHeight: 1.5,
  },
  modalCloseButton: {
    position: "absolute",
    top: "0.5rem",
    right: "0.5rem",
    width: "2rem",
    height: "2rem",
    border: "1px solid #444",
    borderRadius: "999px",
    backgroundColor: "#f3f3f3",
    color: "#111",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.1rem",
    lineHeight: 1,
  },
};

export default function MoreInfoWidget() {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
      }}
    >
      <button onClick={() => setShowInfo(true)} style={Styles.infoButton}>
        More Info
      </button>

      {showInfo && (
        <div
          style={{ ...Styles.modalOverlay }}
          onClick={() => setShowInfo(false)}
        >
          <div
            style={{ ...Styles.modalCard }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowInfo(false)}
              style={Styles.modalCloseButton}
              aria-label="Close"
            >
              x
            </button>

            <div style={{ paddingRight: "2rem" }}>
              This RNA-Seq Volcano Plotter is designed to help you quick-view
              and explore differential expression results from RNA-Seq
              experiments. You can drop in or upload your data in CSV or TSV
              format, and the tool will create an interactive volcano plot based
              on log2 fold change and adjusted p-values. Key features include:
              <ul>
                <li>
                  Dynamic point sizing and coloring based on significance and
                  fold change thresholds. [Colours are fixed for now, but may be
                  customizable in future versions.]
                </li>
                <li>
                  Interactive tooltips that show detailed information for each
                  gene when you hover over points.
                </li>
                <li>
                  If your data uses Ensembl Gene IDs, the top N most significant
                  genes will be labeled directly on the plot. [NB: This version
                  relies on Ensembl gene IDs for labeling, so if your data uses
                  different identifiers, labels may not appear correctly.]
                </li>
                <li>
                  The plot is resizable - change the size of the plot area using
                  the handle in the bottom right corner, and the plot will
                  automatically adjust to fit the new dimensions. [NB: Resizing
                  is supported, but may not be perfectly smooth or responsive in
                  all browsers or with very large datasets.] The width and
                  height shown is the export size.
                </li>
                <li>
                  Export your customized volcano plot as a high-resolution PNG
                  or JPG image for use in presentations or publications.
                </li>
                <li>
                  No software installation required — runs entirely in your web
                  browser using React and D3.js.
                </li>
              </ul>
              <br />
              <br />
              Plots produced by this tool have been compared against plots
              created using from EnhanceVolcano in R in my PhD thesis. The tool
              is still in early development, so if you encounter any issues or
              have suggestions for improvement, please let me know in the{" "}
              <a
                href="https://github.com/zorgster/same-same-but-different/discussions"
                target="_blank"
                rel="noopener noreferrer"
              >
                Discussion Forum
              </a>
              . [NB: This is an early version of the tool, so there may be bugs
              or limitations. Feedback is very welcome to help improve it!]
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "1rem",
              }}
            >
              <button onClick={() => setShowInfo(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
