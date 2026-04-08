# Fzfetch GHCR Image Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions workflow that builds and pushes `ghcr.io/zhpjy/fzfetch` on `main`, version tags, and manual dispatch while maintaining `latest`.

**Architecture:** Use the official Docker GitHub Actions chain: checkout, Buildx setup, GHCR login with `GITHUB_TOKEN`, metadata generation for tags and OCI labels, then build-and-push from the root `Dockerfile`. Keep the implementation isolated to a single workflow file so the existing image layout and local Docker workflow stay unchanged.

**Tech Stack:** GitHub Actions, GHCR, Docker Buildx, `docker/metadata-action`, `docker/build-push-action`

---

### Task 1: Add the publishing workflow

**Files:**
- Create: `.github/workflows/docker-image.yml`
- Reference: `Dockerfile`
- Reference: `docs/superpowers/specs/2026-04-08-ghcr-image-publishing-design.md`

- [ ] **Step 1: Write the failing workflow definition skeleton**

```yaml
name: Docker Image

on:
  push:
    branches:
      - main

jobs:
  docker:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
```

- [ ] **Step 2: Run syntax validation to verify the workflow is still incomplete**

Run: `python - <<'PY'\nimport yaml\nfrom pathlib import Path\nprint(yaml.safe_load(Path('.github/workflows/docker-image.yml').read_text())['on'])\nPY`

Expected: PASS for YAML parsing, but the workflow still lacks tag/manual triggers and build-push steps required by the spec.

- [ ] **Step 3: Write the full workflow with triggers, login, metadata, and push**

```yaml
name: Docker Image

on:
  push:
    branches:
      - main
    tags:
      - 'v*'
  workflow_dispatch:

env:
  IMAGE_NAME: ghcr.io/zhpjy/fzfetch

jobs:
  docker:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Generate image metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}
            type=raw,value=main,enable=${{ github.ref == 'refs/heads/main' }}
            type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}
            type=ref,event=tag
            type=raw,value=latest,enable=${{ github.event_name == 'workflow_dispatch' }}
            type=sha,format=short,prefix=sha-,enable=${{ github.event_name == 'workflow_dispatch' }}

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 4: Run local validation to verify the workflow content matches the trigger and tag rules**

Run: `python - <<'PY'\nimport yaml\nfrom pathlib import Path\nworkflow = yaml.safe_load(Path('.github/workflows/docker-image.yml').read_text())\nassert workflow['env']['IMAGE_NAME'] == 'ghcr.io/zhpjy/fzfetch'\non = workflow['on']\nassert 'workflow_dispatch' in on\nassert on['push']['branches'] == ['main']\nassert on['push']['tags'] == ['v*']\nsteps = workflow['jobs']['docker']['steps']\nassert any(step.get('uses') == 'docker/login-action@v3' for step in steps)\nassert any(step.get('uses') == 'docker/metadata-action@v5' for step in steps)\nassert any(step.get('uses') == 'docker/build-push-action@v6' for step in steps)\nprint('workflow structure ok')\nPY`

Expected: `workflow structure ok`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/docker-image.yml
git commit -m "ci: publish docker image to ghcr"
```

### Task 2: Verify release semantics against the design

**Files:**
- Modify: `.github/workflows/docker-image.yml`
- Reference: `docs/superpowers/specs/2026-04-08-ghcr-image-publishing-design.md`

- [ ] **Step 1: Review the workflow tags block against the spec**

```yaml
tags: |
  type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}
  type=raw,value=main,enable=${{ github.ref == 'refs/heads/main' }}
  type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}
  type=ref,event=tag
  type=raw,value=latest,enable=${{ github.event_name == 'workflow_dispatch' }}
  type=sha,format=short,prefix=sha-,enable=${{ github.event_name == 'workflow_dispatch' }}
```

- [ ] **Step 2: Run a focused inspection check for required tag patterns**

Run: `rg -n "type=raw,value=latest|type=raw,value=main|type=ref,event=tag|type=sha,format=short,prefix=sha-" .github/workflows/docker-image.yml`

Expected:

```text
.github/workflows/docker-image.yml:<line>:            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}
.github/workflows/docker-image.yml:<line>:            type=raw,value=main,enable=${{ github.ref == 'refs/heads/main' }}
.github/workflows/docker-image.yml:<line>:            type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}
.github/workflows/docker-image.yml:<line>:            type=ref,event=tag
.github/workflows/docker-image.yml:<line>:            type=raw,value=latest,enable=${{ github.event_name == 'workflow_dispatch' }}
.github/workflows/docker-image.yml:<line>:            type=sha,format=short,prefix=sha-,enable=${{ github.event_name == 'workflow_dispatch' }}
```

- [ ] **Step 3: Adjust the workflow if any required tag rule is missing**

```yaml
with:
  images: ${{ env.IMAGE_NAME }}
  tags: |
    type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}
    type=raw,value=main,enable=${{ github.ref == 'refs/heads/main' }}
    type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}
    type=ref,event=tag
    type=raw,value=latest,enable=${{ github.event_name == 'workflow_dispatch' }}
    type=sha,format=short,prefix=sha-,enable=${{ github.event_name == 'workflow_dispatch' }}
```

- [ ] **Step 4: Re-run the focused inspection check**

Run: `rg -n "type=raw,value=latest|type=raw,value=main|type=ref,event=tag|type=sha,format=short,prefix=sha-" .github/workflows/docker-image.yml`

Expected: All required patterns are present exactly once or in the intended count from the final workflow.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/docker-image.yml
git commit -m "ci: finalize ghcr image tags"
```

### Task 3: Final verification

**Files:**
- Modify: `.github/workflows/docker-image.yml`

- [ ] **Step 1: Parse the workflow as YAML**

Run: `python - <<'PY'\nimport yaml\nfrom pathlib import Path\nyaml.safe_load(Path('.github/workflows/docker-image.yml').read_text())\nprint('yaml ok')\nPY`

Expected: `yaml ok`

- [ ] **Step 2: Verify the publishing actions are pinned to the intended major versions**

Run: `rg -n "actions/checkout@v4|docker/setup-buildx-action@v3|docker/login-action@v3|docker/metadata-action@v5|docker/build-push-action@v6" .github/workflows/docker-image.yml`

Expected:

```text
.github/workflows/docker-image.yml:<line>:        uses: actions/checkout@v4
.github/workflows/docker-image.yml:<line>:        uses: docker/setup-buildx-action@v3
.github/workflows/docker-image.yml:<line>:        uses: docker/login-action@v3
.github/workflows/docker-image.yml:<line>:        uses: docker/metadata-action@v5
.github/workflows/docker-image.yml:<line>:        uses: docker/build-push-action@v6
```

- [ ] **Step 3: Reconfirm the local Docker image still builds from the same Dockerfile**

Run: `docker build -t fzfetch:test .`
Expected: PASS with a successfully built local image

- [ ] **Step 4: Inspect git diff for the workflow-only change set**

Run: `git diff -- .github/workflows/docker-image.yml docs/superpowers/specs/2026-04-08-ghcr-image-publishing-design.md docs/superpowers/plans/2026-04-08-ghcr-image-publishing.md`
Expected: The diff only contains the new GHCR design doc, plan doc, and workflow file

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/docker-image.yml docs/superpowers/specs/2026-04-08-ghcr-image-publishing-design.md docs/superpowers/plans/2026-04-08-ghcr-image-publishing.md
git commit -m "docs: add ghcr publishing plan"
```
