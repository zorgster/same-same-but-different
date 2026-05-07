import React, { useState } from "react";
import * as Styles from "../styles/fastq-gene-finder-styles.jsx";

export default function MoreInfoWidget() {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div>
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
              FASTQ Gene Finder is a tool for finding gene matches in FASTQ
              files using randomly generated sparse seed arrays, including
              start-, middle- and end-heavy seeds and whole length coverage
              seeds. Matches are scored by how many seed arrays they hit, and a
              pileup view allows visualizing the coverage of matching reads
              across the gene.
              <br />
              <br />
              The pile-up view (in development) can only be displayed if the
              processing has completed or is aborted.
              <br />
              <br />
              This approach is not faster than traditional aligners, but can be
              useful for a quick and visual exploratory analysis of FASTQ files
              without needing to install anything. It can handle large FASTQ.gz
              files in a streaming fashion without consuming large amounts of
              memory.
              <br />
              <br />
              1. Select a FASTQ or FASTQ.gz file (single-end or R1 of
              paired-end).
              <br />
              2. Enter a gene name to look up its sequence.
              <br />
              3. Click "Process" to find matching reads. You can pause/resume or
              abort the process while it's running.
              <br />
              4. View matching reads and their seed match patterns, and export
              results as CSV.
              <br />
              5. If processing is complete or aborted, view the pileup of
              matching reads across the gene. (Indevelopment: may not show all
              matches.)
              <br />
              <br />
              Note: Some DNA sequences are common or similar across many genes
              (e.g. conserved domains, poly-A tails, etc) and can lead to many
              spurious matches. Try BLASTing the gene sequence to find other
              genes that share similar sequences, and consider filtering those
              out of the FASTQ file before processing for a cleaner analysis.
              <br />
              <br />
              Note: this is a proof-of-concept implementation and is not
              designed for production use. It is designed to demonstrate (to
              learners) the concept of sparse seed-n-vote matching. While it is
              not fully optimised, some effort has been made to keep it
              responsive and memory-efficient even on large files, by using
              streaming file reading, pre-indexing the gene sequence for the
              seed arrays, and computing seed stats asynchronously in batches.
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
