# 0002. SeaweedFS instead of MinIO for S3-compatible object storage

- Status: accepted
- Date: 2026-11-23

## Context

The blueprint lists MinIO for uploads, 3D models and firmware binaries. In Phase 0 the `minio/minio` image could no longer be pulled from Docker Hub ("pull access denied" for every tag): MinIO stopped distributing community container images. Building MinIO from source for every developer is not reasonable, and an unmaintained image is a security risk.

## Decision

Use **SeaweedFS** (`chrislusf/seaweedfs`, Apache-2.0) in S3 mode for local development and self-hosting.

- `docker-compose.yml` runs `weed server -s3` on port **8333**. Credentials come from `infra/seaweedfs/s3.json` (dev only).
- A one-shot `seaweedfs-init` service creates the `linelab` bucket.
- Application code talks to storage **only through the S3 API** (AWS SDK v3 with a configurable endpoint), so production can use AWS S3, Cloudflare R2, Garage or any other S3-compatible store with no code change.

## Consequences

- Verified in Phase 0: signed PUT/GET/DELETE round trip works, and anonymous access is rejected (403).
- `S3_ENDPOINT` in `.env.example` is `http://localhost:8333`.
- The blueprint's "MinIO" mentions should be read as "S3-compatible storage".
