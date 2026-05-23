import React, { useState } from "react";
import * as Styles from "../styles/fastq-gene-finder-styles.jsx";
import {
  generateTestGeneSequence,
  downloadTestFastq,
} from "./gene-test-data.js";

function parseTranscripts(rawList) {
  const sorted = [...rawList].sort((a, b) => {
    if ((b.is_canonical ?? 0) !== (a.is_canonical ?? 0)) return (b.is_canonical ?? 0) - (a.is_canonical ?? 0);
    if ((a.biotype === "protein_coding") !== (b.biotype === "protein_coding"))
      return a.biotype === "protein_coding" ? -1 : 1;
    return (a.id || "").localeCompare(b.id || "");
  });
  return sorted.map((t) => ({
    id: t.id,
    biotype: t.biotype || "",
    isCanonical: t.is_canonical === 1,
    start: t.start,
    end: t.end,
    exons: (Array.isArray(t.Exon) ? t.Exon : []).map((e) => ({
      id: e.id,
      start: e.start,
      end: e.end,
    })),
  }));
}

async function fetchGeneSequence(geneName) {
  const lookup = await fetch(
    `https://rest.ensembl.org/lookup/symbol/homo_sapiens/${encodeURIComponent(geneName)}?content-type=application/json&expand=1`,
  );
  if (!lookup.ok) throw new Error("Gene lookup failed");
  const lookupJson = await lookup.json();

  const seqRes = await fetch(
    `https://rest.ensembl.org/sequence/id/${lookupJson.id}?content-type=application/json&type=genomic&mask_feature=1`,
  );
  if (!seqRes.ok) throw new Error("Sequence fetch failed");
  const seqJson = await seqRes.json();

  const transcripts = parseTranscripts(Array.isArray(lookupJson.Transcript) ? lookupJson.Transcript : []);
  return { seq: seqJson.seq.toUpperCase(), maskedSeq: seqJson.seq, lookupJson, transcripts };
}

const secondaryBtn = {
  fontSize: "11px",
  padding: "2px 6px",
  cursor: "pointer",
};

export default function GeneLookupWidget({
  geneName,
  setGeneName,
  onSequenceLoaded,
  onLookupError,
  geneSequence,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lookupInfo, setLookupInfo] = useState(null);

  const handleFetch = async () => {
    setLoading(true);
    setError("");
    try {
      const { seq, maskedSeq, lookupJson, transcripts } = await fetchGeneSequence(geneName);
      setLookupInfo({
        displayName: lookupJson.display_name || geneName,
        id: lookupJson.id,
        version: lookupJson.version,
        source: lookupJson.source || "Ensembl",
        canonical: lookupJson.canonical_transcript || "",
        biotype: lookupJson.biotype,
        description: lookupJson.description,
        seqRegionName: lookupJson.seq_region_name,
        start: lookupJson.start,
        end: lookupJson.end,
        strand: lookupJson.strand,
        assembly: lookupJson.assembly_name,
      });
      onSequenceLoaded(seq, {
        id: lookupJson.id,
        seqRegionName: lookupJson.seq_region_name,
        start: lookupJson.start,
        end: lookupJson.end,
        strand: lookupJson.strand,
        assembly: lookupJson.assembly_name,
        displayName: lookupJson.display_name || geneName,
        version: lookupJson.version,
      }, maskedSeq, transcripts);
    } catch (e) {
      setError(String(e));
      setLookupInfo(null);
      onLookupError?.();
    }
    setLoading(false);
  };

  const handleTestGene = () => {
    setLoading(true);
    setError("");
    setTimeout(() => {
      const testGene = generateTestGeneSequence();
      setGeneName("TEST_GENE");
      onSequenceLoaded(testGene);
      setLoading(false);
    }, 0);
  };

  const handleDownloadTestFastq = () => {
    const testGene = generateTestGeneSequence();
    downloadTestFastq(testGene);
  };

  return (
    <div style={Styles.panel}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
          <input
            value={geneName}
            onChange={(e) => setGeneName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && geneName && !loading && handleFetch()}
            placeholder="e.g. BRCA1"
            style={{ width: "9ch", fontFamily: "monospace" }}
          />
          <button onClick={handleFetch} disabled={!geneName || loading}>
            {loading ? "Fetching…" : "Lookup"}
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", marginLeft: "auto" }}>
          <button onClick={handleTestGene} disabled={loading} style={secondaryBtn}>
            Use Test Gene
          </button>
          <button onClick={handleDownloadTestFastq} disabled={loading} style={secondaryBtn}>
            Download Test FASTQ
          </button>
        </div>
      </div>

      {lookupInfo && (
        <div
          style={{
            marginTop: "0.75rem",
            paddingTop: "0.5rem",
            borderTop: "1px solid #d7d7d7",
            fontSize: "12px",
            lineHeight: 1.4,
          }}
        >
          <div><strong>{lookupInfo.displayName}</strong></div>
          <div>
            <strong>Desc:</strong>{" "}
            {lookupInfo.description || "No description returned by Ensembl."}
          </div>
          <div><strong>Source:</strong> {lookupInfo.source}</div>
          <div><strong>ID:</strong> {lookupInfo.id} (Version: {lookupInfo.version})</div>
          <div><strong>Type:</strong> {lookupInfo.biotype}</div>
          <div>
            <strong>Region:</strong> {lookupInfo.seqRegionName}:
            {lookupInfo.start}-{lookupInfo.end} ({lookupInfo.strand})
          </div>
          <div><strong>Assembly:</strong> {lookupInfo.assembly}</div>
          <div><strong>Canonical Transcript:</strong> {lookupInfo.canonical || "N/A"}</div>
          <div><strong>Gene Length:</strong> {geneSequence?.length || "-"}</div>
        </div>
      )}
      {error && <div style={{ color: "red", marginTop: "0.5rem" }}>{error}</div>}
    </div>
  );
}
