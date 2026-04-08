# Fzfetch GHCR Image Publishing Design

## Goal

Add a GitHub Actions workflow that builds and pushes the project's Docker image to GitHub Container Registry as `ghcr.io/zhpjy/fzfetch`.

The workflow must:

- Push `latest` on `main`
- Push version tags on Git tag releases such as `v0.1.0`
- Also maintain `latest` on tag releases
- Support manual triggering from GitHub Actions

## Scope

This change only adds CI/CD automation for the existing Docker image.

It does not:

- Change the runtime image layout
- Change application behavior
- Add Docker Hub publishing
- Add release-note automation

## Registry And Naming

- Registry: `ghcr.io`
- Owner: `zhpjy`
- Image name: `fzfetch`
- Full image reference: `ghcr.io/zhpjy/fzfetch`

## Trigger Model

The workflow will run on:

- `push` to `main`
- `push` of tags matching `v*`
- `workflow_dispatch`

This gives three release paths:

1. Normal branch publish from `main`
2. Versioned publish from Git tags
3. Manual republish from the GitHub UI

## Tagging Rules

### Push To `main`

When code is pushed to `main`, the workflow will publish:

- `ghcr.io/zhpjy/fzfetch:latest`
- `ghcr.io/zhpjy/fzfetch:main`

This keeps `latest` aligned with the mainline branch and preserves an explicit branch tag.

### Push Git Tag `vX.Y.Z`

When a Git tag like `v0.1.0` is pushed, the workflow will publish:

- `ghcr.io/zhpjy/fzfetch:v0.1.0`
- `ghcr.io/zhpjy/fzfetch:latest`

This keeps versioned releases addressable while also ensuring `latest` stays current after formal releases.

### Manual Trigger

When triggered manually, the workflow will publish:

- `ghcr.io/zhpjy/fzfetch:latest`
- `ghcr.io/zhpjy/fzfetch:sha-<shortsha>`

This makes manual rebuilds easy to consume while keeping the exact source revision traceable.

## Workflow Structure

The workflow file will live at:

- `.github/workflows/docker-image.yml`

The workflow will:

1. Check out the repository
2. Set up Docker Buildx
3. Log in to GHCR using `GITHUB_TOKEN`
4. Generate tags and OCI labels with `docker/metadata-action`
5. Build and push the Docker image with `docker/build-push-action`

## Permissions

The workflow will request:

- `contents: read`
- `packages: write`

These are sufficient for source checkout and GHCR publishing with the repository token.

## Authentication

GHCR login will use:

- Username: `${{ github.actor }}`
- Password: `${{ secrets.GITHUB_TOKEN }}`

This avoids requiring an extra personal access token for the default publishing path.

## Build Inputs

The workflow will build from the existing repository `Dockerfile` at the repository root.

It will not use `docker compose build` because:

- Publishing is clearer against a single image target
- Tag generation is easier to control
- Official Docker actions integrate directly with registry publishing and metadata

## Labels And Metadata

The workflow will add OCI labels through `docker/metadata-action`, including:

- Source repository URL
- Revision SHA
- Image title/name

This improves traceability when inspecting pushed images.

## Error Handling And Failure Modes

Expected failure cases:

- Docker build fails because the project no longer builds
- GHCR push fails because package permissions are missing
- Tag generation does not match branch or tag naming rules

The workflow should fail the run immediately in these cases rather than silently skipping publication.

## Testing Strategy

Verification should cover:

- Workflow YAML validity
- Local parity with the current `docker build -t fzfetch:test .`
- Tag logic inspection in the workflow definition

Practical validation after merge:

- Push to `main` and verify `latest` and `main`
- Push a test tag like `v0.1.0` and verify `v0.1.0` plus `latest`
- Manually trigger the workflow and verify `latest` plus `sha-*`

## Files To Add Or Update

- Create `.github/workflows/docker-image.yml`
- Optionally update documentation if image publishing usage needs to be mentioned later

## Final Design Decision

Use official Docker GitHub Actions to publish `ghcr.io/zhpjy/fzfetch`, with `latest` maintained on `main`, on version tags, and on manual dispatch, while also emitting branch/version/sha tags for traceability.
