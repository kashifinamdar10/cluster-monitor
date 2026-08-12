/**
 * Construct Databricks workspace deep-link URLs for each resource type.
 *
 * URL patterns (stable across cloud providers):
 *   Workspace → <host>
 *   Cluster   → /#setting/clusters/<id>/configuration
 *   Warehouse → /sql/warehouses/<id>
 *   Pipeline  → /pipelines/<id>
 *   Job Run   → /jobs/<jobId>/runs/<runId>
 */

export function workspaceUrl(host: string): string {
  return host
}

export function clusterUrl(host: string, clusterId: string): string {
  return `${host}/#setting/clusters/${clusterId}/configuration`
}

export function warehouseUrl(host: string, warehouseId: string): string {
  return `${host}/sql/warehouses/${warehouseId}`
}

export function pipelineUrl(host: string, pipelineId: string): string {
  return `${host}/pipelines/${pipelineId}`
}

export function jobRunUrl(host: string, jobId: string, runId: string): string {
  return `${host}/jobs/${jobId}/runs/${runId}`
}

/** Shared link component props. */
export interface LinkProps {
  href: string
  children: React.ReactNode
  title?: string
}
