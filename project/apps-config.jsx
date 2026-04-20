import NameIdMismatchApp from "./name-id-mismatch.jsx";
import EmailValidatorApp from "./email-validator.jsx";
import VcfHeaderReaderApp from "./vcf-header-reader/VcfHeaderReaderApp.jsx";
import DnaFileComparatorApp from "./array_raw_data_comparator/dna-file-comparator.jsx";

export const APPS = [
  {
    id: "core-tools",
    title: "Tool Portal",
    apps: [
      {
        id: "name-id-mismatch",
        name: "Name-ID mismatch checker",
        desc: "Compare two uploads (XLSX, CSV) to find missing IDs and changed names",
        status: "live",
        component: NameIdMismatchApp,
      },
      {
        id: "masterlist-merge",
        name: "Masterlist merge",
        desc: "Merge near-identical lists while preserving trusted master records",
        status: "soon",
        component: null,
      },
      {
        id: "email-id-validator",
        name: "Email validator",
        desc: "Upload one file, select email columns, and validate email formatting",
        status: "live",
        component: EmailValidatorApp,
      },
      {
        id: "column-shift-check",
        name: "Column shift check",
        desc: "Detect accidental column shifts and mapping misalignments",
        status: "soon",
        component: null,
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
        desc: "Read and inspect VCF, VCF.GZ, or BCF headers",
        status: "live",
        component: VcfHeaderReaderApp,
      },
      {
        id: "array-raw-data-comparator",
        name: "Array Raw Data Comparator",
        desc: "Compare raw data files from genomic arrays (23andMe, Ancestry) to find discrepancies",
        status: "live",
        component: DnaFileComparatorApp,
      },
      {
        id: "genomics-placeholder",
        name: "Genomics tools starter",
        desc: "First domain collection card for upcoming genomics-specific validators",
        status: "soon",
        component: null,
      },
    ],
  },
];
