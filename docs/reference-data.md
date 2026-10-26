# Reference data

The migrations load only the seven Region III provinces, with no PSGC codes. Cities and municipalities must be imported from the official Philippine Standard Geographic Code (PSGC) publication of the Philippine Statistics Authority, not typed from memory.

Import steps (when Phase 3 needs city-level matching):

1. Download the latest PSGC publication from the PSA website.
2. Filter it to Region III.
3. Fill `psgc_code` for the seven provinces, then insert each city and municipality with `kind`, `name`, `parent_id` (its province) and `psgc_code`.
4. Record the publication date in the commit message.

Grade scales and income brackets in `20261026000900_reference_data.sql` describe the app's own answer options, not equivalencies. Grade conversions are added only from an authoritative source (a scholarship's own table or a school's published scale), with its URL, through `public.grade_conversions`.
