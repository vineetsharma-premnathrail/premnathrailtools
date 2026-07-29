# Deployment Guide

How to deploy Premnathrail Portal to production.

## Prerequisites

- Docker installed
- Kubernetes cluster (or use managed: AWS EKS, Azure AKS, GCP GKE)
- PostgreSQL database (managed: AWS RDS, Azure Database, Google Cloud SQL)
- Domain name with DNS configured
- SSL certificate (use Let's Encrypt)

## Architecture

```
┌─────────────────────────────────────┐
│ CDN (CloudFlare/CloudFront)        │ ← Frontend static files
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│ Load Balancer (Nginx/HAProxy)      │ ← Reverse proxy, HTTPS termination
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│ Kubernetes Cluster                  │
│ ├─ FastAPI Pod (4 replicas)        │ ← Auto-scale based on CPU/memory
│ ├─ FastAPI Pod                     │
│ ├─ FastAPI Pod                     │
│ └─ FastAPI Pod                     │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│ PostgreSQL Database                │ ← Multi-AZ replication
└─────────────────────────────────────┘
```

## Step 1: Containerize Application

### Dockerfile

Create `Dockerfile` in project root:

```dockerfile
FROM python:3.14-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Build image

```bash
docker build -t premnathrail-portal:1.0.0 .
docker tag premnathrail-portal:1.0.0 your-registry/premnathrail-portal:1.0.0
docker push your-registry/premnathrail-portal:1.0.0
```

## Step 2: Deploy to Kubernetes

### Kubernetes manifests

**deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: premnathrail-portal
spec:
  replicas: 4
  selector:
    matchLabels:
      app: premnathrail-portal
  template:
    metadata:
      labels:
        app: premnathrail-portal
    spec:
      containers:
      - name: app
        image: your-registry/premnathrail-portal:1.0.0
        ports:
        - containerPort: 8000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: database-url
        - name: SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: secret-key
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 10
```

**service.yaml:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: premnathrail-portal
spec:
  selector:
    app: premnathrail-portal
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8000
  type: LoadBalancer
```

### Apply manifests

```bash
kubectl create secret generic app-secrets \
  --from-literal=database-url="..." \
  --from-literal=secret-key="..."

kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
```

## Step 3: Setup Database

### AWS RDS

```bash
# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier premnathrail-prod \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --master-username postgres \
  --master-user-password "<strong-password>"
```

### Apply migrations

```bash
alembic upgrade head
```

## Step 4: Configure DNS & HTTPS

### Point domain to load balancer

```bash
# Get load balancer IP
kubectl get svc premnathrail-portal

# In DNS provider (Route53, Cloudflare, etc.):
# CNAME: api.premnathrail.com → <load-balancer-ip>
```

### SSL certificate (Let's Encrypt)

```bash
# Using cert-manager in Kubernetes
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml
```

## Step 5: Monitoring & Logging

### Setup logging

```bash
# Using ELK (Elasticsearch, Logstash, Kibana) or CloudWatch
# Configure app to send logs to central location
```

### Setup monitoring

```bash
# Using Prometheus + Grafana
# Monitor: CPU, memory, request latency, error rate
```

## Deployment Checklist

- [ ] Docker image builds successfully
- [ ] All tests pass (`pytest app/tests`)
- [ ] Database migrations tested
- [ ] Environment variables configured
- [ ] Secrets secured (not in code)
- [ ] Load balancer configured
- [ ] HTTPS/SSL working
- [ ] Database backups configured
- [ ] Monitoring alerts setup
- [ ] Rollback plan documented

## Rollback

If deployment fails:

```bash
# Revert to previous image
kubectl set image deployment/premnathrail-portal \
  app=your-registry/premnathrail-portal:1.0.0-previous

# Verify
kubectl rollout status deployment/premnathrail-portal
```

## Maintenance

### Backup database

```bash
# Automated backup via RDS (AWS does daily backups)
# Manual backup:
pg_dump -U postgres -h <db-host> premnathrail > backup.sql
```

### Update dependencies

```bash
# Only in staging first
pip install --upgrade -r requirements.txt
# Then rebuild Docker image and test
```

### Monitor performance

- Check CPU/memory usage
- Monitor database query times
- Track error rates
- Alert if metrics exceed thresholds

## Security Considerations

- [ ] HTTPS only (redirect HTTP → HTTPS)
- [ ] Rate limiting enabled
- [ ] CORS configured
- [ ] SQL injection protection (SQLAlchemy parameterized queries)
- [ ] Secrets not in code (use environment variables)
- [ ] Database credentials rotated quarterly
- [ ] Regular security patches applied

## Cost Optimization

- Use auto-scaling (reduce replicas during off-hours)
- Use spot instances for non-critical services
- Monitor and alert on unexpected costs
- Clean up unused resources

## Troubleshooting

### Pod crashes
```bash
kubectl logs <pod-name>
kubectl describe pod <pod-name>
```

### Database connection errors
```bash
# Check security groups allow connection
# Verify DATABASE_URL is correct
psql -U postgres -h <db-host> -d premnathrail
```

### High latency
```bash
# Check database query performance
# Check network latency
# Monitor CPU/memory usage
```

---

**Next:** Read [RUNBOOK.md](../runbook/RUNBOOK.md) for operational procedures.
