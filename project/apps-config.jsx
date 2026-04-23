import NameIdMismatchApp from "./name-id-mismatch.jsx";
import EmailValidatorApp from "./email-validator.jsx";
import VcfHeaderReaderApp from "./vcf-header-reader/VcfHeaderReaderApp.jsx";
import DnaFileComparatorApp from "./array_raw_data_comparator/dna-file-comparator.jsx";
import GeneticDistanceCalculatorApp from "./genetic-distance-calculator/genetic-distance-calculator.jsx";
import TableInspectorApp from "./table-inspector.jsx";
import DataImputationApp from "./data_imputation/data-imputation.jsx";
import VcfProcessorApp from "./vcf-processor/vcf-processor.jsx";

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
        id: "email-id-validator",
        name: "Email validator",
        desc: "Upload one file, select email columns, and validate email formatting",
        status: "live",
        component: EmailValidatorApp,
      },
      {
        id: "table-inspector",
        name: "Table inspector",
        desc: "Inspect and validate table structures and data integrity",
        status: "beta",
        component: TableInspectorApp,
      },
      {
        id: "data-imputation",
        name: "Data Imputation",
        desc: "Impute missing values in your dataset using various strategies",
        status: "soon",
        component: null,
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
        status: "beta",
        component: VcfHeaderReaderApp,
      },
      {
        id: "vcf-processor",
        name: "VCF Processor",
        desc: "Process and analyze VCF or VCF.GZ files (no BCF support yet)",
        status: "beta",
        component: VcfProcessorApp,
      },
      {
        id: "array-raw-data-comparator",
        name: "Array Raw Data Comparator",
        desc: "Compare raw data files from genomic arrays (23andMe, Ancestry) to find discrepancies",
        status: "beta",
        component: DnaFileComparatorApp,
      },
      {
        id: "genetic-distance-calculator",
        name: "Genetic Distance Calculator",
        desc: "Calculate cM across DNA segments using recombination maps",
        status: "experimental",
        component: GeneticDistanceCalculatorApp,
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
