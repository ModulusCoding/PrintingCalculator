# Internal Product Images Review

## Sequence of Operations
1. **Prepare**: Call `public.prepare_internal_product_image_upload` to reserve storage path and register metadata in `public.internal_product_image_uploads`.
2. **Upload**: Upload binary file to `storage.objects` with `internal-product-images` bucket.
3. **Link**: Call `public.link_internal_product_image` to perform final validation against `internal_product_image_uploads` and move to `public.product_images`.

## Security Limitations
- Buckets are private; RLS policies govern access.
- `public.internal_product_image_tombstones` tracks removals for cleanup.
- Strict validation via `plpgsql` and regex checks ensures only authorized, valid images exist.
- `public.product_images` is read-only for public API.
- All SQL functions run as `SECURITY DEFINER` with `search_path = ''`.

## Tests
- Ensure `uploadInternalProductImage` correctly handles failed links by invoking cleanup.
- Verify `reorder_internal_product_image` enforces uniqueness with deferred constraints.
- Test `remove_internal_product_image` triggers tombstone correctly and cleans up storage.
- Confirm `Zod` validation correctly rejects invalid inputs and `null` paths.

## References
- `supabase/migrations/20261015170000_internal_product_images.sql`
- `lib/products/image-actions.ts`
