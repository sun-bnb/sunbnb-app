-- Freeze the full wire payload with the record (track 026 phase 7.1).
--
-- Phase 5 stored what the HUELLA needs. AEAT's RegistroAlta needs more:
-- NombreRazonEmisor and DescripcionOperacion are mandatory in the XSD, and
-- CuotaTotal / ImporteTotal are separate elements. Storing them (rather than
-- re-reading the invoice when submitting) keeps the filed document consistent
-- with the hash that certifies it -- a mismatched huella comes back as
-- "aceptado con errores", not as a rejection, so drift would be silent.
--
-- All additive and nullable: old code ignores them, and the only rows that exist
-- are test data with no records at all.
ALTER TABLE "verifactu_record" ADD COLUMN     "nombre_razon_emisor" TEXT,
ADD COLUMN     "descripcion_operacion" TEXT,
ADD COLUMN     "cuota_total" TEXT,
ADD COLUMN     "importe_total" TEXT;
