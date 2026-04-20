// Reference signatures used by inferReferenceFromContigs.
// Add new builds by appending { name, aliases, contigs } objects.
// contigs should map normalized IDs ("1", "2", "X", "Y", "MT") to lengths.
export const REFERENCE_SIGNATURES = [
  {
    name: "GRCh38",
    aliases: ["hg38"],
    contigs: {
      "1": 248956422,
      "2": 242193529,
      X: 156040895,
      Y: 57227415,
      MT: 16569,
    },
  },
  {
    name: "GRCh37",
    aliases: ["hg19"],
    contigs: {
      "1": 249250621,
      "2": 243199373,
      X: 155270560,
      Y: 59373566,
      MT: 16569,
    },
  },
  {
    name: "T2T-CHM13",
    aliases: ["hs1"],
    contigs: {
      "1": 248387328,
      "2": 242696752,
      X: 154259566,
      Y: 62460029,
      MT: 16569,
    },
  },
];
