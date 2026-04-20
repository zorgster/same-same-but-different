import { inflateRaw } from "pako";

export async function loadHeaderText(file) {
  const format = detectFormat(file.name);
  const headerText =
    format === "BCF"
      ? await readBCFHeader(file)
      : format === "VCF.GZ"
        ? await readVCFGZHeader(file)
        : await readVCFHeader(file);

  return { file, format, headerText };
}

function detectFormat(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".bcf")) return "BCF";
  if (lower.endsWith(".vcf.gz") || lower.endsWith(".gz")) return "VCF.GZ";
  return "VCF";
}

function readSlice(file, start, end) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file.slice(start, end));
  });
}

function readSliceText(file, start, end) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file.slice(start, end));
  });
}

async function readVCFHeader(file) {
  const chunkSize = 65536;
  let offset = 0;
  let tail = "";
  let fullHeader = "";

  while (offset < file.size) {
    const chunk = await readSliceText(file, offset, offset + chunkSize);
    const text = tail + chunk;
    const lines = text.split("\n");

    for (let i = 0; i < lines.length - 1; i += 1) {
      if (lines[i] && !lines[i].startsWith("#")) {
        return fullHeader + lines.slice(0, i).join("\n");
      }
    }

    fullHeader += `${lines.slice(0, -1).join("\n")}\n`;
    tail = lines[lines.length - 1];
    offset += chunkSize;
  }

  return fullHeader + tail;
}

async function readVCFGZHeader(file) {
  const maxRead = Math.min(file.size, 10 * 1024 * 1024);
  const buffer = await readSlice(file, 0, maxRead);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let offset = 0;
  let text = "";

  while (offset + 18 < bytes.length) {
    // GZIP magic header check
    if (bytes[offset] !== 0x1f || bytes[offset + 1] !== 0x8b) break;

    const flg = bytes[offset + 3];
    let pos = offset + 10;
    let blockSize = 0;

    // BGZF block has FEXTRA set with BC subfield that stores block size.
    if (flg & 0x04) {
      const xlen = view.getUint16(pos, true);
      pos += 2;
      const xEnd = pos + xlen;

      while (pos < xEnd) {
        const si1 = bytes[pos];
        const si2 = bytes[pos + 1];
        const slen = view.getUint16(pos + 2, true);

        if (si1 === 0x42 && si2 === 0x43) {
          blockSize = view.getUint16(pos + 4, true) + 1;
        }

        pos += 4 + slen;
      }
    }

    if (!blockSize) {
      throw new Error("Unsupported .vcf.gz layout (expected BGZF blocks)");
    }

    const compressedEnd = offset + blockSize - 8; // exclude CRC32 + ISIZE footer
    if (compressedEnd > bytes.length) break;

    const compressedData = bytes.slice(pos, compressedEnd);
    text += inflateRaw(compressedData, { to: "string" });
    offset += blockSize;

    const lines = text.split("\n");
    if (lines.some((line) => line && !line.startsWith("#"))) {
      break;
    }
  }

  return text;
}

async function readBCFHeader(file) {
  const header = await readSlice(file, 0, 9);
  const view = new DataView(header);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2));
  if (magic !== "BCF") throw new Error("Not a BCF file");

  const textLength = view.getUint32(5, true);
  const textBuffer = await readSlice(file, 9, 9 + textLength);
  return new TextDecoder().decode(textBuffer);
}
