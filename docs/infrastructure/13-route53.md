# Route53 Module Documentation

> **File**: `src/route53/index.ts`  
> **Purpose**: Creates DNS records pointing to the ALB

---

## Overview

This is a minimal Route53 module that:
- Creates `api.domain.com` → ALB alias record
- Uses an **existing** hosted zone (doesn't create one)
- Assumes web frontend DNS is managed elsewhere (Vercel)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DNS Architecture                              │
│                                                                  │
│  domain.com (Hosted Zone - pre-existing)                        │
│  │                                                              │
│  ├── @ (apex)        → Vercel (managed by Vercel)               │
│  ├── www             → Vercel (managed by Vercel)               │
│  │                                                              │
│  └── api             → ALB (created by this module)             │
│                        ├── /api/*       → API service           │
│                        ├── /socket.io/* → Realtime service      │
│                        └── /ws/*        → Realtime service      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Why Only `api.*` Subdomain?

The architecture assumes:
- **Web frontend**: Deployed to Vercel, which manages its own DNS
- **Mobile apps**: Connect to `api.domain.com`
- **ALB**: Single entry point for API + WebSocket

**Alternative patterns:**

| Pattern | DNS Setup | Pros | Cons |
|---------|-----------|------|------|
| **This approach** | `api.*` only | Clean separation | Vercel manages root |
| Separate subdomains | `api.*` + `ws.*` | Clear service split | More DNS records |
| Everything on ALB | `www.*`, `api.*`, `ws.*` | Single infrastructure | No Vercel benefits |

---

## Code Walkthrough

### Prerequisite Check

```typescript
if (!config.hostedZoneId) {
  throw new Error("hostedZoneId is required when createDns is true");
}
```

**Why existing zone?** Creating a hosted zone:
1. Costs $0.50/month
2. Requires updating domain registrar nameservers
3. Takes time to propagate

Most users already have a hosted zone for their domain.

### API Record (A Record Alias)

```typescript
const apiRecord = new aws.route53.Record(`${baseName}-api-record`, {
  zoneId: config.hostedZoneId,
  name: `api.${config.domainName}`,
  type: "A",
  aliases: [{
    name: albOutputs.alb.dnsName,
    zoneId: albOutputs.alb.zoneId,
    evaluateTargetHealth: true,
  }],
});
```

### Why Alias Instead of CNAME?

| Record Type | Works For | Apex Domain | Cost |
|-------------|-----------|-------------|------|
| **A (Alias)** ✓ | ALB, CloudFront, S3 | Yes | Free queries |
| CNAME | Any hostname | No | Standard query cost |

**Alias benefits:**
1. No query charges (Route53 → AWS service)
2. Works at zone apex if needed
3. Automatic IP updates when ALB IPs change

### `evaluateTargetHealth: true`

```typescript
evaluateTargetHealth: true,
```

**What it does:** Route53 checks if ALB is healthy before returning the record.

**In practice:** If ALB has no healthy targets, Route53 can return NXDOMAIN or failover to another record (if configured).

---

## What's NOT Created

This module intentionally doesn't create:

### 1. The Hosted Zone Itself

```typescript
// NOT created:
// new aws.route53.Zone(...)
```

**Why?** Zone creation requires updating nameservers at your domain registrar. This is a one-time setup done outside Pulumi.

### 2. Web Frontend Records

```typescript
// NOT created:
// domain.com → Vercel
// www.domain.com → Vercel
```

**Why?** Vercel manages these automatically when you add a custom domain in their dashboard.

### 3. Separate WebSocket Record

```typescript
// NOT created:
// ws.domain.com → ALB
```

**Why?** Single `api.*` subdomain handles both REST and WebSocket traffic via path routing.

---

## Extending for Multi-Subdomain Setup

If you need separate subdomains:

```typescript
// Add these records for separate routing:

const wsRecord = new aws.route53.Record(`${baseName}-ws-record`, {
  zoneId: config.hostedZoneId,
  name: `ws.${config.domainName}`,
  type: "A",
  aliases: [{
    name: albOutputs.alb.dnsName,
    zoneId: albOutputs.alb.zoneId,
    evaluateTargetHealth: true,
  }],
});

const adminRecord = new aws.route53.Record(`${baseName}-admin-record`, {
  zoneId: config.hostedZoneId,
  name: `admin.${config.domainName}`,
  type: "A",
  aliases: [{
    name: albOutputs.alb.dnsName,
    zoneId: albOutputs.alb.zoneId,
    evaluateTargetHealth: true,
  }],
});
```

---

## Exports

```typescript
return {
  hostedZoneId: config.hostedZoneId,
  apiRecord,
};
```

| Export | Used By |
|--------|---------|
| `hostedZoneId` | Reference for other modules |
| `apiRecord` | Rarely used directly |

---

## Cost

### Route53 Pricing

| Resource | Cost |
|----------|------|
| Hosted Zone | $0.50/month |
| Standard Queries | $0.40 per million |
| Alias Queries (to AWS services) | **Free** |

**For this setup:** Only the existing hosted zone cost ($0.50/month). Alias queries to ALB are free.

---

## DNS Propagation

After running `pulumi up`:

```bash
# Check if record exists
dig api.example.com

# Expected output:
api.example.com.  60  IN  A  <ALB-IP-1>
api.example.com.  60  IN  A  <ALB-IP-2>
```

**Propagation time:** Usually instant for alias records (no caching issues with CNAME).

---

## Common Issues

### Zone ID vs Domain Name

```typescript
// Wrong: Using domain name as zone ID
zoneId: "example.com"  // ❌

// Correct: Using actual zone ID
zoneId: "Z1234567890ABC"  // ✓
```

**Find your zone ID:**
```bash
aws route53 list-hosted-zones --query "HostedZones[?Name=='example.com.'].Id"
```

### Record Already Exists

```
Error: Record already exists
```

**Solutions:**
1. Import existing record: `pulumi import`
2. Delete old record first
3. Use different record name

### Vercel DNS Conflict

If Vercel is also managing `api.*`:
1. Remove the record from Vercel dashboard
2. Run `pulumi up` to create AWS record
3. OR use different subdomain (`backend.*`)
