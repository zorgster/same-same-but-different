import React, { useState } from "react";
import * as Styles from "../styles/fastq-gene-finder-styles.jsx";

export default function MoreInfoWidget() {
  const [showInfo, setShowInfo] = useState(false);
  const [showFastqInfo, setShowFastqInfo] = useState(false);

  return (
    <div>
      <button onClick={() => setShowInfo(true)} style={Styles.infoButton}>
        More Info
      </button>

      <button
        onClick={() => setShowFastqInfo(true)}
        style={{ ...Styles.infoButton, marginLeft: "1rem" }}
      >
        FASTQ Info
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
              seeds. The tool can handle both single- and paired-end DNA or RNA
              sequences, and is both gene- and transcript- aware.
              <br />
              <br />
              Features:
              <br />
              - Randomly generated sparse seed arrays for efficient matching.
              <br />
              - Save and load seed arrays for reproducibility and consistency
              across runs.
              <br />
              - DNA Mode: matches reads against the gene sequence.
              <br />
              - RNA Mode: splice-aware; matches reads against the gene sequence
              and all known transcripts (from Ensembl).
              <br />
              - Paired-end support: matches read pairs against the gene and
              transcripts, with separate seed arrays for each read and a
              combined scoring system.
              <br />
              - Asynchronous, multi-worker parallelised processing with
              pause/resume and abort functionality for responsive UI even on
              large files.
              <br />
              - For small RNA-Seq FASTQ files (&lt; 2x 520MB) and a gene with
              &lt; 30,000 bases and 36 transcripts, the completed results are
              displayed in ~1 minute - reaching a rate of around 300,000 reads
              per second. (2x 2.49GB - in ~ 5-6 minutes) (on an entry level
              laptop). Larger files and genes could slow down as resources
              become used up.
              <br />
              - Export matched reads as CSV.
              <br />
              - Coverage overview of matching reads across the gene.
              <br />
              - A paged pile-up view of matching reads across the gene.
              <br />
              - PDF Export of results and visualisations. For RNA, this includes
              a visualisation of the gene structure (exons and introns) and
              transcripts. Also, per-transcript views that show matches that
              support the exon-exon junctions of each transcript, which can help
              identify which transcripts are supported by the reads in the FASTQ
              file.
              <br />
              <br />
              IMPORTANT NOTE: This in-browser tool is designed for quick and
              visual exploratory analysis of FASTQ files, and is not intended to
              be a comprehensive or fully accurate tool for finding all gene
              matches in a FASTQ file. It uses a local sparse seed-n-vote
              approach, which is a heuristic method that can be fast and
              efficient, but may not find all matches or may produce some false
              positives, especially if the gene sequence is common or has many
              similar sequences in the FASTQ file. (Some of these issues may be
              addressed in the future downloadable Rust version of the tool.)
              <br />
              <br />
              Blindspots:
              <br />
              - INDELs: Sequences containing indels relative to the reference
              gene may not be found, because the seed arrays are generated based
              on the reference gene sequence and do not account for indels.
              <br />
              - Splice variants: In RNA mode, reads that support splice variants
              that are not included in the known transcripts from Ensembl may
              not be found, because the tool only matches against the reference
              gene sequence and known transcripts, and does not attempt to
              discover novel splice variants.
              <br />
              - Low-quality reads: Reads with low-quality scores may produce
              false positives or false negatives, because this seed-n-vote
              approach does not take quality scores into account when matching
              reads to the gene.
              <br />
              <br />
              The pile-up view can only be displayed if the processing has
              completed or is aborted. Bases that differ from the gene sequence
              are highlighted. Paired reads are separated by a tilde symbol (~).
              In RNA mode, spliced reads are divided using an equals symbol (=).
              The pile-up view is paged for performance.
              <br />
              <br />
              Usage:
              <br />
              <br />
              1. Select a FASTQ or FASTQ.gz file (Select or drop R1 or both R1
              and R2 on the dropzone).
              <br />
              2. Select DNA or RNA mode.
              <br />
              3. Enter a gene name to look up its sequence.
              <br />
              4. Inspect the Seeds tab to see the randomly generated seed
              arrays, and save them if you want to use the same seeds for
              another run (e.g. with a different FASTQ file or gene). Or load
              previously saved seeds to use the same seed arrays as a previous
              run, for consistency and reproducibility across runs.
              <br />
              5. Select the number of workers to use for processing.
              <br />
              6. Select the minimum percentage of seeds that must match for a
              read to be considered a match (e.g. 80% means that at least 80% of
              the seeds must match). In RNA mode, if a high percentage is
              selected, then more reads will be tested against the transcripts,
              which can increase processing time but may give more accurate
              results.
              <br />
              7. Click "Process" to find matching reads. You can pause/resume or
              abort the process while it's running.
              <br />
              8. View matching reads and their seed match patterns in the
              Matched Reads tab, and export results as CSV.
              <br />
              9. If processing is complete or aborted, view the coverage and
              pileup of matching reads across the gene in the Pileup tab, and
              export a PDF report of results and visualisations.
              <br />
              <br />
              Note: Some DNA sequences are common or similar across many genes
              (e.g. conserved domains, poly-A tails, etc) and can lead to many
              spurious matches. Try BLASTing the gene sequence to find other
              genes that share similar sequences, and consider filtering those
              out of the FASTQ file before processing for a cleaner analysis.
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

      {showFastqInfo && (
        <div
          style={{ ...Styles.modalOverlay }}
          onClick={() => setShowFastqInfo(false)}
        >
          <div
            style={{ ...Styles.modalCard }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowFastqInfo(false)}
              style={Styles.modalCloseButton}
              aria-label="Close"
            >
              x
            </button>

            <div style={{ paddingRight: "2rem" }}>
              FASTQ files were developed in the 2000s as an extension of the
              earlier FASTA format, which had been created in the 1980s as a
              simple text-based format for storing nucleotide sequences. FASTA
              files consist of a header line starting with "&gt;", followed by
              one or more sequence lines, and are commonly used in
              bioinformatics for storing and sharing nucleotide or protein
              sequences. FASTQ extended this by adding quality scores output
              during sequencing for each base in the sequence. A FASTQ file
              consists of four lines per read: a header line starting with "@",
              a sequence line, a "+" line (which can optionally repeat the
              header), and a quality score line. Originally this involved a
              single long line for the sequence and quality scores, but in
              practice many FASTQ files break these into multiple lines for
              readability, as long as the sequence and quality scores are in the
              correct order and correspond to each other. FASTQ files produced
              in short-read sequencing will usually have short lines of around
              70-150 bases, while long-read sequencing FASTQ files may have much
              longer lines or even single lines for the whole read.
              <br />
              <br />
              Example of a FASTQ entry:
              <br />
              <br />
              <span style={{ marginLeft: "2rem" }}>@SEQ_ID</span>
              <br />
              <span style={{ marginLeft: "2rem" }}>
                GATTTGGGGTTCAAAGCAGTATCGATCAAATAGTAAATTTGCCAAA
              </span>
              <br />
              <span style={{ marginLeft: "2rem" }}>+</span>
              <br />
              <span style={{ marginLeft: "2rem" }}>
                !''*((((***+))%%%++)(%%%%).1***-+*''))**55CCFA
              </span>
              <br />
              <br />
              The header line can contain various metadata about the read, such
              as its identifier, sequencing run information, and more. The
              sequence line contains the nucleotide sequence of the read. The
              quality score line encodes the quality of each base in the
              sequence using ASCII characters, corresponding to the probability
              of a base call being incorrect. The exact encoding can vary (e.g.
              Phred+33 or Phred+64), but in general higher quality scores
              correspond to more reliable base calls.
              <br />
              <br />
              [Note: Quality scores can be converted to error probabilities
              using the formula:
              <span style={{ marginLeft: "2rem" }}>P(error) = 10^(-Q/10)</span>
              <br />
              but when processing very large FASTQ files, it is often more
              efficient to precalculate probabilities and use lookup tables
              rather than converting quality scores on the fly.]
              <br />
              <br />
              FASTQ files are commonly used in bioinformatics for storing raw
              sequencing data, and many tools exist for processing and analyzing
              them. However, due to their size, they can be challenging to work
              with, especially for large datasets. Tools that can efficiently
              stream and process FASTQ files without loading them entirely into
              memory can be very useful for exploratory analysis and quick
              lookups.
              <br />
              <br />
              Types of FASTQ:
              <br />
              <span style={{ marginLeft: "2rem" }}>
                - Single-end FASTQ: contains reads from a single end of a
                sequencing run.
              </span>
              <br />
              <span style={{ marginLeft: "2rem" }}>
                - Paired-end FASTQ: contains reads from both ends of a
                sequencing run, typically with R1 and R2 files.
              </span>
              <br />
              <span style={{ marginLeft: "2rem" }}>
                - Long-read FASTQ: contains reads from long-read sequencing
                technologies, which may have much longer sequences and quality
                score lines. (Not suitable for this tool.)
              </span>
              <br />
              <span style={{ marginLeft: "2rem" }}>
                - ATAC-Seq and ChIP-Seq FASTQ: may contain specific patterns or
                characteristics related to the assay type, such as shorter
                fragments or specific adapter sequences. (Not suitable for this
                tool.)
              </span>
              <br />
              <span style={{ marginLeft: "2rem" }}>
                - scRNA-Seq FASTQ: may contain specific patterns or
                characteristics related to single-cell RNA sequencing, such as
                cell barcodes and unique molecular identifiers (UMIs). (Not
                suitable for this tool.)
              </span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "1rem",
              }}
            >
              <button onClick={() => setShowFastqInfo(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
