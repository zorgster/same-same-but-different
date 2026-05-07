const TEST_SEQUENCE =
  "CTCCTACTACCCACCCAAGATTGTTAATAATAACAATAATAATAACAACAATAATACTGCGATAATATTAATACTTCACATTTGTACGAAGCTTACAGA";

function generateTestGeneSequence() {
  const filler = "AAAAAAAAAA";
  let gene = "";

  gene += TEST_SEQUENCE;
  gene += filler.repeat(5);

  gene += filler.repeat(50);
  gene += TEST_SEQUENCE;
  gene += filler.repeat(5);

  gene += filler.repeat(50);
  gene += TEST_SEQUENCE;
  gene += filler.repeat(5);

  gene += filler.repeat(100);

  return gene;
}

function generateTestFastqFile(geneSequence, readLength = 100, numReads = 100) {
  let fastqContent = "";
  for (let i = 0; i < numReads; i++) {
    const pos = Math.floor(Math.random() * (geneSequence.length - readLength));
    const read = geneSequence.slice(pos, pos + readLength);
    const qual = "I".repeat(readLength);

    fastqContent += `@read_${i}_pos_${pos}\n`;
    fastqContent += `${read}\n`;
    fastqContent += `+\n`;
    fastqContent += `${qual}\n`;
  }
  return fastqContent;
}

function downloadTestFastq(geneSequence, readLength = 100) {
  const fastqContent = generateTestFastqFile(geneSequence, readLength, 100);
  const blob = new Blob([fastqContent], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "test_reads.fastq";
  link.click();
  URL.revokeObjectURL(url);
}

export {
  TEST_SEQUENCE,
  generateTestGeneSequence,
  generateTestFastqFile,
  downloadTestFastq,
};
