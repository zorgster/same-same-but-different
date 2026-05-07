import React, { useState } from "react";
import * as Styles from "../styles/fastq-gene-finder-styles.jsx";
import {
  generateTestGeneSequence,
  downloadTestFastq,
} from "./gene-test-data.js";

async function fetchGeneSequence(geneName) {
  const lookup = await fetch(
    `https://rest.ensembl.org/lookup/symbol/homo_sapiens/${encodeURIComponent(geneName)}?content-type=application/json`,
  );
  if (!lookup.ok) throw new Error("Gene lookup failed");
  const lookupJson = await lookup.json();

  const seqRes = await fetch(
    `https://rest.ensembl.org/sequence/id/${lookupJson.id}?content-type=application/json&type=genomic`,
  );
  if (!seqRes.ok) throw new Error("Sequence fetch failed");
  const seqJson = await seqRes.json();

  return { seq: seqJson.seq, lookupJson };
}

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
      const { seq, lookupJson } = await fetchGeneSequence(geneName);
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
      onSequenceLoaded(seq);
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
    <div style={{ ...Styles.panel, marginTop: "1rem" }}>
      <input
        value={geneName}
        onChange={(e) => setGeneName(e.target.value)}
        placeholder="Gene symbol (e.g. BRCA1)"
      />
      <button onClick={handleFetch} disabled={!geneName || loading}>
        {loading ? "Fetching…" : "Lookup"}
      </button>
      <button
        onClick={handleTestGene}
        disabled={loading}
        style={{ marginLeft: "0.5rem" }}
      >
        Use Test Gene
      </button>
      <button
        onClick={handleDownloadTestFastq}
        disabled={loading}
        style={{ marginLeft: "0.5rem" }}
      >
        Download Test FASTQ
      </button>
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
          <div>
            <strong>{lookupInfo.displayName}</strong>
          </div>
          <div>
            <strong>Desc:</strong>{" "}
            {lookupInfo.description || "No description returned by Ensembl."}
          </div>
          <div>
            <strong>Source:</strong> {lookupInfo.source}
          </div>
          <div>
            <strong>ID:</strong> {lookupInfo.id} (Version: {lookupInfo.version})
          </div>
          <div>
            <strong>Type:</strong> {lookupInfo.biotype}
          </div>
          <div>
            <strong>Region:</strong> {lookupInfo.seqRegionName}:
            {lookupInfo.start}-{lookupInfo.end} ({lookupInfo.strand})
          </div>
          <div>
            <strong>Assembly:</strong> {lookupInfo.assembly}
          </div>
          <div>
            <strong>Canonical Transcript:</strong>{" "}
            {lookupInfo.canonical || "N/A"}
          </div>
          <div>
            <strong>Gene Length:</strong> {geneSequence?.length || "-"}
          </div>
        </div>
      )}
      {error && <div style={{ color: "red" }}>{error}</div>}
    </div>
  );
}
