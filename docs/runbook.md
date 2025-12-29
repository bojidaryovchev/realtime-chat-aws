# Operational Runbook

This runbook provides step-by-step procedures for common operational tasks and incident response for the Realtime Chat AWS infrastructure.

## Table of Contents

- [Service Overview](#service-overview)
- [Health Checks](#health-checks)
- [Common Incidents](#common-incidents)
  - [High CPU Utilization](#high-cpu-utilization)
  - [Database Connection Issues](#database-connection-issues)
  - [Redis Connection Issues](#redis-connection-issues)
  - [WebSocket Connection Drops](#websocket-connection-drops)
  - [High Error Rates](#high-error-rates)
  - [SQS Queue Backlog](#sqs-queue-backlog)
- [Scaling Procedures](#scaling-procedures)
- [Deployment Procedures](#deployment-procedures)
- [Disaster Recovery](#disaster-recovery)
- [Useful Commands](#useful-commands)

---

## Service Overview

| Service | Purpose | Port | Health Endpoint |
|---------|---------|------|-----------------|
| API | REST/GraphQL endpoints | 3000 | `/health` |
| Realtime | WebSocket connections (Socket.IO) | 3001 | `/health` |
| Workers | SQS queue consumers | 3002 | `/health` |

### Architecture Quick Reference

```
Internet → WAF → ALB → ECS Services → RDS + Redis
                        ↓
                      SQS (Workers)
```

### Key Metrics to Monitor

| Metric | Service | Warning | Critical |
|--------|---------|---------|----------|
| CPU | ECS | 70% | 85% |
| Memory | ECS | 70% | 85% |
| Connections | RDS | 70% of max | 90% of max |
| Memory | Redis | 70% | 85% |
| Active Connections | Realtime | 80% of max/task | 95% of max/task |
| Event Loop Lag | Realtime | 100ms | 200ms |
| Queue Depth | SQS | 1000 | 5000 |
| DLQ Messages | SQS | 1 | 10 |

---

## Health Checks

### Quick Health Check

```bash
# Set environment
export STACK="dev"  # or 1k-dau, 10k-dau, etc.
export ALB_DNS=$(pulumi stack output albDnsName -s $STACK)

# Check API health
curl -s https://$ALB_DNS/api/health | jq

# Check Realtime health (Socket.IO polling endpoint)
curl -s "https://$ALB_DNS/socket.io/?EIO=4&transport=polling"
```

### ECS Service Status

```bash
# Get cluster name
export CLUSTER=$(pulumi stack output ecsClusterName -s $STACK)

# Check all services
aws ecs describe-services \
  --cluster $CLUSTER \
  --services $(pulumi stack output apiServiceName -s $STACK) \
              $(pulumi stack output realtimeServiceName -s $STACK) \
              $(pulumi stack output workersServiceName -s $STACK) \
  --query 'services[*].{name:serviceName,desired:desiredCount,running:runningCount,status:status}' \
  --output table
```

### RDS Health

```bash
# Check RDS instance status
aws rds describe-db-instances \
  --query 'DBInstances[*].{id:DBInstanceIdentifier,status:DBInstanceStatus,cpu:PerformanceInsightsEnabled}' \
  --output table
```

---

## Common Incidents

### High CPU Utilization

#### Symptoms
- CloudWatch alarm: `*-high-cpu` triggered
- Slow response times
- Request timeouts

#### Investigation

```bash
# Check which service has high CPU
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ClusterName,Value=$CLUSTER Name=ServiceName,Value=$SERVICE_NAME \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average Maximum \
  --output table
```

#### Resolution

1. **Immediate**: Scale out the service
   ```bash
   aws ecs update-service \
     --cluster $CLUSTER \
     --service $SERVICE_NAME \
     --desired-count $((CURRENT_COUNT + 2))
   ```

2. **If auto-scaling isn't responding**: Check auto-scaling configuration
   ```bash
   aws application-autoscaling describe-scaling-policies \
     --service-namespace ecs \
     --resource-id service/$CLUSTER/$SERVICE_NAME
   ```

3. **Investigate root cause**:
   - Check CloudWatch Logs for error patterns
   - Review recent deployments
   - Check for traffic spikes

---

### Database Connection Issues

#### Symptoms
- Application errors: "Connection refused" or "Too many connections"
- CloudWatch alarm: `*-rds-high-connections`
- Slow queries

#### Investigation

```bash
# Check current connections
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=$DB_IDENTIFIER \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 \
  --statistics Average Maximum
```

#### Resolution

1. **If RDS Proxy is enabled**: Check proxy health
   ```bash
   aws rds describe-db-proxies \
     --query 'DBProxies[*].{name:DBProxyName,status:Status}'
   ```

2. **Kill idle connections** (connect via ECS Exec):
   ```bash
   # Get a shell in API container
   aws ecs execute-command \
     --cluster $CLUSTER \
     --task $TASK_ID \
     --container api \
     --interactive \
     --command "/bin/sh"
   
   # Inside container, check connections
   psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"
   psql $DATABASE_URL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '10 minutes';"
   ```

3. **If approaching max connections**: Increase instance size or enable RDS Proxy

---

### Redis Connection Issues

#### Symptoms
- Socket.IO adapter errors
- Session/presence data stale
- CloudWatch alarm: `*-redis-high-*`

#### Investigation

```bash
# Check Redis cluster status
aws elasticache describe-replication-groups \
  --query 'ReplicationGroups[*].{id:ReplicationGroupId,status:Status,nodeType:CacheNodeType}'

# Check current connections
aws cloudwatch get-metric-statistics \
  --namespace AWS/ElastiCache \
  --metric-name CurrConnections \
  --dimensions Name=ReplicationGroupId,Value=$REDIS_CLUSTER_ID \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 \
  --statistics Average Maximum
```

#### Resolution

1. **Verify Redis AUTH**: Check Secrets Manager for the auth token
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id $REDIS_AUTH_SECRET_ARN \
     --query 'SecretString' --output text
   ```

2. **If memory pressure**: Clear non-essential keys or scale up
   ```bash
   # Connect via ECS Exec and use redis-cli
   redis-cli -h $REDIS_HOST --tls -a $REDIS_PASSWORD
   > INFO memory
   > DBSIZE
   ```

3. **If network issues**: Check security group rules

---

### WebSocket Connection Drops

#### Symptoms
- Users reporting disconnections
- High reconnection rate in logs
- CloudWatch alarm: `*-realtime-unhealthy-targets`

#### Investigation

```bash
# Check ALB target health
aws elbv2 describe-target-health \
  --target-group-arn $REALTIME_TG_ARN \
  --query 'TargetHealthDescriptions[*].{target:Target.Id,health:TargetHealth.State,reason:TargetHealth.Reason}'

# Check for 5xx errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=TargetGroup,Value=$REALTIME_TG_ARN_SUFFIX \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 \
  --statistics Sum
```

#### Resolution

1. **Check realtime service logs**:
   ```bash
   aws logs tail /ecs/$PROJECT-$ENV/realtime --follow
   ```

2. **Verify Redis adapter connectivity** (required for multi-instance pub/sub)

3. **Check for event loop lag**:
   ```bash
   aws cloudwatch get-metric-statistics \
     --namespace $PROJECT-$ENV \
     --metric-name EventLoopLagMs \
     --dimensions Name=ServiceName,Value=$PROJECT-$ENV-realtime \
     --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
     --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
     --period 60 \
     --statistics p95
   ```

4. **If WAF is blocking**: Check WAF logs
   ```bash
   aws wafv2 get-sampled-requests \
     --web-acl-arn $WAF_ACL_ARN \
     --rule-metric-name SocketIORateLimit \
     --scope REGIONAL \
     --time-window StartTime=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ),EndTime=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
     --max-items 100
   ```

---

### High Error Rates

#### Symptoms
- CloudWatch alarm: `*-alb-5xx`
- Error logs increasing
- User-reported issues

#### Investigation

```bash
# Check ALB 5xx errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_ELB_5XX_Count \
  --dimensions Name=LoadBalancer,Value=$ALB_ARN_SUFFIX \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 \
  --statistics Sum

# Check ALB access logs (if Athena is set up)
aws athena start-query-execution \
  --query-string "SELECT * FROM alb_logs WHERE elb_status_code >= 500 ORDER BY time DESC LIMIT 100" \
  --work-group primary \
  --query-execution-context Database=$ATHENA_DATABASE
```

#### Resolution

1. **Identify the source**: Check if errors are from API or Realtime service
2. **Review recent deployments**: Rollback if necessary
3. **Check downstream dependencies**: RDS, Redis, external APIs

---

### SQS Queue Backlog

#### Symptoms
- CloudWatch alarm: `*-sqs-*-dlq` or `*-workers-message-age`
- Push notifications delayed
- Offline messages not delivered

#### Investigation

```bash
# Check queue depth
aws sqs get-queue-attributes \
  --queue-url $PUSH_QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateAgeOfOldestMessage

# Check DLQ
aws sqs get-queue-attributes \
  --queue-url $PUSH_DLQ_URL \
  --attribute-names ApproximateNumberOfMessages
```

#### Resolution

1. **Scale workers**:
   ```bash
   aws ecs update-service \
     --cluster $CLUSTER \
     --service $WORKERS_SERVICE \
     --desired-count $((CURRENT_COUNT + 2))
   ```

2. **If DLQ has messages**: Investigate failure reason
   ```bash
   # Receive messages from DLQ to inspect
   aws sqs receive-message \
     --queue-url $PUSH_DLQ_URL \
     --max-number-of-messages 10 \
     --wait-time-seconds 5
   ```

3. **Redrive DLQ messages** (after fixing the issue):
   ```bash
   aws sqs start-message-move-task \
     --source-arn $DLQ_ARN \
     --destination-arn $MAIN_QUEUE_ARN
   ```

---

## Scaling Procedures

### Manual ECS Scaling

```bash
# Scale API service
aws ecs update-service \
  --cluster $CLUSTER \
  --service $(pulumi stack output apiServiceName -s $STACK) \
  --desired-count 4

# Scale Realtime service
aws ecs update-service \
  --cluster $CLUSTER \
  --service $(pulumi stack output realtimeServiceName -s $STACK) \
  --desired-count 6
```

### RDS Scaling

```bash
# Modify instance class (causes brief downtime unless Multi-AZ)
aws rds modify-db-instance \
  --db-instance-identifier $DB_IDENTIFIER \
  --db-instance-class db.t3.large \
  --apply-immediately
```

### Redis Scaling

```bash
# Modify node type
aws elasticache modify-replication-group \
  --replication-group-id $REDIS_CLUSTER_ID \
  --cache-node-type cache.r6g.large \
  --apply-immediately
```

---

## Deployment Procedures

### Standard Deployment

```bash
# Build and push new image
docker build -t $ECR_REPO:$VERSION ./apps/api
docker push $ECR_REPO:$VERSION

# Update service (forces new deployment)
aws ecs update-service \
  --cluster $CLUSTER \
  --service $SERVICE_NAME \
  --force-new-deployment

# Wait for deployment to complete
aws ecs wait services-stable \
  --cluster $CLUSTER \
  --services $SERVICE_NAME
```

### Rollback Procedure

```bash
# List recent task definitions
aws ecs list-task-definitions \
  --family-prefix $TASK_FAMILY \
  --sort DESC \
  --max-items 5

# Update service to use previous task definition
aws ecs update-service \
  --cluster $CLUSTER \
  --service $SERVICE_NAME \
  --task-definition $PREVIOUS_TASK_DEF_ARN
```

---

## Disaster Recovery

### Cross-Region Recovery

If the primary region is unavailable and you have cross-region backups enabled:

1. **Restore RDS in DR region**:
   ```bash
   # List available recovery points
   aws backup list-recovery-points-by-backup-vault \
     --backup-vault-name $DR_VAULT_NAME \
     --region $DR_REGION

   # Restore to new RDS instance
   aws backup start-restore-job \
     --recovery-point-arn $RECOVERY_POINT_ARN \
     --iam-role-arn $BACKUP_ROLE_ARN \
     --metadata '{"DBInstanceIdentifier":"recovered-db","DBSubnetGroupName":"dr-subnet-group"}' \
     --region $DR_REGION
   ```

2. **Deploy infrastructure in DR region**:
   ```bash
   # Update Pulumi config for DR region
   pulumi config set aws:region $DR_REGION
   pulumi up
   ```

3. **Update DNS** to point to DR region

### Point-in-Time Recovery (RDS)

```bash
# Restore to specific timestamp
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier $DB_IDENTIFIER \
  --target-db-instance-identifier $DB_IDENTIFIER-restored \
  --restore-time 2025-01-15T10:00:00Z \
  --db-subnet-group-name $SUBNET_GROUP
```

---

## Useful Commands

### ECS Exec (Shell Access)

```bash
# List running tasks
aws ecs list-tasks \
  --cluster $CLUSTER \
  --service-name $SERVICE_NAME

# Get shell access
aws ecs execute-command \
  --cluster $CLUSTER \
  --task $TASK_ID \
  --container api \
  --interactive \
  --command "/bin/sh"
```

### Log Tailing

```bash
# API logs
aws logs tail /ecs/$PROJECT-$ENV/api --follow

# Realtime logs
aws logs tail /ecs/$PROJECT-$ENV/realtime --follow

# Workers logs
aws logs tail /ecs/$PROJECT-$ENV/workers --follow

# Filter for errors
aws logs tail /ecs/$PROJECT-$ENV/api --follow --filter-pattern "ERROR"
```

### CloudWatch Insights Query

```bash
# Find top errors in last hour
aws logs start-query \
  --log-group-name /ecs/$PROJECT-$ENV/api \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /ERROR/ | stats count(*) by bin(5m)'
```

### Secrets Management

```bash
# List secrets
aws secretsmanager list-secrets \
  --filter Key=name,Values=$PROJECT-$ENV

# Get secret value
aws secretsmanager get-secret-value \
  --secret-id $SECRET_ARN \
  --query 'SecretString' --output text
```

---

## Contact & Escalation

| Level | Time | Contact |
|-------|------|---------|
| L1 - On-call | 0-15 min | PagerDuty / On-call rotation |
| L2 - Engineering | 15-30 min | #engineering-oncall Slack |
| L3 - Infrastructure | 30+ min | Infrastructure team lead |

### When to Escalate

- Service is completely down
- Data loss suspected
- Security incident
- Unable to resolve within 30 minutes
