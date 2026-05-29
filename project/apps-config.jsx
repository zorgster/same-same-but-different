import { version } from "jszip";
import { lazy } from "react";

const lazyTool = (loader) => lazy(loader);

export const APPS = [
  {
    id: "core-tools",
    title: "Tool Portal",
    apps: [
      {
        id: "name-id-mismatch",
        name: "Name-ID mismatch checker",
        version: "0.1.0",
        desc: "Compare two uploads (XLSX, CSV) to find missing IDs and changed names",
        status: "live",
        component: lazyTool(() => import("./name-id-mismatch.jsx")),
      },
      {
        id: "email-id-validator",
        name: "Email validator",
        version: "0.1.0",
        desc: "Upload one file, select email columns, and validate email formatting",
        status: "live",
        component: lazyTool(() => import("./email-validator.jsx")),
      },
      {
        id: "table-inspector",
        name: "Table inspector",
        version: "0.1.0",
        desc: "Inspect and validate table structures and data integrity",
        status: "beta",
        component: lazyTool(() => import("./table-inspector.jsx")),
      },
      {
        id: "data-imputation",
        name: "Data Imputation",
        version: "0.1.0",
        desc: "Impute missing values in your dataset using various strategies",
        status: "soon",
        component: null,
      },
      {
        id: "column-shift-check",
        name: "Column shift check",
        version: "0.1.0",
        desc: "Detect accidental column shifts and mapping misalignments",
        status: "soon",
        component: null,
      },
      {
        id: "pdf-table-extractor",
        name: "PDF Table Extractor",
        version: "0.1.0",
        desc: "Extract tables from PDF files and convert them to CSV or XLSX",
        status: "experimental",
        component: lazyTool(
          () => import("./pdf-table-extractor/PdfTableExtractor.jsx"),
        ),
      },
      {
        id: "data-requester",
        name: "Data Requester",
        version: "0.1.0",
        desc: "Restructure a customers spreadsheet to fit your own template",
        status: "experimental",
        component: lazyTool(() => import("./data-requester/DataRequester.jsx")),
      },
    ],
  },
  {
    id: "genomics-tools",
    title: "Genomics Tools",
    apps: [
      {
        id: "vcf-header-reader",
        name: "VCF Header Reader",
        version: "0.1.0",
        desc: "Read and inspect VCF, VCF.GZ, or BCF headers",
        status: "beta",
        component: lazyTool(
          () => import("./vcf-header-reader/VcfHeaderReaderApp.jsx"),
        ),
      },
      {
        id: "vcf-processor",
        name: "VCF Processor",
        version: "0.1.0",
        desc: "Process and analyze VCF or VCF.GZ files (no BCF support yet)",
        status: "beta",
        component: lazyTool(() => import("./vcf-processor/vcf-processor.jsx")),
      },
      {
        id: "fastq-gene-finder",
        name: "FASTQ Gene Finder",
        version: "0.5.0",
        desc: "[Multiworker] Find a gene in FASTQ or FASTQ.GZ files using an array of sparse seeds [Uses Ensembl REST API]",
        status: "beta",
        component: lazyTool(
          () => import("./fastq-gene-finder/FastqGeneFinder.jsx"),
        ),
      },
      {
        id: "fastq-sequence-finder",
        name: "FASTQ Sequence Finder",
        version: "0.1.0",
        desc: "[Multiworker] Search sequenced reads in FASTQ or FASTQ.GZ files for a DNA sequence.",
        status: "experimental",
        component: lazyTool(
          () => import("./fastq-sequence-finder/FastqSequenceFinder.jsx"),
        ),
      },
      // {
      //   id: "fastq-qc-inspector",
      //   name: "FASTQ QC Inspector",
      //   version: "0.1.0",
      //   desc: "Inspect FASTQ or FASTQ.GZ files for quality control metrics and visualizations",
      //   status: "soon",
      //   component: null,
      // },
      // {
      //   id: "bam-header-reader",
      //   name: "BAM Header Reader",
      //   version: "0.1.0",
      //   desc: "Read and inspect BAM headers",
      //   status: "soon",
      //   component: null,
      // },
      {
        id: "dna-sequence-visualizer",
        name: "DNA Sequence Visualizer",
        version: "0.1.0",
        desc: "Visualize DNA sequences with interactive features [Uses Ensembl REST API]",
        status: "experimental",
        component: lazyTool(
          () => import("./dna-sequence-visualizer/DnaSequenceVisualizer.jsx"),
        ),
      },
      {
        id: "rna-seq-volcano-plot",
        name: "RNA-Seq Volcano Plot",
        version: "0.1.0",
        desc: "Create interactive differential expression volcano plots from RNA-Seq data (CSV or TSV) [Ensembl ID-based]",
        status: "beta",
        component: lazyTool(
          () => import("./rna-seq-volcano-plot/RnaSeqVolcanoPlot.jsx"),
        ),
      },
    ],
  },
  {
    id: "genetic-genealogy-tools",
    title: "Genetic Genealogy Tools",
    apps: [
      {
        id: "array-raw-data-comparator",
        name: "Array Raw Data Comparator",
        version: "0.1.0",
        desc: "Compare raw data files from genomic arrays (23andMe, Ancestry) to find discrepancies",
        status: "beta",
        component: lazyTool(
          () => import("./array_raw_data_comparator/dna-file-comparator.jsx"),
        ),
      },
      {
        id: "genetic-distance-calculator",
        name: "Genetic Distance Calculator",
        version: "0.2.0",
        desc: "Calculate cM across DNA segments using recombination maps",
        status: "experimental",
        component: lazyTool(
          () =>
            import("./genetic-distance-calculator/genetic-distance-calculator.jsx"),
        ),
      },
    ],
  },
  {
    id: "affiliate-links",
    title: "Affiliate Links",
    apps: [
      {
        id: "tellmegen-wgs-link",
        name: "TellMeGen Ultra (WGS 30X)",
        desc: "Looking for WGS 30X in Europe? Check out TellMeGen and support our work!",
        status: "affiliate",
        affiliateLink:
          "https://shop.tellmegen.com/en/collections/ultra?sca_ref=9946214.NninYFXhqaP&sca_source=ssbd",
        component: null,
      },
      {
        id: "tellmegen-dna-ancestry-link",
        name: "TellMeGen Starter DNA Kit",
        desc: "A starter kit for exploring DNA Traits + Ancestry in Europe. Check out TellMeGen and support our work!",
        status: "affiliate",
        affiliateLink:
          "https://shop.tellmegen.com/en/collections/starter?sca_ref=9946214.NninYFXhqaP&sca_source=ssbd",
        component: null,
      },
      {
        id: "tellmegen-upload-raw-data-link",
        name: "TellMeGen Raw Data Upload",
        desc: "Upload your existing raw data from 23andMe, Ancestry, or MyHeritage to TellMeGen and support our work!",
        status: "affiliate",
        affiliateLink:
          "https://www.tellmegen.com/en/upload-raw-data?sca_ref=9946214.NninYFXhqaP&sca_source=ssbd",
        component: null,
      },
    ],
  },
];
