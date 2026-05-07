import React from "react";
import { fileDropZone } from "../styles/fastq-gene-finder-styles.jsx";

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export default function FileDropZone({
  onFilesSelected,
  selectedFile,
  readLength,
}) {
  const handleChange = (e) => {
    const selected = [...e.target.files].slice(0, 2);
    onFilesSelected(selected);
  };

  return (
    <div style={fileDropZone}>
      <p>Drop (single-end or R1 of paired-end) FASTQ/FASTQ.gz or choose:</p>
      <input
        type="file"
        multiple
        accept=".fastq,.fastq.gz"
        onChange={handleChange}
      />

      {selectedFile && (
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
            <strong>FileName:</strong> {selectedFile.name}
          </div>
          <div>
            <strong>Path:</strong> {selectedFile.webkitRelativePath || ""}
          </div>
          <div>
            <strong>File Size:</strong> {formatFileSize(selectedFile.size)}
          </div>
          <div>
            <strong>Read Length:</strong> {readLength || "-"}
          </div>
        </div>
      )}
    </div>
  );
}
