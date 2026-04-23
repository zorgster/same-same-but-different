import React from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import * as XLSX from "xlsx";

export default function DataDropZone({ onDataLoaded }) {
  const onDrop = async (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "csv") {
      Papa.parse(file, {
        complete: (results) => {
          const rows = results.data;
          const normalized = normalizeData(rows);
          onDataLoaded(normalized);
        },
        error: (err) => console.error("CSV parse error:", err),
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const normalized = normalizeData(rows);
      onDataLoaded(normalized);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        ".xlsx",
      ],
    },
  });

  return (
    <div
      {...getRootProps()}
      style={{
        border: "2px dashed #888",
        padding: 30,
        textAlign: "center",
        borderRadius: 8,
        background: isDragActive ? "#eef" : "#fafafa",
        cursor: "pointer",
        marginBottom: 20,
      }}
    >
      <input {...getInputProps()} />
      {isDragActive
        ? "Drop your file here…"
        : "Drag & drop a CSV or Excel file here, or click to select"}
    </div>
  );
}

/**
 * Detects header row and converts rows → array of objects
 */
function normalizeData(rows) {
  if (!rows || rows.length === 0) return [];

  const firstRow = rows[0];

  const hasHeader = firstRow.some(
    (v) => typeof v === "string" && isNaN(Number(v)),
  );

  let headers;
  let dataRows;

  if (hasHeader) {
    headers = firstRow;
    dataRows = rows.slice(1);
  } else {
    headers = firstRow.map((_, i) => `Column_${i + 1}`);
    dataRows = rows;
  }

  return dataRows
    .filter((r) => r.length > 0)
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] === "" ? null : row[i];
      });
      return obj;
    });
}
