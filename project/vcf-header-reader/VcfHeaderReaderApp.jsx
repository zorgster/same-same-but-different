import { useEffect, useMemo, useRef, useState } from "react";
import { COLORS, TONES, styles } from "./styles/vcf-header-reader-styles.jsx";
import ColumnsTab from "./components/ColumnsTab.jsx";
import ContigsTab from "./components/ContigsTab.jsx";
import FilterTab from "./components/FilterTab.jsx";
import FormatTab from "./components/FormatTab.jsx";
import InfoTab from "./components/InfoTab.jsx";
import HistoryTab from "./components/HistoryTab.jsx";
import OtherTab from "./components/OtherTab.jsx";
import SamplesTab from "./components/SamplesTab.jsx";
import parseHeaderText from "./parsers/header-parser.jsx";
import { inferFieldProducerGroups } from "./parsers/field-origin-inference.jsx";
import { loadHeaderText } from "./parsers/file-handler.jsx";
import {
  formatVcfFileDate,
  getInitialTab,
  groupFormatFields,
  groupInfoFields,
  inferContigNamingConvention,
  inferReferenceFromContigs,
  summarizePopulationAnnotations,
} from "./helpers/view-model-helpers.jsx";

function getTabTone(tabId) {
  const map = {
    history: TONES.violet,
    columns: TONES.blue,
    samples: TONES.blue,
    contig: TONES.green,
    info: TONES.teal,
    format: TONES.amber,
    filter: TONES.rose,
    other: TONES.blue,
  };

  return map[tabId] || TONES.teal;
}

