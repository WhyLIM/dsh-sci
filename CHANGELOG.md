# Changelog

## 0.9.11

- Replace free-text publication types with multi-select include/exclude type controls.
- Canonicalize publication types and migrate legacy exclude values.
- Filter excluded publication types before candidate ranking.

## 0.9.10

- Mark papers as full-text available after cached or newly extracted MDPI/PMC/HTML/PDF text.

## 0.9.9

- Ignore invalid publication types instead of generating zero-result PubMed/Europe PMC queries.
- Stop using the generic field placeholder as a search query.
- Exclude ebook/chapter and no-abstract records from default candidates.
- Add MDPI mdpi-res PDF fallback for CC-BY articles blocked by the landing page.

## 0.9.8

- Fix bioRxiv `--limit` handling and pagination termination.

## 0.9.7

- Add bioRxiv as a default-enabled preprint source with local title/abstract filtering.

## 0.9.6

- Add PubTator 3 gene/disease/chemical/variant candidate annotations.
- Add PubTator toggle to reading settings; annotations remain database-verified.

## 0.9.5

- Add full-text disease candidate extraction with database verification.
- Clarify database pagination and dataset download limits.

## 0.9.4

- Add Nextflow/Snakemake/WDL inspection, validation and guarded execution.
- Add dataset download with resume, SHA256, size limits and explicit confirmation.
- Add Methods validation/journal structure and Benchmark validation.
- Add MeSH-based disease candidates and explicit drug grounding.
- Make graph HTML interactive (search, type filter, zoom, node selection).

## 0.9.3

- Add dataset file listing for GEO, SRA/ENA and PRIDE.
- Fix BioProject accession detection (PRJNA/PRJEB/PRJDB).

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
