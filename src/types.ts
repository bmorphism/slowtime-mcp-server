export interface SlowInterval {
  id: string;
  label: string;
  duration: number; // Duration in milliseconds
  startTime: number;
  pausedAt?: number;
  status: IntervalStatus;
  progress: number; // 0 to 1
}

export type IntervalStatus = 'active' | 'paused' | 'completed';

export interface CreateIntervalParams {
  label: string;
  duration: number; // Duration in milliseconds
}

export interface IntervalStore {
  [id: string]: SlowInterval;
}

export interface IntervalProgress {
  id: string;
  label: string;
  status: IntervalStatus;
  progress: number;
  remainingTime: number; // Milliseconds remaining
  totalDuration: number; // Total duration in milliseconds
}

export interface IntervalListResponse {
  intervals: IntervalProgress[];
}

export interface IntervalDetailResponse {
  interval: IntervalProgress;
}
