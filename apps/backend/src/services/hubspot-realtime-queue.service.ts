import { Queue, Worker, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

export type HubSpotRealtimeJob =
  | {
      type: "process-webhook-event";
      eventId: string;
    }
  | {
      type: "rehydrate-activity";
      orgId: string;
      activityType: "call" | "communication" | "email" | "note" | "meeting";
      hubspotActivityId: string;
    }
  | {
      type: "reanalyse-deal";
      runId: string;
    };

type HubSpotRealtimeProcessor = (job: HubSpotRealtimeJob) => Promise<void>;

type LoggerLike = {
  info: (payload: object, message?: string) => void;
  warn: (payload: object, message?: string) => void;
  error: (payload: object, message?: string) => void;
};

const QUEUE_NAME = "hubspot-realtime";
const inMemoryTimers = new Map<string, NodeJS.Timeout>();

let queue: Queue<HubSpotRealtimeJob> | null = null;
let worker: Worker<HubSpotRealtimeJob> | null = null;
let processor: HubSpotRealtimeProcessor | null = null;
let redisConnection: Redis | null = null;

const getRedisConnection = (): Redis | null => {
  if (!env.redisUrl) {
    return null;
  }

  if (redisConnection) {
    return redisConnection;
  }

  redisConnection = new Redis(env.redisUrl, {
    maxRetriesPerRequest: null,
  });

  return redisConnection;
};

const getQueue = (): Queue<HubSpotRealtimeJob> | null => {
  const connection = getRedisConnection();

  if (!connection) {
    return null;
  }

  if (queue) {
    return queue;
  }

  queue = new Queue<HubSpotRealtimeJob>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5_000,
      },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });

  return queue;
};

const buildInMemoryKey = (job: HubSpotRealtimeJob): string => {
  if (job.type === "reanalyse-deal") {
    return `${job.type}:${job.runId}`;
  }

  if (job.type === "rehydrate-activity") {
    return `${job.type}:${job.orgId}:${job.activityType}:${job.hubspotActivityId}`;
  }

  return `${job.type}:${job.eventId}`;
};

const enqueueInMemory = (job: HubSpotRealtimeJob, delayMs: number): void => {
  const currentProcessor = processor;

  if (!currentProcessor) {
    return;
  }

  const key = buildInMemoryKey(job);
  const existingTimer = inMemoryTimers.get(key);

  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    inMemoryTimers.delete(key);
    void currentProcessor(job).catch((error: unknown) => {
      console.error("HubSpot realtime in-memory job failed", error);
    });
  }, Math.max(0, delayMs));

  inMemoryTimers.set(key, timer);
};

export const enqueueHubSpotRealtimeJob = async (
  job: HubSpotRealtimeJob,
  options: JobsOptions = {},
): Promise<void> => {
  const activeQueue = getQueue();
  const delayMs = typeof options.delay === "number" ? options.delay : 0;

  if (!activeQueue) {
    enqueueInMemory(job, delayMs);
    return;
  }

  await activeQueue.add(job.type, job, options);
};

export const startHubSpotRealtimeWorker = (
  nextProcessor: HubSpotRealtimeProcessor,
  logger: LoggerLike,
): void => {
  processor = nextProcessor;

  const connection = getRedisConnection();

  if (!connection) {
    logger.warn(
      {
        queue: QUEUE_NAME,
      },
      "REDIS_URL absent: les jobs HubSpot realtime tournent en memoire locale.",
    );
    return;
  }

  if (worker) {
    return;
  }

  worker = new Worker<HubSpotRealtimeJob>(
    QUEUE_NAME,
    async (job) => {
      await nextProcessor(job.data);
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on("failed", (job, error) => {
    logger.error(
      {
        queue: QUEUE_NAME,
        jobId: job?.id ?? null,
        jobName: job?.name ?? null,
        error,
      },
      "Job HubSpot realtime en echec.",
    );
  });

  worker.on("ready", () => {
    logger.info(
      {
        queue: QUEUE_NAME,
      },
      "Worker HubSpot realtime pret.",
    );
  });
};
