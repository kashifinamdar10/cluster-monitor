import type { Cluster, Warehouse, Pipeline, JobRun } from '../types'
import {
  attentionCount,
  clusterNeedsAttention,
  warehouseNeedsAttention,
  pipelineNeedsAttention,
  jobRunNeedsAttention,
} from './NeedsAttentionTab'

interface Props {
  clusters: Cluster[]
  warehouses: Warehouse[]
  pipelines: Pipeline[]
  jobRuns: JobRun[]
  onNavigate: (tab: string) => void
}

function Card({
  count,
  label,
  running,
  extra,
  color,
  onClick,
}: {
  count: number
  label: string
  running: number
  extra?: string
  color: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="card p-4 flex flex-col gap-1 min-w-[140px] text-left
                 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0
                 transition-all duration-150 cursor-pointer focus:outline-none
                 focus:ring-2 focus:ring-offset-2 focus:ring-blue-400
                 dark:focus:ring-offset-slate-900"
    >
      <span className={`text-3xl font-bold ${color}`}>{count}</span>
      <span className="text-sm text-gray-500 font-medium dark:text-slate-300">{label}</span>
      <span className="text-xs text-green-600 dark:text-green-400">{running} running</span>
      {extra && <span className="text-xs text-red-500 dark:text-red-400">{extra}</span>}
    </button>
  )
}

function AttentionCard({
  count, breakdown, onClick,
}: {
  count: number
  breakdown: { clusters: number; warehouses: number; pipelines: number; jobRuns: number }
  onClick: () => void
}) {
  const hasIssues = count > 0
  return (
    <button
      onClick={onClick}
      className={[
        'card p-4 flex flex-col gap-1 min-w-[140px] text-left',
        'hover:shadow-md hover:-translate-y-0.5 active:translate-y-0',
        'transition-all duration-150 cursor-pointer focus:outline-none',
        'focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900',
        hasIssues
          ? 'border-red-300 bg-red-50 focus:ring-red-400 dark:border-red-800/60 dark:bg-red-950/30'
          : 'border-green-200 bg-green-50 focus:ring-green-400 dark:border-green-800/50 dark:bg-green-950/20',
      ].join(' ')}
    >
      <span className={`text-3xl font-bold ${hasIssues ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
        {hasIssues ? count : '✓'}
      </span>
      <span className="text-sm font-medium text-gray-600 dark:text-slate-300">Needs Attention</span>
      {hasIssues ? (
        <span className="text-xs text-red-500 dark:text-red-400 leading-relaxed">
          {[
            breakdown.clusters  > 0 && `${breakdown.clusters} cluster${breakdown.clusters  > 1 ? 's' : ''}`,
            breakdown.warehouses > 0 && `${breakdown.warehouses} warehouse${breakdown.warehouses > 1 ? 's' : ''}`,
            breakdown.pipelines  > 0 && `${breakdown.pipelines} pipeline${breakdown.pipelines  > 1 ? 's' : ''}`,
            breakdown.jobRuns    > 0 && `${breakdown.jobRuns} job run${breakdown.jobRuns    > 1 ? 's' : ''}`,
          ].filter(Boolean).join(', ')}
        </span>
      ) : (
        <span className="text-xs text-green-600 dark:text-green-400">All healthy</span>
      )}
    </button>
  )
}

export function SummaryCards({ clusters, warehouses, pipelines, jobRuns, onNavigate }: Props) {
  const interactive = clusters.filter(c => !c.is_job_cluster && !c.is_pipeline_cluster)
  const jobs        = clusters.filter(c => c.is_job_cluster)

  const running = (arr: { state: string }[]) => arr.filter(x => x.state === 'RUNNING').length
  const failed  = (arr: { state: string }[]) => arr.filter(x => x.state === 'FAILED').length

  const pipelineFailed = failed(pipelines)

  const attnBreakdown = {
    clusters:   clusters.filter(clusterNeedsAttention).length,
    warehouses: warehouses.filter(warehouseNeedsAttention).length,
    pipelines:  pipelines.filter(pipelineNeedsAttention).length,
    jobRuns:    jobRuns.filter(jobRunNeedsAttention).length,
  }
  const attnTotal = attentionCount(clusters, warehouses, pipelines, jobRuns)

  return (
    <div className="flex flex-wrap gap-3">
      <AttentionCard
        count={attnTotal}
        breakdown={attnBreakdown}
        onClick={() => onNavigate('attention')}
      />
      <Card
        count={interactive.length}
        label="Interactive Clusters"
        running={running(interactive)}
        color="text-blue-600 dark:text-blue-400"
        onClick={() => onNavigate('interactive')}
      />
      <Card
        count={jobs.length}
        label="Job Clusters"
        running={running(jobs)}
        color="text-purple-600 dark:text-purple-400"
        onClick={() => onNavigate('jobs')}
      />
      <Card
        count={warehouses.length}
        label="SQL Warehouses"
        running={running(warehouses)}
        color="text-orange-500 dark:text-orange-400"
        onClick={() => onNavigate('warehouses')}
      />
      <Card
        count={pipelines.length}
        label="DLT Pipelines"
        running={running(pipelines)}
        extra={pipelineFailed > 0 ? `${pipelineFailed} failed` : undefined}
        color={pipelineFailed > 0 ? 'text-red-600 dark:text-red-400' : 'text-teal-600 dark:text-teal-400'}
        onClick={() => onNavigate('pipelines')}
      />
      <Card
        count={jobRuns.length}
        label="Active Job Runs"
        running={running(jobRuns)}
        color="text-indigo-600 dark:text-indigo-400"
        onClick={() => onNavigate('job_runs')}
      />
    </div>
  )
}
