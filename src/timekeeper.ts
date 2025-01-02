import { v4 as uuidv4 } from 'uuid';
import {
  SlowInterval,
  IntervalStatus,
  CreateIntervalParams,
  IntervalStore,
  IntervalProgress,
} from './types.js';
import { TimeFuzz } from './timefuzz.js';

export class TimeKeeper {
  private intervals: IntervalStore = {};

  createInterval(params: CreateIntervalParams): SlowInterval {
    const id = uuidv4();
    const now = Date.now();
    
    // Add fuzzing to duration and start time
    const fuzzedDuration = TimeFuzz.fuzzDuration(params.duration);
    const fuzzedStartTime = TimeFuzz.addJitter(now);
    
    const interval: SlowInterval = {
      id,
      label: params.label,
      duration: fuzzedDuration,
      startTime: fuzzedStartTime,
      status: 'active',
      progress: 0,
    };

    this.intervals[id] = interval;
    return interval;
  }

  getInterval(id: string): SlowInterval | null {
    return this.intervals[id] || null;
  }

  async pauseInterval(id: string): Promise<boolean> {
    const interval = this.intervals[id];
    if (!interval || interval.status !== 'active') {
      return false;
    }

    // Add random delay to prevent timing analysis
    await TimeFuzz.randomDelay();
    
    interval.pausedAt = TimeFuzz.addJitter(Date.now());
    interval.status = 'paused';
    return true;
  }

  async resumeInterval(id: string): Promise<boolean> {
    const interval = this.intervals[id];
    if (!interval || interval.status !== 'paused' || !interval.pausedAt) {
      return false;
    }

    // Add random delay to prevent timing analysis
    await TimeFuzz.randomDelay();
    
    const now = TimeFuzz.addJitter(Date.now());
    const pauseDuration = now - interval.pausedAt;
    interval.startTime += pauseDuration;
    interval.pausedAt = undefined;
    interval.status = 'active';
    return true;
  }

  async getIntervalProgress(interval: SlowInterval): Promise<IntervalProgress> {
    // Add random delay to prevent timing analysis
    await TimeFuzz.randomDelay();
    
    const now = Date.now();
    let elapsedTime: number;
    
    if (interval.status === 'paused' && interval.pausedAt) {
      elapsedTime = interval.pausedAt - interval.startTime;
    } else {
      // Add jitter to current time to prevent timing correlation
      const fuzzedNow = TimeFuzz.addJitter(now);
      elapsedTime = fuzzedNow - interval.startTime;
    }

    const progress = Math.min(elapsedTime / interval.duration, 1);
    const remainingTime = Math.max(interval.duration - elapsedTime, 0);

    // Update status if completed
    if (progress >= 1 && interval.status === 'active') {
      interval.status = 'completed';
      interval.progress = 1;
    } else {
      interval.progress = progress;
    }

    return {
      id: interval.id,
      label: interval.label,
      status: interval.status,
      progress: interval.progress,
      remainingTime,
      totalDuration: interval.duration,
    };
  }

  async listIntervals(): Promise<IntervalProgress[]> {
    const intervals = await Promise.all(
      Object.values(this.intervals).map(interval => 
        this.getIntervalProgress(interval)
      )
    );
    return intervals;
  }

  async listActiveIntervals(): Promise<IntervalProgress[]> {
    const intervals = await this.listIntervals();
    return intervals.filter(interval => 
      interval.status === 'active' || interval.status === 'paused'
    );
  }

  async listCompletedIntervals(): Promise<IntervalProgress[]> {
    const intervals = await this.listIntervals();
    return intervals.filter(interval => 
      interval.status === 'completed'
    );
  }

  // Clean up completed intervals older than the specified age
  async cleanupCompletedIntervals(maxAgeMs: number): Promise<void> {
    // Add random delay to prevent timing analysis
    await TimeFuzz.randomDelay();
    
    const now = TimeFuzz.addJitter(Date.now());
    Object.entries(this.intervals).forEach(([id, interval]) => {
      if (interval.status === 'completed' && 
          (now - interval.startTime) > maxAgeMs) {
        delete this.intervals[id];
      }
    });
  }
}

// Create a singleton instance
export const timekeeper = new TimeKeeper();
