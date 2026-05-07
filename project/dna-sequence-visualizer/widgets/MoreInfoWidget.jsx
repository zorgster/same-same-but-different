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
  const [showRestrictionInfo, setShowRestrictionInfo] = useState(false);
  const [showSpliceInfo, setShowSpliceInfo] = useState(false);

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

      <button
        onClick={() => setShowRestrictionInfo(true)}
        style={Styles.infoButton}
      >
        Restriction Enzymes
      </button>

      <button onClick={() => setShowSpliceInfo(true)} style={Styles.infoButton}>
        Splice Sites
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
              This DNA Sequence Visualizer is a React-based web application
              designed to help users explore and analyze DNA sequences. It
              provides a visual representation of DNA sequences and the
              translation of codons into amino acids, along with features for
              identifying restriction enzyme cut sites and potential splice
              sites. It is intended for educational and research purposes,
              allowing users to gain insights into the structure and function of
              DNA through an intuitive visual format.
              <br />
              <br />
              The gene lookup uses two Ensembl REST API endpoints, the first to
              lookup the Ensembl ID based on the gene symbol, and the second to
              retrieve the full gene DNA sequence.
              <br />
              <br />
              Alternatively, a user can input a raw DNA sequence (using the text
              area or file upload) to visualize any sequence of interest. The
              visualizer accepts .fa, .fasta, .txt files. [The visualizer is
              designed to handle sequences of moderate length (ideally up to a
              few hundred kilobases) for smooth performance in a browser.{" "}
              <strong>
                Longer sequences may lead to an unresponsive browser tab.
              </strong>
              ]
              <br />
              <br />
              The DNA sequence is displayed in a scrollable area (using
              navigation buttons), with each nucleotide represented by its
              letter (A, T, C, G). Below the sequence, there are three reading
              frames (RF+0, RF+1, RF+2) that show the translation of codons.
              <br />
              <br />
              Start and Stop Codons, Restriction Enzymes and Splice Sites are
              identified in the sequence with color-coded highlights. Hovering
              over these features will provide additional information such as
              the amino acid translation for codons, the enzyme name for
              restriction sites, and the splice site type and score for
              predicted splice sites.
              <br />
              <br />
              Below the sequence viewer is a table of features that lists the
              position, type, and details of each identified feature in the
              sequence. This allows users to easily see all the discovered
              elements in the DNA sequence and their locations. Clicking on a
              feature focusses the sequence viewer on that location for easy
              navigation.
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
      {showRestrictionInfo && (
        <div
          style={{ ...Styles.modalOverlay }}
          onClick={() => setShowRestrictionInfo(false)}
        >
          <div
            style={{ ...Styles.modalCard }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowRestrictionInfo(false)}
              style={Styles.modalCloseButton}
              aria-label="Close"
            >
              x
            </button>

            <div style={{ paddingRight: "2rem" }}>
              Restriction enzymes are proteins that recognize specific DNA
              sequences and cut the DNA at or near those sites. They are widely
              used in molecular biology for cloning, DNA mapping, and various
              types of DNA analysis. Each enzyme has a specific recognition
              sequence, which can be palindromic (the same forwards and
              backwards) or non-palindromic.
              <br />
              <br />
              Common examples include EcoRI (recognizes GAATTC), EcoRV
              (recognizes GATATC and cuts between the GAT and ATC), and HindIII
              (recognizes AAGCTT). When a restriction enzyme cuts DNA, it can
              create "sticky ends" with overhanging single-stranded DNA or
              "blunt ends" with no overhangs, depending on the enzyme's cutting
              pattern. These properties make restriction enzymes essential tools
              for genetic engineering and molecular cloning techniques.
              <br />
              <br />
              The restriction enzyme data is sourced from the REBASE database (
              <a
                href="https://rebase.neb.com/rebase/rebase.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                https://rebase.neb.com/rebase/rebase.html
              </a>
              ), which provides comprehensive information on restriction
              enzymes, including their recognition sequences and cutting
              patterns. The enzyme cut sites used are non-exhaustive and are
              intended for demonstration purposes. There are many more enzymes
              in the REBASE database that are not included in this visualizer.
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "1rem",
              }}
            >
              <button onClick={() => setShowRestrictionInfo(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showSpliceInfo && (
        <div
          style={{ ...Styles.modalOverlay }}
          onClick={() => setShowSpliceInfo(false)}
        >
          <div
            style={{ ...Styles.modalCard }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowSpliceInfo(false)}
              style={Styles.modalCloseButton}
              aria-label="Close"
            >
              x
            </button>

            <div style={{ paddingRight: "2rem" }}>
              Splice sites are specific sequences in pre-mRNA that signal where
              splicing should occur during the process of gene expression. In
              eukaryotic genes, the initial RNA transcript (pre-mRNA) contains
              both exons (coding regions) and introns (non-coding regions). The
              splice sites are located at the boundaries between exons and
              introns and are recognized by the spliceosome, a complex molecular
              machine responsible for removing introns and joining exons
              together to form mature mRNA.
              <br />
              <br />
              The two main types of splice sites are the 5' splice site (donor
              site) and the 3' splice site (acceptor site). The 5' splice site
              typically has a consensus sequence of "GU" at the beginning of the
              intron, while the 3' splice site usually has a consensus sequence
              of "AG" at the end of the intron. Additionally, there is often a
              branch point sequence located upstream of the 3' splice site that
              plays a crucial role in the splicing process.
              <br />
              <br />
              The DNA Sequence Visualizer [still in development] uses consensus
              splice site recognition sequences, as well as the
              Shapiro-Senapathy algorithm (SSA; 1987). The SSA uses a
              position-frequence matrix to score and rank potential splice sites
              in a bare DNA sequence, helping you identify where splicing might
              occur and how strong those sites are based on their sequence
              context. (Shapiro and Senapathy, 1987;{" "}
              <a
                href="https://doi.org/10.1093/nar/15.17.7155"
                target="_blank"
                rel="noopener noreferrer"
              >
                https://doi.org/10.1093/nar/15.17.7155
              </a>
              ). [The algorithm was developed long before the era of large
              genomic datasets and machine learning, but it remains a useful
              tool for understanding the sequence features that contribute to
              splice site recognition.]
              <br />
              <br />
              Wikipedia:{" "}
              <a
                href="https://en.wikipedia.org/wiki/Shapiro%E2%80%93Senapathy_algorithm"
                target="_blank"
                rel="noopener noreferrer"
              >
                https://en.wikipedia.org/wiki/Shapiro-Senapathy_algorithm
              </a>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "1rem",
              }}
            >
              <button onClick={() => setShowSpliceInfo(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
