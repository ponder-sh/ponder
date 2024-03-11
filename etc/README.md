# Miscellaneous

This directory contains miscellaneous files, such as example Grafana dashboards and Prometheus configuration.

_Note: The files in this directory are adapted from `reth`._

## Overview

- [**Prometheus**](./prometheus/prometheus.yml): An example Prometheus configuration.
- [**Grafana**](./grafana/): Example Grafana dashboards & data sources.

## Run monitoring services (Docker Compose)

To start Ponder's monitoring services locally, run:

```sh
docker compose -p ponder-monitoring -f ./etc/docker-monitoring.yml up
```

This will start a Prometheus instance that collects metrics from `localhost:42069/metrics` and a Grafana server that uses Prometheus as a data source. The Grafana dashboard will be exposed on `localhost:3000` and accessible via default credentials:

```yaml
username: admin
password: admin
```
