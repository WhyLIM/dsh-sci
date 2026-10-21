# Changelog

## 0.9.2

- Add disease, drug, pathway and phenotype entity resolution and batch mapping.
- Add `db search --all` pagination for ChEBI/DailyMed with count/page guards.
- Add `graph html` local evidence graph export.

## 0.9.0

- Add public database handlers for ClinPGx, ChEBI and DailyMed.
- Add HGVS-to-ClinVar grounding and report unresolved HGVS.
- Add DB search paging, source/access provenance and opt-in live contract tests.
- Add BAM/CRAM/HDF5/BigWig header checks.
- Mark LINCS L1000 as key-required; record unavailable RegulomeDB/ZINC endpoints.

## 0.8.9

- Separate manual and DSH-native automatic schedules.
- Add database lookup catalog, canonical grounding and bioinformatics note templates.
- Add omics file inspection, reproducibility/QC checks, benchmark extraction and graph.
- Add PubMed/NCBI API key configuration and higher E-utilities rate limits.
- Add custom output directory, topic import and execution workspace/session selection.
- Prompt to save unsaved settings before closing; fix modal button handling.

## 0.1.0

- Initial biomedical literature workbench.
