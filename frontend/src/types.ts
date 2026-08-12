export interface Cluster {
  workspace: string
  name: string
  id: string
  state: string
  state_message: string
  termination_code: string
  termination_type: string
  creator: string
  spark_version: string
  node_type: string
  num_workers: string | number
  cluster_source: string
  is_job_cluster: boolean
  is_pipeline_cluster: boolean
  tags: Record<string, string>
  tag_str: string
}

export interface Warehouse {
  workspace: string
  name: string
  id: string
  state: string
  creator: string
  size: string
  type: string
  auto_stop_mins: string | number
  min_num_clusters: number
  max_num_clusters: number
  num_clusters: number
  num_active_sessions: number
  tags: Record<string, string>
  tag_str: string
}

export interface PipelineUpdate {
  update_id: string
  state: string
}

export interface Pipeline {
  workspace: string
  name: string
  id: string
  state: string
  creator: string
  cluster_id: string
  latest_updates: PipelineUpdate[]
}

export interface JobRun {
  workspace: string
  run_id: string
  job_id: string
  run_name: string
  state: string
  result_state: string
  start_time_ms: number
  duration_ms: number
  trigger: string
  run_type: string
}

export interface StateChange {
  snapshot_time: string | null
  resource_type: string
  resource_id: string
  resource_name: string
  workspace: string
  prev_state: string
  state: string
  creator: string
}

export interface UptimeRow {
  resource_type: string
  resource_id: string
  resource_name: string
  workspace: string
  total_snapshots: number
  running_snapshots: number
}

export interface HistoryResponse {
  available: boolean
  changes: StateChange[]
  uptime: UptimeRow[]
}

export interface Filters {
  workspace: string
  state: string
  tagKey: string
  tagValue: string
}

export type LogLevel = 'info' | 'success' | 'warning' | 'error'

export interface LogEntry {
  time: string
  level: LogLevel
  message: string
}

// ── Settings ────────────────────────────────────────────────────────────────

export interface LakebaseSettings {
  endpoint: string
  database: string
}

export interface JsonStorageSettings {
  enabled: boolean
  path: string
}

export interface AccountSpSettings {
  account_id:    string
  client_id:     string
  client_secret: string  // empty string in GET responses (redacted server-side)
}

export interface WorkspaceConfig {
  name:          string
  host:          string
  region?:       string
  enabled:       boolean
  current?:      boolean
  workspace_id?: number  // Numeric workspace ID; used for permission management
}

export interface AppSettings {
  lakebase:                  LakebaseSettings
  json_storage:              JsonStorageSettings
  account_sp?:               AccountSpSettings
  workspaces?:               WorkspaceConfig[]
  request_timeout_seconds?:  number
}

export interface TestResult {
  ok: boolean
  message: string
  latency_ms?: number | null
  resolved_path?: string
}