export default function VcfHeaderReaderApp() {
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState(null);
  const [activeTab, setActiveTab] = useState("history");
  const [result, setResult] = useState(null);
  const scrollContentRef = useRef(null);

  useEffect(() => {
    if (!scrollContentRef.current) return;
    scrollContentRef.current.scrollTop = 0;
  }, [activeTab]);

  const tabs = useMemo(() => {
    if (!result) return [];
    const p = result.parsed;

    return [
      { id: "history", label: "History", count: p.history.length || 0 },
      { id: "columns", label: "Columns", count: p.columns.length || 0 },
      { id: "info", label: "INFO", count: p.info.length || 0 },
      { id: "format", label: "FORMAT", count: p.format.length || 0 },
      { id: "filter", label: "FILTER", count: p.filter.length || 0 },
      { id: "contig", label: "Contigs", count: p.contig.length || 0 },
      { id: "samples", label: "Samples", count: p.samples.length || 0 },
      { id: "other", label: "Other", count: p.other.length || 0 },
    ];
  }, [result]);

  const inferredReference = useMemo(() => {
    if (!result?.parsed?.contig) return null;
    return inferReferenceFromContigs(result.parsed.contig);
  }, [result]);

  const contigNamingConvention = useMemo(() => {
    if (!result?.parsed?.contig) return null;
    return inferContigNamingConvention(result.parsed.contig);
  }, [result]);

  const populationSummary = useMemo(() => {
    if (!result?.parsed?.info) return { sources: [], totalFields: 0, hasPopulationData: false };
    return summarizePopulationAnnotations(result.parsed.info);
  }, [result]);

  const fieldProducerGroups = useMemo(() => {
    if (!result?.parsed) {
      return {
        activeSignals: [],
        infoFields: [],
        formatFields: [],
        filterFields: [],
        otherFields: [],
        infoGroups: [],
        formatGroups: [],
        filterGroups: [],
        otherGroups: [],
      };
    }
    return inferFieldProducerGroups({
      infoFields: result.parsed.info,
      formatFields: result.parsed.format,
      filterFields: result.parsed.filter,
      otherFields: result.parsed.other,
      historyEntries: result.parsed.history,
    });
  }, [result]);

  const groupedInfo = useMemo(() => {
    if (!fieldProducerGroups?.infoFields) return { core: [], population: [], other: [] };
    return groupInfoFields(fieldProducerGroups.infoFields);
  }, [fieldProducerGroups]);

  const groupedFormat = useMemo(() => {
    if (!fieldProducerGroups?.formatFields) return { core: [], other: [] };
    return groupFormatFields(fieldProducerGroups.formatFields);
  }, [fieldProducerGroups]);

  const handleFile = async (inputFile) => {
    try {
      setStatus({ type: "loading", text: "Reading header..." });
      setResult(null);

      const { file: loadedFile, format, headerText } = await loadHeaderText(inputFile);
      const parsed = parseHeaderText({ headerText });
      setResult({ file: loadedFile, format, parsed });

      setActiveTab(getInitialTab(parsed));
      setStatus(null);
    } catch (error) {
      setStatus({ type: "error", text: `Error: ${error.message}` });
    }
  };

  const onDrop = async (event) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  const onChoose = async (event) => {
    const file = event.target.files?.[0];
    if (file) await handleFile(file);
  };

  const parsed = result?.parsed;

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <h1 style={styles.title}>VCF Header Reader</h1>
        <p style={styles.subtitle}>
          Inspect VCF, VCF.GZ, or BCF headers without parsing full variant records.
        </p>
      </div>

      <div style={styles.card}>
        <label
          style={styles.drop(dragOver)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div style={{ fontSize: 15, fontWeight: 600 }}>Drop a VCF / VCF.GZ / BCF file here</div>
          <div style={{ marginTop: 6, fontSize: 12, color: COLORS.muted }}>
            Reads header metadata only.
          </div>
          <input
            type="file"
            accept=".vcf,.vcf.gz,.bcf,.gz"
            style={{ display: "none" }}
            onChange={onChoose}
          />
          <button type="button" style={styles.btn}>
            Choose file
          </button>
        </label>
      </div>

      {status ? <div style={styles.status(status.type)}>{status.text}</div> : null}

      {result ? (
        <div style={styles.card}>
          <div style={styles.resultPanel}>
          <div style={styles.stickyHeader}>
          <div style={styles.fileInfo}>
            <div style={styles.infoPill(TONES.violet)}>
              <span style={styles.infoLabel}>File</span>
              <span style={styles.infoValue(TONES.violet)}>{result.file.name}</span>
            </div>
            <div style={styles.infoPill(TONES.blue)}>
              <span style={styles.infoLabel}>Size</span>
              <span style={styles.infoValue(TONES.blue)}>{(result.file.size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
            <div style={styles.infoPill(TONES.teal)}>
              <span style={styles.infoLabel}>Format</span>
              <span style={styles.infoValue(TONES.teal)}>{result.format}</span>
            </div>
            {parsed.fileformat ? (
              <div style={styles.infoPill(TONES.amber)}>
                <span style={styles.infoLabel}>VCF Version</span>
                <span style={styles.infoValue(TONES.amber)}>{parsed.fileformat}</span>
              </div>
            ) : null}
            {parsed.fileDate ? (
              <div style={styles.infoPill(TONES.amber)}>
                <span style={styles.infoLabel}>File Date</span>
                <span style={styles.infoValue(TONES.amber)}>{formatVcfFileDate(parsed.fileDate)}</span>
              </div>
            ) : null}
            {parsed.source ? (
              <div style={styles.infoPill(TONES.teal)}>
                <span style={styles.infoLabel}>Source</span>
                <span style={styles.infoValue(TONES.teal)}>{parsed.source}</span>
              </div>
            ) : null}
            {parsed.phasing ? (
              <div style={styles.infoPill(TONES.blue)}>
                <span style={styles.infoLabel}>Phasing</span>
                <span style={styles.infoValue(TONES.blue)}>{parsed.phasing}</span>
              </div>
            ) : null}
            {populationSummary.hasPopulationData ? (
              <div style={styles.infoPill(TONES.green)}>
                <span style={styles.infoLabel}>Population DBs</span>
                <span style={styles.infoValue(TONES.green)}>{populationSummary.sources.join(", ")}</span>
                <span style={{ ...styles.infoLabel, marginTop: 4, marginBottom: 0 }}>
                  {populationSummary.totalFields.toLocaleString()} INFO fields
                </span>
              </div>
            ) : null}
            {contigNamingConvention ? (
              <div style={styles.infoPill(TONES.blue)}>
                <span style={styles.infoLabel}>Contig IDs</span>
                <span style={styles.infoValue(TONES.blue)}>{contigNamingConvention.label}</span>
                <span style={{ ...styles.infoLabel, marginTop: 4, marginBottom: 0 }}>
                  {contigNamingConvention.observed.toLocaleString()} contigs checked
                </span>
              </div>
            ) : null}
            {parsed.reference || parsed.assembly || inferredReference ? (
              <div style={styles.infoPill(TONES.rose)}>
                <span style={styles.infoLabel}>
                  Reference
                  {inferredReference ? (
                    <span
                      style={styles.helpIcon}
                      title={`Reference file: ${parsed.reference || parsed.assembly || "(none)"}\nInferred reference: ${inferredReference.build}${inferredReference.aliases?.length ? ` (${inferredReference.aliases.join("/")})` : ""}\nConfidence: ${inferredReference.confidence}\nInference based on exact contig length matches. Matched contigs: ${inferredReference.matchedContigs.join(", ")} (${inferredReference.matched}/${inferredReference.compared}).`}
                    >
                      ?
                    </span>
                  ) : null}
                </span>
                <span style={styles.infoValue(TONES.rose)}>
                  {inferredReference
                    ? `${inferredReference.build}${inferredReference.aliases?.length ? ` (${inferredReference.aliases.join("/")})` : ""}`
                    : parsed.reference || parsed.assembly}
                </span>
                {inferredReference ? (
                  <span style={{ ...styles.infoLabel, marginTop: 4, marginBottom: 0 }}>
                    {`${inferredReference.confidence.charAt(0).toUpperCase()}${inferredReference.confidence.slice(1)} confidence`}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div style={styles.tabs}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                style={styles.tab(activeTab === tab.id, getTabTone(tab.id))}
                onClick={() => setActiveTab(tab.id)}
              >
                <span style={styles.tabLabel}>{tab.label}</span>
                <span style={styles.tabCount(activeTab === tab.id, getTabTone(tab.id))}>
                  {tab.count.toLocaleString()}
                </span>
              </button>
            ))}
          </div>
          </div>

          <div ref={scrollContentRef} style={styles.scrollContent}>

          {activeTab === "history" ? <HistoryTab history={parsed.history} /> : null}

          {activeTab === "columns" ? <ColumnsTab columns={parsed.columns} altEntries={parsed.altEntries} /> : null}

          {activeTab === "info" ? <InfoTab parsed={parsed} groupedInfo={groupedInfo} /> : null}

          {activeTab === "format" ? <FormatTab parsed={parsed} groupedFormat={groupedFormat} /> : null}

          {activeTab === "filter" ? <FilterTab filters={fieldProducerGroups.filterFields} /> : null}

          {activeTab === "contig" ? <ContigsTab contigs={parsed.contig} /> : null}

          {activeTab === "samples" ? <SamplesTab samples={parsed.samples} /> : null}

          {activeTab === "other" ? <OtherTab otherEntries={fieldProducerGroups.otherFields} /> : null}
          </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
