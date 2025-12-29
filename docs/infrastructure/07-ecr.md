# ECR Module Documentation

> **File**: `src/ecr/index.ts`  
> **Purpose**: Creates container image repositories for ECS services

---

## Overview

Amazon ECR (Elastic Container Registry) stores Docker images that ECS pulls when deploying services.

### What This Module Creates

| Resource | Purpose |
|----------|---------|
| API Repository | `{project}/api` - API service images |
| Realtime Repository | `{project}/realtime` - Socket.IO service images |
| Workers Repository | `{project}/workers` - Background worker images |
| Lifecycle Policies | Automatic cleanup of old images |

---

## Key Configuration

```typescript
const apiRepository = new aws.ecr.Repository(`${baseName}-api-repo`, {
  name: `${baseName}/api`,
  imageScanningConfiguration: {
    scanOnPush: true,
  },
  imageTagMutability: config.environment === "prod" ? "IMMUTABLE" : "MUTABLE",
  encryptionConfigurations: [{
    encryptionType: "AES256",
  }],
});
```

### Settings Explained

| Setting | Value | Why |
|---------|-------|-----|
| `scanOnPush: true` | Scan every image | Detect vulnerabilities automatically |
| `imageTagMutability: IMMUTABLE` (prod) | Can't overwrite tags | Prevents accidental overwrites, audit trail |
| `imageTagMutability: MUTABLE` (dev) | Tags can be reused | Faster iteration with `latest` tag |
| `encryptionType: AES256` | Server-side encryption | Data at rest protection (free) |

---

## Lifecycle Policy

```typescript
{
  rules: [
    {
      rulePriority: 1,
      description: "Keep last 20 version-tagged images (v*, sha-*)",
      selection: {
        tagStatus: "tagged",
        tagPrefixList: ["v", "sha-"],
        countType: "imageCountMoreThan",
        countNumber: 20,
      },
      action: { type: "expire" },
    },
    {
      rulePriority: 2,
      description: "Keep last 5 branch-tagged images (latest, main, dev)",
      selection: {
        tagPrefixList: ["latest", "main", "dev"],
        countNumber: 5,
      },
    },
    {
      rulePriority: 3,
      description: "Delete untagged images older than 7 days",
      selection: {
        tagStatus: "untagged",
        countType: "sinceImagePushed",
        countNumber: 7,
      },
    },
  ],
}
```

### Retention Strategy

| Image Type | Retention | Reason |
|------------|-----------|--------|
| Version tags (v1.0.0, sha-abc123) | Last 20 | Rollback capability |
| Branch tags (latest, main) | Last 5 | Recent builds |
| Untagged | 7 days | Intermediate layers, failed builds |

---

## Cost

- Storage: $0.10/GB/month
- Data transfer: $0.09/GB out (to non-AWS)
- Scanning: First 100 images/month free, then $0.09/image

**Typical cost**: $1-5/month for most projects
